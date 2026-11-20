import type { LoginRequest, LoginResponse } from '@karen/api-contracts';
import { canonicalizeEmail } from '@karen/domain';
import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/api-error.js';
import { MailService } from '../infrastructure/mail/mail.service.js';
import { AccountService } from './account.service.js';
import { newSignInMail, verificationCodeMail } from './auth-emails.js';
import { ChallengeService } from './challenge.service.js';
import { EmailSendBudget } from './email-send-budget.js';
import { LoginThrottle } from './login-throttle.js';
import { SessionService } from './session.service.js';

/**
 * E-mail/password sign-in (Phase 01 M3, ADR-0015/0016).
 *
 * - Per-account throttle checked before any hashing; per-IP limiter on the route.
 * - Wrong e-mail and wrong password are indistinguishable (uniform Argon2id cost, one error).
 * - Account status is revealed only AFTER a correct password.
 * - A correct password on an unverified account returns a fresh verification challenge.
 */
@Injectable()
export class LoginService {
  constructor(
    private readonly accounts: AccountService,
    private readonly sessions: SessionService,
    private readonly challenges: ChallengeService,
    private readonly throttle: LoginThrottle,
    private readonly mail: MailService,
    private readonly budget: EmailSendBudget,
    private readonly audit: AuditService,
  ) {}

  async login(input: LoginRequest): Promise<LoginResponse> {
    const email = canonicalizeEmail(input.email);
    const throttleKey = email.ok ? email.canonical : input.email;
    await this.throttle.assertAllowed(throttleKey);

    const check = await this.accounts.checkPasswordCredential(input.email, input.password);
    if (check.outcome === 'INVALID') {
      await this.throttle.recordFailure(throttleKey);
      await this.audit.recordBestEffort({
        actorType: 'SYSTEM',
        actorRef: 'identity',
        action: 'identity.login.failed',
        outcome: 'DENIED',
        policyDecision: 'login:v1',
        reasonCode: 'invalid_credentials',
      });
      throw new ApiError('INVALID_CREDENTIALS', 'The e-mail or password is incorrect.');
    }
    await this.throttle.reset(throttleKey);
    const { userId, status } = check;

    switch (status) {
      case 'ACTIVE':
        break;
      case 'PENDING_VERIFICATION': {
        const challenge = await this.accounts.withUserTransaction(userId, (tx) =>
          this.challenges.issue(tx, userId, 'EMAIL_VERIFICATION'),
        );
        const address = await this.accounts.emailOf(userId);
        if (await this.budget.take(address.canonical)) {
          this.mail.dispatch(
            verificationCodeMail(address.display, challenge.code, challenge.expiresAt),
          );
        }
        return {
          result: 'verification_required',
          challenge: {
            challenge_handle: challenge.handle,
            expires_at: challenge.expiresAt.toISOString(),
            code_length: 6,
            delivery: 'email',
          },
        };
      }
      case 'LOCKED':
        throw this.inactive(
          userId,
          'locked',
          'For your security this account is locked. Reset your password to unlock it.',
          ['RESET_PASSWORD'],
        );
      case 'DELETION_REQUESTED':
        throw this.inactive(
          userId,
          'deletion_requested',
          'This account is scheduled for deletion.',
          ['CANCEL_DELETION'],
        );
      case 'SUSPENDED':
      case 'DELETED':
        throw this.inactive(userId, 'unavailable', 'This account is not available.', [
          'CONTACT_SUPPORT',
        ]);
    }

    const { response, newDevice, hadOtherDevices } = await this.sessions.create(
      userId,
      input.client,
      { installationId: input.device.installation_id, name: input.device.name },
      'password',
    );
    if (newDevice && hadOtherDevices) {
      const address = await this.accounts.emailOf(userId);
      this.mail.dispatch(newSignInMail(address.display, input.client));
    }
    return response;
  }

  private inactive(userId: string, reason: string, message: string, next: string[]): ApiError {
    void this.audit.recordBestEffort({
      actorType: 'USER',
      actorRef: userId,
      action: 'identity.login.refused',
      subjectType: 'user',
      subjectId: userId,
      outcome: 'DENIED',
      policyDecision: 'account-state:v1',
      reasonCode: reason,
    });
    return new ApiError('ACCOUNT_INACTIVE', message, { nextOptions: next });
  }
}
