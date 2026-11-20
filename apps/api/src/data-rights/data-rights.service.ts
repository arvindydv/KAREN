import { createHash } from 'node:crypto';
import type { DataRightsList, DataRightsRequest as RequestDto } from '@karen/api-contracts';
import {
  DATA_RIGHTS_WORKFLOWS,
  type ErasureStepOutcome,
  type ExportExpiryOutcome,
  type ExportStepResult,
  TASK_QUEUES,
  assertAccountTransition,
  canonicalJson,
  dataRightsWorkflowId,
} from '@karen/domain';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/api-error.js';
import { API_ENV } from '../config/config.module.js';
import type { ApiEnv } from '../config/env.js';
import type { DataRightsRequest } from '../generated/prisma/client.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  PrismaService,
  type TransactionClient,
} from '../infrastructure/database/prisma.service.js';
import { MailService } from '../infrastructure/mail/mail.service.js';
import {
  WORKFLOW_STARTER,
  type WorkflowStarter,
} from '../infrastructure/temporal/workflow-starter.js';
import { AccountService } from '../identity/account.service.js';
import {
  accountDeletedMail,
  deletionCancelledMail,
  deletionScheduledMail,
  exportReadyMail,
} from '../identity/auth-emails.js';
import { ReauthService } from '../identity/reauth.service.js';
import { SessionService } from '../identity/session.service.js';

/** Security secrets are never exported; the export says so instead of silently omitting them. */
const EXCLUDED_FROM_EXPORT = [
  'password hash (security secret, not your data)',
  'session, refresh and one-time-code verifiers (security secrets)',
  'security audit log (kept for security; contains no contact details)',
];

/**
 * Data export and account deletion (Phase 01 M7, ADR-0020).
 *
 * User-facing operations record a durable request and start a Temporal workflow (or, in
 * local/test `manual` mode, leave the steps to the signed internal endpoints). The workflow's
 * steps call back into `buildExport`, `expireExport` and `executeErasure` — all idempotent, so
 * Temporal retries after a worker restart are safe. Workflow inputs carry request ids only.
 */
