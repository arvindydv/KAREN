import type { Permission } from '@karen/api-contracts';
import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { ApiError } from '../common/api-error.js';
import type { AuthenticatedPrincipal } from './principal.js';

export const IS_PUBLIC = 'karen:isPublic';
export const REQUIRED_PERMISSIONS = 'karen:requiredPermissions';
export const ALLOW_DELETION_PENDING = 'karen:allowDeletionPending';

/**
 * Lets a session of an account in DELETION_REQUESTED reach this route (view/cancel the pending
 * deletion, sign out). Every other route refuses such sessions with ACCOUNT_INACTIVE.
 */
export const AllowDeletionPending = () => SetMetadata(ALLOW_DELETION_PENDING, true);

/** Opt a route out of authentication (health checks, dev token issuance). Use sparingly. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Require ALL listed permissions (checked server-side from DB role grants). */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(REQUIRED_PERMISSIONS, permissions);

export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedPrincipal => {
    const principal = ctx.switchToHttp().getRequest<FastifyRequest>().principal;
    if (!principal) throw new ApiError('UNAUTHENTICATED', 'Authentication is required.');
    return principal;
  },
);
