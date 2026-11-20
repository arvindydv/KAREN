import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/api-error.js';
import { AccountService } from './account.service.js';
import { LoginThrottle } from './login-throttle.js';

/**
 * "Prove it's you again" for sensitive operations (e-mail/password change, account deletion):
 * the current password, checked with the same per-account throttle as sign-in, audited on
 * failure. Returns the account's canonical e-mail for convenience.
 */
@Injectable()
export class ReauthService {
  constructor(
    private readonly accounts: AccountService,
    private readonly throttle: LoginThrottle,
    private readonly audit: AuditService,
  ) {}

  async verify(userId: string, password: string): Promise<{ display: string; canonical: string }> {
    const email = await this.accounts.emailOf(userId);
    await this.throttle.assertAllowed(email.canonical);
    const check = await this.accounts.checkPasswordCredential(email.canonical, password);
    if (check.outcome !== 'VALID' || check.userId !== userId) {
      await this.throttle.recordFailure(email.canonical);
      await this.audit.recordBestEffort({
        actorType: 'USER',
        actorRef: userId,
        action: 'identity.reauth.failed',
        subjectType: 'user',
        subjectId: userId,
        outcome: 'DENIED',
        policyDecision: 'reauth:v1',
        reasonCode: 'invalid_credentials',
      });
      throw new ApiError('INVALID_CREDENTIALS', 'Your current password is incorrect.');
    }
    await this.throttle.reset(email.canonical);
    return email;
  }
}