@Injectable()
export class DataRightsService {
  private readonly logger = new Logger(DataRightsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountService,
    private readonly reauth: ReauthService,
    private readonly sessions: SessionService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    @Inject(WORKFLOW_STARTER) private readonly workflows: WorkflowStarter,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  // ── User-facing ─────────────────────────────────────────────────────────────────────────

  async list(userId: string): Promise<DataRightsList> {
    const rows = await this.prisma.withUserScope(userId, (tx) =>
      tx.dataRightsRequest.findMany({
        where: { userId },
        orderBy: { requestedAt: 'desc' },
        take: 50,
      }),
    );
    return { items: rows.map(toDto) };
  }

  async get(userId: string, id: string): Promise<RequestDto> {
    return toDto(await this.owned(userId, id));
  }

  /** Idempotent: an open export request is returned (and its workflow start re-attempted). */
  async requestExport(userId: string): Promise<RequestDto> {
    const row = await this.prisma.withUserScope(userId, async (tx) => {
      const open = await tx.dataRightsRequest.findUnique({
        where: { userId_activeKind: { userId, activeKind: 'export' } },
      });
      if (open) return open;
      const created = await this.insertOrExisting(tx, userId, 'export', {
        status: 'requested',
        activeKind: 'export',
      });
      await this.auditRequest(tx, userId, 'privacy.export.requested', created.id);
      return created;
    });
    await this.dispatch('export', row.id, { requestId: row.id });
    return toDto(row);
  }

  /**
   * Schedules deletion after re-authentication: ACTIVE → DELETION_REQUESTED, every session
   * revoked, cancellation window starts. The data stays until the window ends.
   */
  async requestDeletion(userId: string, currentPassword: string): Promise<RequestDto> {
    const email = await this.reauth.verify(userId, currentPassword);
    const scheduledFor = new Date(Date.now() + this.env.DATA_DELETION_GRACE_SECONDS * 1000);
    const row = await this.prisma.withUserScope(userId, async (tx) => {
      const open = await tx.dataRightsRequest.findUnique({
        where: { userId_activeKind: { userId, activeKind: 'deletion' } },
      });
      if (open) return open;
      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { status: true, version: true },
      });
      assertAccountTransition(user.status, 'DELETION_REQUESTED');
      const { count } = await tx.user.updateMany({
        where: { id: userId, version: user.version, status: user.status },
        data: { status: 'DELETION_REQUESTED', version: { increment: 1 } },
      });
      if (count !== 1) {
        throw new ApiError('CONFLICT', 'Your account changed. Please try again.', {
          retryable: true,
        });
      }
      await this.sessions.revokeInTx(tx, userId, {}, 'account_status');
      const created = await this.insertOrExisting(tx, userId, 'deletion', {
        status: 'scheduled',
        activeKind: 'deletion',
        scheduledFor,
      });
      await this.auditRequest(tx, userId, 'privacy.deletion.requested', created.id);
      return created;
    });
    this.mail.dispatch(deletionScheduledMail(email.display, row.scheduledFor ?? scheduledFor));
    await this.dispatch('deletion', row.id, {
      requestId: row.id,
      waitSeconds: secondsUntil(row.scheduledFor ?? scheduledFor),
    });
    return toDto(row);
  }

  /** Cancels an open request. Deletion: only inside the window; account returns to ACTIVE. */
  async cancel(userId: string, id: string): Promise<RequestDto> {
    let notify = false;
    const row = await this.prisma.withUserScope(userId, async (tx) => {
      const [req] = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM consent.data_rights_requests
        WHERE id = ${id}::uuid AND user_id = ${userId}::uuid FOR UPDATE`;
      if (!req) throw new ApiError('NOT_FOUND', 'Not found.');
      const current = await tx.dataRightsRequest.findUniqueOrThrow({ where: { id } });
      if (current.status === 'cancelled') return current; // idempotent
      if (current.activeKind === null) {
        throw new ApiError('CONFLICT', 'This request can no longer be cancelled.');
      }
      if (current.kind === 'deletion') {
        const user = await tx.user.findUniqueOrThrow({
          where: { id: userId },
          select: { status: true },
        });
        assertAccountTransition(user.status, 'ACTIVE');
        await tx.user.updateMany({
          where: { id: userId, status: 'DELETION_REQUESTED' },
          data: { status: 'ACTIVE', version: { increment: 1 } },
        });
        notify = true;
      }
      const updated = await tx.dataRightsRequest.update({
        where: { id },
        data: {
          status: 'cancelled',
          activeKind: null,
          cancelledAt: new Date(),
          version: { increment: 1 },
        },
      });
      await this.auditRequest(tx, userId, `privacy.${current.kind}.cancelled`, id);
      return updated;
    });
    if (notify) await this.notify(userId, 'deletion_cancelled', (to) => deletionCancelledMail(to));
    return toDto(row);
  }

  async download(userId: string, id: string): Promise<{ payload: unknown; sha256: string }> {
    const row = await this.owned(userId, id);
    if (
      row.kind !== 'export' ||
      row.status !== 'ready' ||
      row.exportPayload === null ||
      row.exportSha256 === null ||
      (row.expiresAt && row.expiresAt.getTime() <= Date.now())
    ) {
      throw new ApiError('NOT_FOUND', 'This export is not available.');
    }
    await this.audit.record({
      actorType: 'USER',
      actorRef: userId,
      action: 'privacy.export.downloaded',
      subjectType: 'data_rights_request',
      subjectId: id,
      outcome: 'SUCCESS',
    });
    return { payload: row.exportPayload, sha256: row.exportSha256 };
  }

  // ── Workflow steps (signed internal calls; idempotent) ──────────────────────────────────

  async buildExport(requestId: string): Promise<ExportStepResult> {
    const located = await this.locate(requestId, 'export');
    const ttlMs = this.env.DATA_EXPORT_TTL_HOURS * 3_600_000;
    const result = await this.prisma.withUserScope(located.userId, async (tx) => {
      const req = await tx.dataRightsRequest.findUniqueOrThrow({ where: { id: requestId } });
      if (req.status === 'cancelled') {
        return { outcome: 'cancelled' as const, expiresAt: null, expiresInSeconds: null };
      }
      if (req.status !== 'requested' && req.status !== 'processing') {
        return {
          outcome: 'already_done' as const,
          expiresAt: null,
          expiresInSeconds: req.expiresAt ? secondsUntil(req.expiresAt) : null,
        };
      }
      const payload = await this.collect(tx, located.userId);
      const sha256 = `sha256:${createHash('sha256').update(canonicalJson(payload)).digest('hex')}`;
      const expiresAt = new Date(Date.now() + ttlMs);
      await tx.dataRightsRequest.update({
        where: { id: requestId },
        data: {
          status: 'ready',
          activeKind: null,
          exportPayload: payload,
          exportSha256: sha256,
          completedAt: new Date(),
          expiresAt,
          version: { increment: 1 },
        },
      });
      await this.auditSystem(tx, 'privacy.export.ready', requestId);
      return { outcome: 'ready' as const, expiresAt, expiresInSeconds: secondsUntil(expiresAt) };
    });
    if (result.outcome === 'ready' && result.expiresAt) {
      const expiresAt = result.expiresAt;
      await this.notify(located.userId, 'export_ready', (to) => exportReadyMail(to, expiresAt));
    }
    return { outcome: result.outcome, expiresInSeconds: result.expiresInSeconds };
  }

  async expireExport(requestId: string): Promise<ExportExpiryOutcome> {
    const located = await this.locate(requestId, 'export');
    return this.prisma.withUserScope(located.userId, async (tx) => {
      const req = await tx.dataRightsRequest.findUniqueOrThrow({ where: { id: requestId } });
      if (req.status !== 'ready') return 'already_done';
      if (req.expiresAt && req.expiresAt.getTime() > Date.now()) return 'not_due';
      await tx.dataRightsRequest.update({
        where: { id: requestId },
        data: {
          status: 'expired',
          exportPayload: Prisma.DbNull,
          exportSha256: null,
          version: { increment: 1 },
        },
      });
      await this.auditSystem(tx, 'privacy.export.expired', requestId);
      return 'expired';
    });
  }

  async executeErasure(requestId: string): Promise<ErasureStepOutcome> {
    const located = await this.locate(requestId, 'deletion');
    // Read the address first (it is erased below) so the confirmation can still be sent.
    const email =
      located.status === 'scheduled'
        ? await this.addressOrNull(located.userId, 'account_deleted')
        : null;
    const [row] = await this.prisma.$queryRaw<{ outcome: ErasureStepOutcome }[]>`
      SELECT identity.erase_user(${requestId}::uuid) AS outcome`;
    const outcome = row?.outcome;
    if (!outcome) throw new Error('erase_user returned no outcome');
    if (outcome === 'completed' && located.status === 'scheduled') {
      await this.audit.record({
        actorType: 'SYSTEM',
        actorRef: 'temporal:accountDeletionWorkflow',
        action: 'privacy.deletion.completed',
        subjectType: 'data_rights_request',
        subjectId: requestId,
        outcome: 'SUCCESS',
      });
      if (email) this.mail.dispatch(accountDeletedMail(email.display));
    }
    return outcome;
  }

  // ── internals ───────────────────────────────────────────────────────────────────────────

  /**
   * Post-commit notification. The state change already committed, so a notification problem
   * (no address on file, read failure) is logged and never turns a completed step into an error.
   */
  private async notify(
    userId: string,
    kind: string,
    build: (to: string) => Parameters<MailService['dispatch']>[0],
  ): Promise<void> {
    const address = await this.addressOrNull(userId, kind);
    if (address) this.mail.dispatch(build(address.display));
  }

  private async addressOrNull(userId: string, kind: string) {
    try {
      return await this.accounts.emailOf(userId);
    } catch (error) {
      this.logger.warn(
        { err: error, notification: kind },
        'No deliverable address; notification skipped',
      );
      return null;
    }
  }

  private async dispatch(kind: 'export' | 'deletion', requestId: string, input: unknown) {
    const workflowId = dataRightsWorkflowId(kind, requestId);
    try {
      await this.workflows.start(
        kind === 'export' ? DATA_RIGHTS_WORKFLOWS.EXPORT : DATA_RIGHTS_WORKFLOWS.DELETION,
        workflowId,
        TASK_QUEUES.TASKS,
        input,
      );
    } catch (error) {
      // The request is durable; repeating the call re-attempts the (idempotent) start.
      this.logger.error({ err: error, workflow_id: workflowId }, 'Workflow start failed');
      throw new ApiError(
        'DEPENDENCY_UNAVAILABLE',
        'Your request was saved but could not be started yet. Please try again shortly.',
        { retryable: true, cause: error },
      );
    }
  }

  private async insertOrExisting(
    tx: TransactionClient,
    userId: string,
    kind: 'export' | 'deletion',
    data: { status: string; activeKind: string; scheduledFor?: Date },
  ): Promise<DataRightsRequest> {
    return tx.dataRightsRequest.create({
      data: {
        userId,
        kind,
        ...data,
        workflowId: null,
      },
    });
  }

  private async owned(userId: string, id: string): Promise<DataRightsRequest> {
    const row = await this.prisma.withUserScope(userId, (tx) =>
      tx.dataRightsRequest.findFirst({ where: { id, userId } }),
    );
    if (!row) throw new ApiError('NOT_FOUND', 'Not found.');
    return row;
  }

  private async locate(requestId: string, kind: 'export' | 'deletion') {
    const rows = await this.prisma.$queryRaw<{ user_id: string; kind: string; status: string }[]>`
      SELECT user_id, kind, status FROM consent.lookup_data_rights_request(${requestId}::uuid)`;
    const row = rows[0];
    if (!row || row.kind !== kind) throw new ApiError('NOT_FOUND', 'Not found.');
    return { userId: row.user_id, status: row.status };
  }

  /** Everything the user gave us or we hold about them, minus security secrets. */
  private async collect(tx: TransactionClient, userId: string) {
    const [
      user,
      email,
      preferences,
      places,
      onboarding,
      devices,
      sessions,
      grants,
      receipts,
      legal,
    ] = await Promise.all([
      tx.user.findUniqueOrThrow({ where: { id: userId } }),
      tx.userEmail.findUnique({ where: { userId } }),
      tx.userPreferences.findUnique({ where: { userId } }),
      tx.savedPlace.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
      tx.onboardingProgress.findUnique({ where: { userId } }),
      tx.device.findMany({ where: { userId } }),
      tx.session.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
      tx.consentGrant.findMany({ where: { userId } }),
      tx.consentReceipt.findMany({ where: { userId }, orderBy: { seq: 'asc' } }),
      tx.legalAcceptance.findMany({ where: { userId } }),
    ]);
    const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
    return {
      format: 'karen.data-export.v1',
      generated_at: new Date().toISOString(),
      account: {
        id: user.id,
        status: user.status,
        created_at: iso(user.createdAt),
        display_name: user.displayName,
        preferred_name: user.preferredName,
        locale: user.locale,
        timezone: user.timezone,
        country: user.country,
        currency: user.currency,
        email: email?.email ?? null,
        email_verified_at: iso(email?.verifiedAt),
      },
      preferences: preferences
        ? {
            language: preferences.language,
            script: preferences.script,
            date_format: preferences.dateFormat,
            time_format: preferences.timeFormat,
            theme: preferences.theme,
            text_size: preferences.textSize,
            reduced_motion: preferences.reducedMotion,
            high_contrast: preferences.highContrast,
            notify_product_email: preferences.notifyProductEmail,
            notify_push: preferences.notifyPush,
            quiet_hours_start: preferences.quietHoursStart,
            quiet_hours_end: preferences.quietHoursEnd,
          }
        : null,
      saved_places: places.map((p) => ({
        kind: p.kind,
        label: p.label,
        line1: p.line1,
        line2: p.line2,
        city: p.city,
        region: p.region,
        postal_code: p.postalCode,
        country: p.country,
        created_at: iso(p.createdAt),
      })),
      onboarding: onboarding
        ? {
            status: onboarding.status,
            completed_steps: onboarding.completedSteps,
            completed_at: iso(onboarding.completedAt),
          }
        : null,
      devices: devices.map((d) => ({
        platform: d.platform,
        name: d.name,
        first_seen_at: iso(d.firstSeenAt),
        last_seen_at: iso(d.lastSeenAt),
      })),
      sessions: sessions.map((s) => ({
        client: s.client,
        created_at: iso(s.createdAt),
        last_seen_at: iso(s.lastSeenAt),
        revoked_at: iso(s.revokedAt),
        revoke_reason: s.revokeReason,
      })),
      consents: grants.map((g) => ({
        purpose: g.purpose,
        status: g.status,
        notice_version: g.policyVersion,
        granted_at: iso(g.grantedAt),
        revoked_at: iso(g.revokedAt),
      })),
      consent_receipts: receipts.map((r) => ({
        seq: r.seq,
        purpose: r.purpose,
        decision: r.decision,
        notice_kind: r.noticeKind,
        notice_version: r.noticeVersion,
        notice_sha256: r.noticeSha256,
        source: r.source,
        method: r.method,
        occurred_at: iso(r.occurredAt),
        receipt_hash: r.receiptHash,
      })),
      legal_acceptances: legal.map((l) => ({
        document: l.documentType,
        version: l.documentVersion,
        locale: l.locale,
        accepted_at: iso(l.acceptedAt),
      })),
      not_included: EXCLUDED_FROM_EXPORT,
    };
  }

  private auditRequest(tx: TransactionClient, userId: string, action: string, id: string) {
    return this.audit.record(
      {
        actorType: 'USER',
        actorRef: userId,
        action,
        subjectType: 'data_rights_request',
        subjectId: id,
        outcome: 'SUCCESS',
      },
      tx,
    );
  }

  private auditSystem(tx: TransactionClient, action: string, id: string) {
    return this.audit.record(
      {
        actorType: 'SYSTEM',
        actorRef: 'temporal-worker',
        action,
        subjectType: 'data_rights_request',
        subjectId: id,
        outcome: 'SUCCESS',
      },
      tx,
    );
  }
}

const secondsUntil = (d: Date): number => Math.max(0, Math.ceil((d.getTime() - Date.now()) / 1000));

function toDto(r: DataRightsRequest): RequestDto {
  const exceptions = Array.isArray(r.retentionExceptions)
    ? (r.retentionExceptions as { category: string; reason: string }[])
    : [];
  return {
    id: r.id,
    kind: r.kind as RequestDto['kind'],
    status: r.status as RequestDto['status'],
    requested_at: r.requestedAt.toISOString(),
    scheduled_for: r.scheduledFor ? r.scheduledFor.toISOString() : null,
    completed_at: r.completedAt ? r.completedAt.toISOString() : null,
    cancelled_at: r.cancelledAt ? r.cancelledAt.toISOString() : null,
    expires_at: r.expiresAt ? r.expiresAt.toISOString() : null,
    download_available:
      r.kind === 'export' &&
      r.status === 'ready' &&
      r.exportSha256 !== null &&
      (!r.expiresAt || r.expiresAt.getTime() > Date.now()),
    retention_exceptions: exceptions,
  };
}
