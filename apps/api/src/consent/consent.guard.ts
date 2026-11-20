import type { ConsentPurpose } from '@karen/domain';
import { type CanActivate, type ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/api-error.js';
import { ConsentService } from './consent.service.js';

export const REQUIRED_CONSENT = 'karen:requiredConsent';

/**
 * Route-level consent enforcement: every listed purpose must be ACTIVELY granted (checked in
 * PostgreSQL on each request — not a UI toggle). Runs after AuthGuard/PermissionsGuard.
 * Missing consent → 403 CONSENT_REQUIRED, audited. Features that process data under a purpose
 * (AI chat, memory, proactivity — Phase 02+) MUST use this or ConsentService.requireConsent.
 */
export const RequireConsent = (...purposes: ConsentPurpose[]) =>
  SetMetadata(REQUIRED_CONSENT, purposes);

@Injectable()
export class ConsentGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly consent: ConsentService,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const purposes = this.reflector.getAllAndOverride<ConsentPurpose[] | undefined>(
      REQUIRED_CONSENT,
      [context.getHandler(), context.getClass()],
    );
    if (!purposes || purposes.length === 0) return true;
    const principal = context.switchToHttp().getRequest<FastifyRequest>().principal;
    if (!principal) throw new ApiError('UNAUTHENTICATED', 'Authentication is required.');
    for (const purpose of purposes) {
      if (!(await this.consent.hasActiveConsent(principal.userId, purpose))) {
        await this.audit.recordBestEffort({
          actorType: 'USER',
          actorRef: principal.userId,
          action: 'consent.required_denied',
          subjectType: 'consent_purpose',
          subjectId: purpose,
          outcome: 'DENIED',
          policyDecision: 'consent:v1',
          reasonCode: 'consent_absent',
        });
        throw new ApiError('CONSENT_REQUIRED', 'This needs your permission first.', {
          nextOptions: [`GRANT_CONSENT:${purpose}`],
        });
      }
    }
    return true;
  }
}
