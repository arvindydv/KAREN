import type { Elevation, StaffInvitation, StaffRole, UserStatusLookup } from '@karen/api-contracts';
import { canonicalizeEmail } from '@karen/domain';
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/api-error.js';
import type { PrismaService } from '../infrastructure/database/prisma.service.js';
import type { StaffElevation } from '../generated/prisma/client.js';
import { Prisma } from '../generated/prisma/client.js';
import { issueOpaqueToken } from '../security/opaque-token.js';
import { STAFF_DB, type StaffPrincipal } from './staff-auth.service.js';

const ENROLLMENT_TTL_MS = 24 * 3_600_000;
const ACCESS_REASON = /^[^\p{Cc}]{10,300}$/u;

/**
 * Staff administration (Phase 01 M8): invitations, standing roles, just-in-time elevation with
 * two-person approval, emergency disablement and audited, reason-bound user-status lookups.
 * Security admins cannot grant, elevate or disable themselves.
 */
@Injectable()
export class StaffAdminService {
  constructor(
    @Inject(STAFF_DB) private readonly db: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async invite(
    by: StaffPrincipal,
    emailRaw: string,
    displayName: string,
    roles: StaffRole[],
  ): Promise<StaffInvitation> {
    const email = canonicalizeEmail(emailRaw);
    if (!email.ok) throw new ApiError('VALIDATION_FAILED', 'Enter a valid e-mail address.');
    const token = issueOpaqueToken('staffEnrollment');
    const expiresAt = new Date(Date.now() + ENROLLMENT_TTL_MS);
    try {
      return await this.db.$transaction(async (tx) => {
        const account = await tx.staffAccount.create({
          data: { email: email.display, emailCanonical: email.canonical, displayName },
        });
        for (const role of new Set(roles)) {
          await tx.staffRoleAssignment.create({
            data: { staffId: account.id, role, grantedBy: by.staffId },
          });
        }
        await tx.staffEnrollment.create({
          data: {
            staffId: account.id,
            tokenVerifier: token.verifier,
            expiresAt,
            createdBy: by.staffId,
          },
        });
        await this.record(tx, by, 'staff.invited', 'staff_account', account.id, {
          roles: [...new Set(roles)].join(','),
        });
        return {
          staff_id: account.id,
          enrollment_token: token.token,
          expires_at: expiresAt.toISOString(),
        };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ApiError('CONFLICT', 'A staff account with this e-mail already exists.');
      }
      throw error;
    }
  }

  async grantRole(by: StaffPrincipal, staffId: string, role: StaffRole): Promise<void> {
    this.notSelf(by, staffId);
    await this.db.$transaction(async (tx) => {
      await this.existing(tx, staffId);
      await tx.staffRoleAssignment.upsert({
        where: { staffId_role: { staffId, role } },
        create: { staffId, role, grantedBy: by.staffId },
        update: {},
      });
      await this.record(tx, by, 'staff.role.granted', 'staff_account', staffId, { role });
    });
  }

  async revokeRole(by: StaffPrincipal, staffId: string, role: StaffRole): Promise<void> {
    this.notSelf(by, staffId);
    await this.db.$transaction(async (tx) => {
      await this.existing(tx, staffId);
      if (role === 'security_admin') {
        const remaining = await tx.staffRoleAssignment.count({
          where: { role: 'security_admin', NOT: { staffId }, account: { status: 'active' } },
        });
        if (remaining === 0)
          throw new ApiError('CONFLICT', 'At least one active security admin must remain.');
      }
      await tx.staffRoleAssignment.deleteMany({ where: { staffId, role } });
      await this.record(tx, by, 'staff.role.revoked', 'staff_account', staffId, { role });
    });
  }

  /** Emergency: disable a staff account and end all its sessions immediately. */
  async disable(by: StaffPrincipal, staffId: string, reason: string): Promise<void> {
    this.notSelf(by, staffId);
    await this.db.$transaction(async (tx) => {
      await this.existing(tx, staffId);
      await tx.staffAccount.update({
        where: { id: staffId },
        data: { status: 'disabled', version: { increment: 1 } },
      });
      const { count } = await tx.staffSession.updateMany({
        where: { staffId, revokedAt: null },
        data: { revokedAt: new Date(), revokeReason: 'account_disabled' },
      });
      await tx.staffElevation.updateMany({
        where: { staffId, status: { in: ['pending', 'active'] } },
        data: { status: 'revoked', decidedBy: by.staffId, decidedAt: new Date() },
      });
      await this.record(tx, by, 'staff.disabled', 'staff_account', staffId, {
        sessions_revoked: count,
        reason_len: reason.length,
      });
    });
  }

  async requestElevation(
    by: StaffPrincipal,
    role: StaffRole,
    reason: string,
    ticketRef: string,
    durationMinutes: number,
  ): Promise<Elevation> {
    const row = await this.db.$transaction(async (tx) => {
      const e = await tx.staffElevation.create({
        data: { staffId: by.staffId, role, reason, ticketRef, durationMinutes },
      });
      await this.record(tx, by, 'staff.elevation.requested', 'staff_elevation', e.id, {
        role,
        ticket: ticketRef,
      });
      return e;
    });
    return toElevation(row);
  }

  /** Approval by ANOTHER security admin (also enforced by a DB CHECK). */
  async decideElevation(by: StaffPrincipal, id: string, approve: boolean): Promise<Elevation> {
    const row = await this.db.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM staff.elevations WHERE id = ${id}::uuid FOR UPDATE`;
      if (!locked) throw new ApiError('NOT_FOUND', 'Not found.');
      const e = await tx.staffElevation.findUniqueOrThrow({ where: { id } });
      if (e.staffId === by.staffId)
        throw new ApiError('FORBIDDEN', 'You cannot approve your own elevation.');
      if (e.status !== 'pending')
        throw new ApiError('CONFLICT', 'This request was already decided.');
      const now = new Date();
      const updated = await tx.staffElevation.update({
        where: { id },
        data: approve
          ? {
              status: 'active',
              decidedBy: by.staffId,
              decidedAt: now,
              expiresAt: new Date(now.getTime() + e.durationMinutes * 60_000),
            }
          : { status: 'rejected', decidedBy: by.staffId, decidedAt: now },
      });
      await this.record(
        tx,
        by,
        approve ? 'staff.elevation.approved' : 'staff.elevation.rejected',
        'staff_elevation',
        id,
        {
          role: e.role,
          for_staff: e.staffId,
        },
      );
      return updated;
    });
    return toElevation(row);
  }

  async listElevations(): Promise<Elevation[]> {
    const rows = await this.db.staffElevation.findMany({
      orderBy: { requestedAt: 'desc' },
      take: 100,
    });
    return rows.map(toElevation);
  }

  /**
   * Support lookup of a consumer account's STATUS only. A justified access reason is mandatory
   * and recorded (as a length + hash-free category — never the free text in metadata).
   */
  async userStatus(
    by: StaffPrincipal,
    userId: string,
    reason: string | undefined,
  ): Promise<UserStatusLookup> {
    if (!reason || !ACCESS_REASON.test(reason)) {
      throw new ApiError('VALIDATION_FAILED', 'An access reason (10–300 characters) is required.', {
        details: [{ path: 'x-access-reason', message: 'required' }],
      });
    }
    const rows = await this.db.$queryRaw<{ status: string; created_at: Date }[]>`
      SELECT status, created_at FROM identity.staff_account_status(${userId}::uuid)`;
    await this.audit.record({
      actorType: 'STAFF',
      actorRef: by.staffId,
      action: 'staff.user_status.read',
      subjectType: 'user',
      subjectId: userId,
      outcome: rows[0] ? 'SUCCESS' : 'FAILURE',
      policyDecision: 'staff-rbac:v1',
      reasonCode: 'support_access',
      metadata: { reason_len: reason.length },
    });
    const row = rows[0];
    if (!row) throw new ApiError('NOT_FOUND', 'Not found.');
    return { user_id: userId, status: row.status, created_at: row.created_at.toISOString() };
  }

  private notSelf(by: StaffPrincipal, staffId: string) {
    if (by.staffId === staffId)
      throw new ApiError('FORBIDDEN', 'You cannot change your own access.');
  }

  private async existing(tx: Prisma.TransactionClient, staffId: string) {
    const a = await tx.staffAccount.findUnique({ where: { id: staffId }, select: { id: true } });
    if (!a) throw new ApiError('NOT_FOUND', 'Not found.');
  }

  private record(
    tx: Prisma.TransactionClient,
    by: StaffPrincipal,
    action: string,
    subjectType: string,
    subjectId: string,
    metadata: Record<string, string | number>,
  ) {
    return this.audit.record(
      {
        actorType: 'STAFF',
        actorRef: by.staffId,
        action,
        subjectType,
        subjectId,
        outcome: 'SUCCESS',
        policyDecision: 'staff-rbac:v1',
        metadata,
      },
      tx,
    );
  }
}

function toElevation(e: StaffElevation): Elevation {
  const expired = e.status === 'active' && e.expiresAt !== null && e.expiresAt <= new Date();
  return {
    id: e.id,
    staff_id: e.staffId,
    role: e.role as StaffRole,
    reason: e.reason,
    ticket_ref: e.ticketRef,
    status: expired ? 'expired' : (e.status as Elevation['status']),
    requested_at: e.requestedAt.toISOString(),
    decided_by: e.decidedBy,
    expires_at: e.expiresAt ? e.expiresAt.toISOString() : null,
  };
}
