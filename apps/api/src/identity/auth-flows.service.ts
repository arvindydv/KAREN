import type {
  AuthActionResult,
  AuthChallengeResponse,
  RegisterRequest,
  ResetPasswordRequest,
} from '@karen/api-contracts';
import { type AccountStatus, assertAccountTransition, canonicalizeEmail } from '@karen/domain';
import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/api-error.js';
import type { ChallengePurpose } from '../generated/prisma/client.js';
import type { TransactionClient } from '../infrastructure/database/prisma.service.js';
import { MailService } from '../infrastructure/mail/mail.service.js';
import { evaluatePassword } from '../security/password/password-policy.js';
import { AccountService } from './account.service.js';
import {
  accountExistsMail,
  passwordChangedMail,
  passwordResetCodeMail,
  verificationCodeMail,
} from './auth-emails.js';
import { ChallengeService, REFUSE } from './challenge.service.js';
import { EmailSendBudget } from './email-send-budget.js';

/** Accounts that may receive a password-reset code. */
const RECOVERABLE: ReadonlySet<AccountStatus> = new Set([
  'PENDING_VERIFICATION',
  'ACTIVE',
  'LOCKED',
  'DELETION_REQUESTED',
]);

const INVALID_CODE = () =>
  new ApiError('CHALLENGE_INVALID', 'That code is invalid or has expired. Request a new code.');

/**
 * Registration, e-mail verification and password reset (Phase 01 M2, ADR-0015).
 *
 * Enumeration resistance: register / resend / forgot return the same response shape whether or
 * not the address has an account, and e-mail is sent asynchronously so timing does not depend
 * on SMTP. A code only works together with the handle returned to the client that started the
 * flow (pre-account-takeover defence). A code never signs anyone in.
 */
@Injectable()
export class AuthFlowsService {
  constructor(
    private readonly accounts: AccountService,
    private readonly challenges: ChallengeService,
    private readonly mail: MailService,
    private readonly budget: EmailSendBudget,
    private readonly audit: AuditService,
  ) {}

  async register(input: RegisterRequest): Promise<AuthChallengeResponse> {
    const email = canonicalizeEmail(input.email);
    const result = await this.accounts.createPasswordAccount(
      {
        email: input.email,
        password: input.password,
        ...(input.locale ? { locale: input.locale } : {}),
        ...(input.timezone ? { timezone: validTimezone(input.timezone) } : {}),
      },
      (tx, userId) => this.challenges.issue(tx, userId, 'EMAIL_VERIFICATION'),
    );
    switch (result.outcome) {
      case 'INVALID_EMAIL':
        throw new ApiError('VALIDATION_FAILED', 'Enter a valid e-mail address.', {
          details: [{ path: 'email', message: result.reason }],
        });
      case 'WEAK_PASSWORD':
        throw weakPassword(result.reasons, 'password');
      case 'CREATED': {
        if (email.ok && (await this.budget.take(email.canonical))) {
          this.mail.dispatch(
            verificationCodeMail(email.display, result.created.code, result.created.expiresAt),
          );
        }
        return challengeResponse(result.created.handle, result.created.expiresAt);
      }
      case 'EMAIL_UNAVAILABLE': {
        // Tell the mailbox owner (not the requester) and return an indistinguishable decoy.
        if (email.ok && (await this.budget.take(email.canonical))) {
          this.mail.dispatch(accountExistsMail(email.display));
        }
        const decoy = this.challenges.decoy('EMAIL_VERIFICATION');
        return challengeResponse(decoy.handle, decoy.expiresAt);
      }
    }
  }

