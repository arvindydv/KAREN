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
import { IS_PUBLIC, REQUIRED_PERMISSIONS } from './decorators.js';
import { TokenVerificationError, type TokenVerifier } from './token-verifier.js';

export const TOKEN_VERIFIER = Symbol('TOKEN_VERIFIER');

const bearer = (header: string | undefined): string | undefined => {
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? '');
  return match?.[1];
};

/**
 * Global authentication guard: every route requires a valid access token unless marked
 * @Public(). Unknown → deny.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    @Inject(TOKEN_VERIFIER) private readonly verifier: TokenVerifier,
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
    try {
      const token = await this.verifier.verify(bearer(request.headers.authorization));
      request.principal = await this.identity.resolvePrincipal(token.issuer, token.subject);
      return true;
    } catch (error) {
      if (error instanceof TokenVerificationError) {
        // Log the reason class only — never the token.
        this.logger.warn({ reason: error.reason }, 'Rejected access token');
        throw new ApiError('UNAUTHENTICATED', 'Authentication is required.', {
          retryable: error.reason === 'JWKS_UNAVAILABLE',
        });
      }
      throw error;
    }
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
        metadata: { missing: missing.join(',') },
      });
      throw new ApiError('FORBIDDEN', 'You do not have permission to perform this action.');
    }
    return true;
  }
}
