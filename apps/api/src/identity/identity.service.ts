import { randomUUID } from 'node:crypto';
import { ROLE_PERMISSIONS, type Permission, type Role } from '@karen/api-contracts';
import { accountAccessLevel } from '@karen/domain';
import { pseudonymizeUserId } from '@karen/observability';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AuthenticatedPrincipal } from '../auth/principal.js';
import { ApiError } from '../common/api-error.js';
import { API_ENV } from '../config/config.module.js';
import type { ApiEnv } from '../config/env.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../infrastructure/database/prisma.service.js';
import { SessionService } from './session.service.js';

/** External-identity issuer used for local-dev provisioned accounts (seed, dev token route). */
export const LOCAL_DEV_ISSUER = 'urn:karen:local-dev';
const LOCAL_PSEUDONYMIZATION_KEY = 'local-only-pseudonymization-key';

interface IdentityLink {
  identityId: string;
  userId: string;
  lastSeenAt: Date;
}

@Injectable()
export class IdentityService {
  private readonly logger = new Logger(IdentityService.name);
  private readonly pseudonymKey: string;
  private readonly allowDevProvisioning: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    @Inject(API_ENV) env: ApiEnv,
  ) {
    // Config validation guarantees a real key outside local/test.
    this.pseudonymKey = env.LOG_PSEUDONYMIZATION_KEY ?? LOCAL_PSEUDONYMIZATION_KEY;
    this.allowDevProvisioning =
      env.AUTH_MODE === 'local-dev' && (env.APP_ENV === 'local' || env.APP_ENV === 'test');
  }

  /**
   * Resolves the caller from a server-verified session: ONE user-scoped transaction checks the
   * session is live (not revoked/expired), the account status allows access, and loads staff
   * grants. Roles come exclusively from server-side grants — never from token claims.
   * Authentication never creates accounts (ADR-0015).
   */
  async resolvePrincipalForSession(
    userId: string,
    sessionId: string,
    options: { allowDeletionPending?: boolean } = {},
  ): Promise<AuthenticatedPrincipal> {
    const resolved = await this.prisma.withUserScope(userId, async (tx) => {
      const session = await this.sessions.resolveLive(tx, userId, sessionId);
      if (!session) return null;
      const user = await tx.user.findUnique({ where: { id: userId }, select: { status: true } });
      if (!user) return null;
      const grants = await tx.staffRoleGrant.findMany({ where: { userId } });
      return { session, status: user.status, grants };
    });
    if (!resolved) {
      this.logger.warn({ reason: 'session_not_live' }, 'Rejected credential');
      throw new ApiError('UNAUTHENTICATED', 'Authentication is required.');
    }
    // Deny by default: only ACTIVE accounts get full access. A DELETION_REQUESTED account may
    // reach only routes marked @AllowDeletionPending (view/cancel the deletion, sign out).
    const level = accountAccessLevel(resolved.status);
    const allowed =
      level === 'full' || (level === 'deletion_pending' && options.allowDeletionPending === true);
    if (!allowed) {
      throw new ApiError('ACCOUNT_INACTIVE', 'This account is not active.', {
        ...(level === 'deletion_pending' ? { nextOptions: ['CANCEL_DELETION'] } : {}),
      });
    }
    const roles: Role[] = ['user', ...resolved.grants.map((g) => g.role)];
    const permissions = [...new Set<Permission>(roles.flatMap((r) => ROLE_PERMISSIONS[r]))];
    return {
      userId,
      sessionId,
      client: resolved.session.client,
      authTime: resolved.session.authTime,
      // A pending-deletion session never carries staff permissions.
      roles: level === 'full' ? roles : ['user'],
      permissions: level === 'full' ? permissions : [],
      restricted: level !== 'full',
      userRef: pseudonymizeUserId(userId, this.pseudonymKey),
    };
  }

  /**
   * Pre-authentication lookup. The runtime role cannot read identity links of unknown users
   * (RLS), so this uses the narrow SECURITY DEFINER function that matches exactly one
   * (issuer, subject) pair and cannot enumerate.
   */
  private async lookup(issuer: string, subject: string): Promise<IdentityLink | null> {
    const rows = await this.prisma.$queryRaw<
      { identity_id: string; user_id: string; last_seen_at: Date }[]
    >`SELECT identity_id, user_id, last_seen_at
      FROM identity.lookup_external_identity(${issuer}, ${subject})`;
    const row = rows[0];
    return row
      ? { identityId: row.identity_id, userId: row.user_id, lastSeenAt: row.last_seen_at }
      : null;
  }

  /**
   * LOCAL/TEST ONLY: explicitly provisions an ACTIVE account for a local-dev issuer subject.
   * Called by the dev token route — never by the authentication path. Idempotent and
   * race-safe (unique (issuer, subject)). Refuses outside AUTH_MODE=local-dev + APP_ENV=local|test.
   */
  async provisionLocalDevIdentity(issuer: string, subject: string): Promise<IdentityLink> {
    if (!this.allowDevProvisioning) {
      throw new ApiError('NOT_FOUND', 'Not found.');
    }
    const existing = await this.lookup(issuer, subject);
    if (existing) return existing;
    // The user id is generated here so the new rows can be written inside their own RLS scope.
    const userId = randomUUID();
    try {
      return await this.prisma.withUserScope(userId, async (tx) => {
        await tx.user.create({ data: { id: userId, status: 'ACTIVE' } });
        const link = await tx.externalIdentity.create({ data: { issuer, subject, userId } });
        return { identityId: link.id, userId, lastSeenAt: link.lastSeenAt };
      });
    } catch (error) {
      // Concurrent first requests for the same identity: the other insert won — read it.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const winner = await this.lookup(issuer, subject);
        if (winner) return winner;
      }
      throw error;
    }
  }

  getUser(userId: string) {
    return this.prisma.withUserScope(userId, (tx) =>
      tx.user.findUniqueOrThrow({ where: { id: userId } }),
    );
  }
}
