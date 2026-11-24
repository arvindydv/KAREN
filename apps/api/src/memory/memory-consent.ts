import { Inject, Injectable } from '@nestjs/common';
import { ApiError } from '../common/api-error.js';
import { API_ENV } from '../config/config.module.js';
import type { ApiEnv } from '../config/env.js';
import type { TransactionClient } from '../infrastructure/database/prisma.service.js';

export type MemoryConsentState = 'eligible' | 'not_granted' | 'reconfirm_required';

export const memoryConsentRequired = () =>
  new ApiError('CONSENT_REQUIRED', 'Turn on “Remember things about me” to save memories.', {
    nextOptions: ['GRANT_CONSENT:MEMORY_STORAGE'],
  });

/**
 * MEMORY_STORAGE eligibility (arch §3.1, D5): ACTIVE, unexpired, and granted against a notice
 * version in MEMORY_CONSENT_ELIGIBLE_POLICY_VERSIONS. An ACTIVE grant on an older notice is
 * `reconfirm_required` and behaves exactly like no grant.
 *
 * Always evaluated on the caller's transaction (RLS scope + explicit user filter), after the
 * caller locked `identity.users` (lock-order invariant, §5.4), so a concurrent revoke —
 * `ConsentService.decide()` holds that row FOR UPDATE — is either fully before or fully after.
 */
@Injectable()
export class MemoryConsentService {
  private readonly eligibleVersions: ReadonlySet<string>;

  constructor(@Inject(API_ENV) env: ApiEnv) {
    this.eligibleVersions = new Set(env.MEMORY_CONSENT_ELIGIBLE_POLICY_VERSIONS);
  }

  async stateInTx(tx: TransactionClient, userId: string): Promise<MemoryConsentState> {
    const grant = await tx.consentGrant.findFirst({
      where: {
        userId,
        purpose: 'MEMORY_STORAGE',
        scope: '*',
        status: 'ACTIVE',
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: { policyVersion: true },
    });
    if (!grant) return 'not_granted';
    return this.eligibleVersions.has(grant.policyVersion) ? 'eligible' : 'reconfirm_required';
  }

  async isEligibleInTx(tx: TransactionClient, userId: string): Promise<boolean> {
    return (await this.stateInTx(tx, userId)) === 'eligible';
  }

  async requireEligibleInTx(tx: TransactionClient, userId: string): Promise<void> {
    if (!(await this.isEligibleInTx(tx, userId))) throw memoryConsentRequired();
  }
}

/**
 * Lock-order invariant (arch §2.3 item 5, §5.4): every transaction that touches `memory.*` rows
 * first locks the user's `identity.users` row. FOR SHARE in memory write paths.
 */
export async function lockUserForMemory(tx: TransactionClient, userId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM identity.users WHERE id = ${userId}::uuid FOR SHARE`;
  if (rows.length !== 1) throw new ApiError('UNAUTHENTICATED', 'Authentication is required.');
}
