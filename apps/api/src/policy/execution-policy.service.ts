import { decideExecution, type ConsentPurpose, type ExecutionDecision } from '@karen/domain';
import { Inject, Injectable } from '@nestjs/common';
import { API_ENV } from '../config/config.module.js';
import type { ApiEnv } from '../config/env.js';
import { ConsentService } from '../consent/consent.service.js';

export interface ExecutionCheck {
  userId: string;
  /** Possibly model-proposed and therefore untrusted. */
  category: string;
  consentPurpose: ConsentPurpose;
  consentScope?: string;
  validApprovalPresent: boolean;
  providerSupportsOperation: boolean;
  userAllowsAutonomyForCategory?: boolean;
}

/**
 * Composes server-side facts (consent, global kill switch, provider capability, approval)
 * with the pure domain policy. Model output can never bypass this: it only ever supplies an
 * untrusted category string, which unknown values turn into PROHIBITED.
 */
@Injectable()
export class ExecutionPolicyService {
  constructor(
    private readonly consent: ConsentService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  get executionPaused(): boolean {
    return this.env.KAREN_EXECUTION_PAUSED;
  }

  async decide(check: ExecutionCheck): Promise<ExecutionDecision> {
    const consentGranted = await this.consent.hasActiveConsent(
      check.userId,
      check.consentPurpose,
      check.consentScope,
    );
    return decideExecution({
      category: check.category,
      consentGranted,
      validApprovalPresent: check.validApprovalPresent,
      executionPaused: this.executionPaused,
      providerSupportsOperation: check.providerSupportsOperation,
      ...(check.userAllowsAutonomyForCategory !== undefined
        ? { userAllowsAutonomyForCategory: check.userAllowsAutonomyForCategory }
        : {}),
    });
  }
}
