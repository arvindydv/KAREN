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
    const identity = await this.findOrProvision(issuer, subject);
    // Deny by default: only ACTIVE accounts may act. Suspended / deletion-requested users keep
    // valid IdP tokens, so this check must happen server-side on every request.
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: identity.userId },
      select: { status: true },
    });
    if (user.status !== 'ACTIVE') {
      throw new ApiError('FORBIDDEN', 'This account is not active.');
    }
    if (Date.now() - identity.lastSeenAt.getTime() > LAST_SEEN_REFRESH_MS) {
      await this.prisma.externalIdentity.update({
        where: { id: identity.id },
        data: { lastSeenAt: new Date() },
      });
    }
    const grants = await this.prisma.staffRoleGrant.findMany({
      where: { userId: identity.userId },
    });
    const roles: Role[] = ['user', ...grants.map((g) => g.role)];
    const permissions = [...new Set<Permission>(roles.flatMap((r) => ROLE_PERMISSIONS[r]))];
    return {
      userId: identity.userId,
      issuer,
      subject,
      roles,
      permissions,
      userRef: pseudonymizeUserId(identity.userId, this.pseudonymKey),
    };
  }

  private async findOrProvision(issuer: string, subject: string) {
    const existing = await this.prisma.externalIdentity.findUnique({
      where: { issuer_subject: { issuer, subject } },
    });
    if (existing) return existing;
    try {
      return await this.prisma.withTransaction(async (tx) => {
        const user = await tx.user.create({ data: {} });
        return tx.externalIdentity.create({ data: { issuer, subject, userId: user.id } });
      });
    } catch (error) {
      // Concurrent first requests for the same identity: the other insert won — read it.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return this.prisma.externalIdentity.findUniqueOrThrow({
          where: { issuer_subject: { issuer, subject } },
        });
      }
      throw error;
    }
  }

  getUser(userId: string) {
    return this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
  }
}