  async verifyEmail(handle: string, code: string): Promise<AuthActionResult> {
    const result = await this.challenges.check(
      handle,
      code,
      'EMAIL_VERIFICATION',
      async (tx, { challengeId, userId }) => {
        await this.challenges.consume(tx, challengeId);
        await tx.userEmail.updateMany({
          where: { userId, verifiedAt: null },
          data: { verifiedAt: new Date(), version: { increment: 1 } },
        });
        await this.activateIfPending(tx, userId, 'email_verified');
        await this.audit.record(
          {
            actorType: 'USER',
            actorRef: userId,
            action: 'identity.email.verified',
            subjectType: 'user',
            subjectId: userId,
            outcome: 'SUCCESS',
            reasonCode: 'otp_email',
          },
          tx,
        );
        return true;
      },
    );
    if (!result.ok) throw INVALID_CODE();
    return { status: 'email_verified', next: 'sign_in' };
  }

  async resend(handle: string): Promise<AuthChallengeResponse> {
    const purpose = ChallengeService.purposeOf(handle);
    const rotated = purpose ? await this.challenges.rotate(handle, purpose) : null;
    if (!purpose || !rotated) {
      // Unknown, closed or exhausted: same response, nothing sent.
      return challengeResponse(handle, this.challenges.decoy('EMAIL_VERIFICATION').expiresAt);
    }
    const email = await this.accounts.emailOf(rotated.userId);
    if (await this.budget.take(email.canonical)) {
      this.mail.dispatch(mailFor(purpose, email.display, rotated.code, rotated.expiresAt));
    }
    return challengeResponse(handle, rotated.expiresAt);
  }

  async forgotPassword(rawEmail: string): Promise<AuthChallengeResponse> {
    const email = canonicalizeEmail(rawEmail);
    if (!email.ok) {
      throw new ApiError('VALIDATION_FAILED', 'Enter a valid e-mail address.', {
        details: [{ path: 'email', message: email.reason }],
      });
    }
    const account = await this.accounts.findAccountByEmail(email.canonical);
    if (account && RECOVERABLE.has(account.status) && (await this.budget.take(email.canonical))) {
      const issued = await this.prismaScope(account.userId, async (tx) => {
        const challenge = await this.challenges.issue(tx, account.userId, 'PASSWORD_RESET');
        await this.audit.record(
          {
            actorType: 'USER',
            actorRef: account.userId,
            action: 'identity.password_reset.requested',
            subjectType: 'user',
            subjectId: account.userId,
            outcome: 'SUCCESS',
            reasonCode: 'otp_email',
          },
          tx,
        );
        return challenge;
      });
      this.mail.dispatch(passwordResetCodeMail(email.display, issued.code, issued.expiresAt));
      return challengeResponse(issued.handle, issued.expiresAt);
    }
    const decoy = this.challenges.decoy('PASSWORD_RESET');
    return challengeResponse(decoy.handle, decoy.expiresAt);
  }

