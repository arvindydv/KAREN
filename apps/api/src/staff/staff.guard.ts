import type { StaffPermission } from '@karen/api-contracts';
import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  Logger,
  SetMetadata,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/api-error.js';
import { API_ENV } from '../config/config.module.js';
import type { ApiEnv } from '../config/env.js';
import { StaffAuthService, type StaffPrincipal } from './staff-auth.service.js';

export const STAFF_PERMISSIONS_KEY = 'karen:staffPermissions';
export const STAFF_STEP_UP_KEY = 'karen:staffStepUp';
export const STAFF_SESSION_OPTIONAL_KEY = 'karen:staffSessionOptional';

/** Require ALL listed staff permissions (standing grants ∪ active elevations). */
export const RequireStaffPermissions = (...permissions: StaffPermission[]) =>
  SetMetadata(STAFF_PERMISSIONS_KEY, permissions);
/** Require a fresh WebAuthn assertion (≤ STAFF_STEP_UP_MAX_AGE_SECONDS) for this action. */
export const RequireStepUp = () => SetMetadata(STAFF_STEP_UP_KEY, true);
/** Staff auth endpoints that run before a session exists (login/enrollment). */
export const NoStaffSession = () => SetMetadata(STAFF_SESSION_OPTIONAL_KEY, true);

declare module 'fastify' {
  interface FastifyRequest {
    staff?: StaffPrincipal;
  }
}

export const CurrentStaff = createParamDecorator(
  (_d: unknown, ctx: ExecutionContext): StaffPrincipal => {
    const staff = ctx.switchToHttp().getRequest<FastifyRequest>().staff;
    if (!staff) throw new ApiError('UNAUTHENTICATED', 'Authentication is required.');
    return staff;
  },
);

const bearer = (header: string | undefined): string | undefined =>
  /^Bearer\s+(\S+)$/i.exec(header ?? '')?.[1];

/**
 * Staff realm guard (ADR-0017). Accepts ONLY staff session tokens (`kst_`). Consumer
 * credentials (opaque `kss_` or access JWTs) never authenticate here, and staff tokens never
 * authenticate consumer routes (the consumer guard does not understand them). Permission and
 * step-up checks are server-side; every denial is audited.
 */
@Injectable()
export class StaffAuthGuard implements CanActivate {
  private readonly logger = new Logger(StaffAuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly staffAuth: StaffAuthService,
    private readonly audit: AuditService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(STAFF_SESSION_OPTIONAL_KEY, targets)) return true;
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const principal = await this.staffAuth.resolve(bearer(request.headers.authorization));
    if (!principal) {
      this.logger.warn({ reason: 'no_staff_session' }, 'Rejected staff request');
      throw new ApiError('UNAUTHENTICATED', 'Authentication is required.');
    }
    request.staff = principal;
    const route = request.routeOptions.url ?? 'unknown';
    const required = this.reflector.getAllAndOverride<StaffPermission[] | undefined>(
      STAFF_PERMISSIONS_KEY,
      targets,
    );
    const missing = (required ?? []).filter((p) => !principal.permissions.includes(p));
    if (missing.length > 0) {
      await this.deny(principal, route, 'missing_permission', { missing: missing.join(',') });
      throw new ApiError('FORBIDDEN', 'You do not have permission to perform this action.');
    }
    if (this.reflector.getAllAndOverride<boolean>(STAFF_STEP_UP_KEY, targets)) {
      const age = Date.now() - principal.stepUpAt.getTime();
      if (age > this.env.STAFF_STEP_UP_MAX_AGE_SECONDS * 1000) {
        await this.deny(principal, route, 'step_up_required', {});
        throw new ApiError('STEP_UP_REQUIRED', 'Confirm with your security key to continue.', {
          nextOptions: ['STEP_UP'],
        });
      }
    }
    return true;
  }

  private deny(p: StaffPrincipal, route: string, reason: string, metadata: Record<string, string>) {
    return this.audit.recordBestEffort({
      actorType: 'STAFF',
      actorRef: p.staffId,
      action: 'staff.authz.denied',
      subjectType: 'route',
      subjectId: route,
      outcome: 'DENIED',
      policyDecision: 'staff-rbac:v1',
      reasonCode: reason,
      metadata,
    });
  }
}
