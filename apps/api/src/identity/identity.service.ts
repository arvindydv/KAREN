import { randomUUID } from 'node:crypto';
import { ROLE_PERMISSIONS, type Permission, type Role } from '@karen/api-contracts';
import { pseudonymizeUserId } from '@karen/observability';
import { Inject, Injectable } from '@nestjs/common';
import type { AuthenticatedPrincipal } from '../auth/principal.js';
import { ApiError } from '../common/api-error.js';
import { API_ENV } from '../config/config.module.js';
import type { ApiEnv } from '../config/env.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../infrastructure/database/prisma.service.js';

const LAST_SEEN_REFRESH_MS = 60 * 60 * 1000;
const LOCAL_PSEUDONYMIZATION_KEY = 'local-only-pseudonymization-key';

interface IdentityLink {
  identityId: string;
  userId: string;
  lastSeenAt: Date;
}

@Injectable()
export class IdentityService {
  private readonly pseudonymKey: string;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(API_ENV) env: ApiEnv,
  ) {
    // Config validation guarantees a real key outside local/test.
    this.pseudonymKey = env.LOG_PSEUDONYMIZATION_KEY ?? LOCAL_PSEUDONYMIZATION_KEY;
  }

  /**
   * Map a verified (issuer, subject) to the internal user, provisioning the identity link on
   * first sight. Roles come exclusively from server-side grants — never from token claims.
   */
  async resolvePrincipal(issuer: string, subject: string): Promise<AuthenticatedPrincipal> {
    const link = await this.findOrProvision(issuer, subject);
    const { status, grants } = await this.prisma.withUserScope(link.userId, async (tx) => {
      const user = await tx.user.findUniqueOrThrow({
        where: { id: link.userId },
        select: { status: true },
      });
      if (Date.now() - link.lastSeenAt.getTime() > LAST_SEEN_REFRESH_MS) {
        await tx.externalIdentity.update({
          where: { id: link.identityId },
          data: { lastSeenAt: new Date() },
        });
      }
      const staff = await tx.staffRoleGrant.findMany({ where: { userId: link.userId } });
      return { status: user.status, grants: staff };
    });
    // Deny by default: only ACTIVE accounts may act. Suspended / deletion-requested users keep
    // valid IdP tokens, so this check must happen server-side on every request.
    if (status !== 'ACTIVE') {
      throw new ApiError('FORBIDDEN', 'This account is not active.');
    }
    const roles: Role[] = ['user', ...grants.map((g) => g.role)];
    const permissions = [...new Set<Permission>(roles.flatMap((r) => ROLE_PERMISSIONS[r]))];
    return {
      userId: link.userId,
      issuer,
      subject,
      roles,
      permissions,
      userRef: pseudonymizeUserId(link.userId, this.pseudonymKey),
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

  private async findOrProvision(issuer: string, subject: string): Promise<IdentityLink> {
    const existing = await this.lookup(issuer, subject);
    if (existing) return existing;
    // The user id is generated here so the new rows can be written inside their own RLS scope.
    const userId = randomUUID();
    try {
      return await this.prisma.withUserScope(userId, async (tx) => {
        await tx.user.create({ data: { id: userId } });
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