  async resetPassword(input: ResetPasswordRequest): Promise<AuthActionResult> {
    // Phase 1: prove the code (counts attempts; consumes nothing).
    const proof = await this.challenges.check(
      input.challenge_handle,
      input.code,
      'PASSWORD_RESET',
      () => Promise.resolve(true),
    );
    if (!proof.ok) throw INVALID_CODE();
    const email = await this.accounts.emailOf(proof.userId);
    const policy = evaluatePassword(input.new_password, { email: email.canonical });
    // Weak password: the code stays valid so the user can pick another password.
    if (!policy.ok) throw weakPassword(policy.reasons, 'new_password');
    // Hash outside any transaction (never hold a connection during Argon2id).
    const credential = await this.accounts.hashNormalizedPassword(policy.normalized);

    // Phase 2: re-check under lock and apply atomically. A concurrent reset with the same code
    // serializes on the row lock and finds it consumed.
    const applied = await this.challenges.check(
      input.challenge_handle,
      input.code,
      'PASSWORD_RESET',
      async (tx, { challengeId, userId }) => {
        const user = await tx.user.findUniqueOrThrow({
          where: { id: userId },
          select: { status: true },
        });
        if (!RECOVERABLE.has(user.status)) return REFUSE;
        await this.challenges.consume(tx, challengeId);
        // Any other open code (including an attacker's pending sign-up verification) dies here.
        await this.challenges.closeOpen(tx, userId, ['PASSWORD_RESET', 'EMAIL_VERIFICATION']);
        await tx.passwordCredential.upsert({
          where: { userId },
          create: {
            userId,
            passwordHash: credential.hash,
            pepperId: credential.pepperId,
            scheme: credential.scheme,
          },
          update: {
            passwordHash: credential.hash,
            pepperId: credential.pepperId,
            scheme: credential.scheme,
            passwordChangedAt: new Date(),
            version: { increment: 1 },
          },
        });
        // Completing a reset proves mailbox ownership.
        await tx.userEmail.updateMany({
          where: { userId, verifiedAt: null },
          data: { verifiedAt: new Date(), version: { increment: 1 } },
        });
        if (user.status === 'LOCKED') await this.transition(tx, userId, 'LOCKED', 'ACTIVE');
        await this.activateIfPending(tx, userId, 'password_reset');
        await this.audit.record(
          {
            actorType: 'USER',
            actorRef: userId,
            action: 'identity.password.reset',
            subjectType: 'user',
            subjectId: userId,
            outcome: 'SUCCESS',
            reasonCode: 'otp_email',
            metadata: { previous_status: user.status },
          },
          tx,
        );
        // NOTE (M3): revoke all sessions here once sessions exist.
        return true;
      },
    );
    if (!applied.ok) throw INVALID_CODE();
    this.mail.dispatch(passwordChangedMail(email.display));
    return { status: 'password_reset', next: 'sign_in' };
  }

  private async activateIfPending(
    tx: TransactionClient,
    userId: string,
    reason: string,
  ): Promise<void> {
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { status: true },
    });
    if (user.status !== 'PENDING_VERIFICATION') return;
    await this.transition(tx, userId, 'PENDING_VERIFICATION', 'ACTIVE', reason);
  }

  private async transition(
    tx: TransactionClient,
    userId: string,
    from: AccountStatus,
    to: AccountStatus,
    reason = 'account_recovered',
  ): Promise<void> {
    assertAccountTransition(from, to);
    const updated = await tx.user.updateMany({
      where: { id: userId, status: from },
      data: { status: to, version: { increment: 1 } },
    });
    if (updated.count !== 1) {
      throw new ApiError('CONFLICT', 'The account changed concurrently. Please retry.', {
        retryable: true,
      });
    }
    await this.audit.record(
      {
        actorType: 'USER',
        actorRef: userId,
        action: 'identity.account.status_changed',
        subjectType: 'user',
        subjectId: userId,
        outcome: 'SUCCESS',
        policyDecision: 'account-state:v1',
        reasonCode: reason,
        metadata: { from, to },
      },
      tx,
    );
  }

  private prismaScope<T>(userId: string, fn: (tx: TransactionClient) => Promise<T>): Promise<T> {
    return this.accounts.withUserTransaction(userId, fn);
  }
}

function challengeResponse(handle: string, expiresAt: Date): AuthChallengeResponse {
  return {
    challenge_handle: handle,
    expires_at: expiresAt.toISOString(),
    code_length: 6,
    delivery: 'email',
  };
}

function weakPassword(reasons: string[], path: string): ApiError {
  return new ApiError('WEAK_PASSWORD', 'Choose a longer or less common password.', {
    details: reasons.map((message) => ({ path, message })),
  });
}

function mailFor(purpose: ChallengePurpose, to: string, code: string, expiresAt: Date) {
  return purpose === 'PASSWORD_RESET'
    ? passwordResetCodeMail(to, code, expiresAt)
    : verificationCodeMail(to, code, expiresAt);
}

function validTimezone(tz: string): string {
  if (!Intl.supportedValuesOf('timeZone').includes(tz) && tz !== 'UTC') {
    throw new ApiError('VALIDATION_FAILED', 'Unknown time zone.', {
      details: [{ path: 'timezone', message: 'unknown_time_zone' }],
    });
  }
  return tz;
}
