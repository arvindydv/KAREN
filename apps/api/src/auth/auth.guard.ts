import type { Permission } from '@karen/api-contracts';
import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/api-error.js';
import { IdentityService } from '../identity/identity.service.js';
import { SessionService } from '../identity/session.service.js';
import {
  ACCESS_TOKEN_SERVICE,
  AccessTokenError,
  type AccessTokenService,
} from '../security/access-token.js';
import { ALLOW_DELETION_PENDING, IS_PUBLIC, REQUIRED_PERMISSIONS } from './decorators.js';

const bearer = (header: string | undefined): string | undefined => {
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? '');
  return match?.[1];
};

/**
 * Global authentication guard (ADR-0016): every route requires a live KAREN session unless
 * marked @Public(). Accepts either an opaque web session token (`kss_…`, sent by the web BFF)
 * or a first-party ES256 access token (mobile). Both resolve to a session row that is checked
 * on every request, so revocation is immediate. Unknown → deny.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    @Inject(ACCESS_TOKEN_SERVICE) private readonly tokens: AccessTokenService,
    private readonly sessions: SessionService,
    private readonly identity: IdentityService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return false;
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const token = bearer(request.headers.authorization);
    let owner: { userId: string; sessionId: string } | null;
    if (token?.startsWith('kss_')) {
      owner = await this.sessions.locateWebSession(token);
      if (!owner) this.logger.warn({ reason: 'UNKNOWN_SESSION' }, 'Rejected session token');
    } else {
      try {
        const claims = await this.tokens.verify(token);
        owner = { userId: claims.userId, sessionId: claims.sessionId };
      } catch (error) {
        if (!(error instanceof AccessTokenError)) throw error;
        // Log the reason class only — never the token.
        this.logger.warn({ reason: error.reason }, 'Rejected access token');
        owner = null;
      }
    }
    if (!owner) throw new ApiError('UNAUTHENTICATED', 'Authentication is required.');
    const allowDeletionPending =
      this.reflector.getAllAndOverride<boolean>(ALLOW_DELETION_PENDING, [
        context.getHandler(),
        context.getClass(),
      ]) === true;
    request.principal = await this.identity.resolvePrincipalForSession(
      owner.userId,
      owner.sessionId,
      { allowDeletionPending },
    );
    return true;
  }
}

/** Global authorisation guard for @RequirePermissions(). Runs after AuthGuard. */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(
      REQUIRED_PERMISSIONS,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) return true;
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const principal = request.principal;
    if (!principal) throw new ApiError('UNAUTHENTICATED', 'Authentication is required.');
    const missing = required.filter((p) => !principal.permissions.includes(p));
    if (missing.length > 0) {
      await this.audit.recordBestEffort({
        actorType: 'USER',
        actorRef: principal.userId,
        action: 'authz.permission_denied',
        subjectType: 'route',
        subjectId: request.routeOptions.url ?? 'unknown',
        outcome: 'DENIED',
        policyDecision: 'rbac:v1',
        reasonCode: 'missing_permission',
        metadata: { missing: missing.join(',') },
      });
      throw new ApiError('FORBIDDEN', 'You do not have permission to perform this action.');
    }
    return true;
  }
}
