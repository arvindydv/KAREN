import { randomUUID } from 'node:crypto';
import type { PasswordRejection } from '@karen/api-contracts';
import {
  type AccountStatus,
  type EmailRejection,
  assertAccountTransition,
  canonicalizeEmail,
} from '@karen/domain';
import { pseudonymizeUserId } from '@karen/observability';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/api-error.js';
import { API_ENV } from '../config/config.module.js';
import type { ApiEnv } from '../config/env.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  PrismaService,
  type TransactionClient,
} from '../infrastructure/database/prisma.service.js';
import { GateSaturatedError } from '../security/concurrency-gate.js';
import { PasswordHasher, type StoredPasswordHash } from '../security/password/password-hasher.js';
import { SessionService } from './session.service.js';
import {
  PASSWORD_RAW_MAX_UNITS,
  evaluatePassword,
  normalizePassword,
} from '../security/password/password-policy.js';

const LOCAL_PSEUDONYMIZATION_KEY = 'local-only-pseudonymization-key';

export type CreateAccountResult<T = undefined> =
  | { outcome: 'CREATED'; userId: string; created: T }
  /** Canonical e-mail already belongs to an account. Callers MUST NOT reveal this (M2). */
  | { outcome: 'EMAIL_UNAVAILABLE' }
  | { outcome: 'INVALID_EMAIL'; reason: EmailRejection }
  | { outcome: 'WEAK_PASSWORD'; reasons: PasswordRejection[] };

export type CredentialCheckResult =
  | { outcome: 'VALID'; userId: string; status: AccountStatus; emailVerified: boolean }
  | { outcome: 'INVALID' };

export interface CreateAccountInput {
  email: string;
  password: string;
  locale?: string;
  timezone?: string;
}

export interface StatusActor {
  actorType: 'USER' | 'STAFF' | 'SYSTEM';
  /** Internal UUID or service name — never an e-mail. */
  actorRef: string;
  /** Machine-readable reason, e.g. `email_verified`, `suspected_compromise`. */
  reasonCode: string;
}

interface LoginRow {
  user_id: string;
  status: AccountStatus;
  email_verified: boolean;
  password_hash: string | null;
  pepper_id: string | null;
  scheme: string | null;
  credential_version: number | null;
}

/**
 * Explicit account provisioning and password credential checks (ADR-0015, Phase 01 M1).
 *
 * Accounts are created ONLY here — never as a side effect of authenticating a request (the
 * previous guard-based auto-provisioning is removed). Every write happens in one
 * transaction inside the new user's RLS scope, with the audit row in the same transaction.
 */
@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);
  private readonly pseudonymKey: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly hasher: PasswordHasher,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
    @Inject(API_ENV) env: ApiEnv,
  ) {
    this.pseudonymKey = env.LOG_PSEUDONYMIZATION_KEY ?? LOCAL_PSEUDONYMIZATION_KEY;
  }

  /**
   * Creates a PENDING_VERIFICATION account with an e-mail and password credential.
   * Concurrency: the unique canonical-e-mail index decides races; exactly one concurrent
   * registration wins and the others get EMAIL_UNAVAILABLE with nothing left behind.
   * Retries after a lost response are therefore safe (the retry sees EMAIL_UNAVAILABLE and
   * the M2 endpoint answers both cases identically).
   */
  async createPasswordAccount<T = undefined>(
    input: CreateAccountInput,
    /** Runs inside the creating transaction (e.g. issue the verification challenge atomically). */
    onCreated?: (tx: TransactionClient, userId: string) => Promise<T>,
  ): Promise<CreateAccountResult<T>> {
    const email = canonicalizeEmail(input.email);
    if (!email.ok) return { outcome: 'INVALID_EMAIL', reason: email.reason };
    const policy = evaluatePassword(input.password, { email: email.canonical });
    if (!policy.ok) return { outcome: 'WEAK_PASSWORD', reasons: policy.reasons };

    // Hash BEFORE opening the transaction: never hold a DB connection during ~50 ms of CPU.
    // Hashing also runs for already-registered e-mails, so response timing does not reveal them.
    const credential = await this.gated(() => this.hasher.hash(policy.normalized));
    const userId = randomUUID();
    let created: T;
    try {
      created = await this.prisma.withUserScope(userId, async (tx) => {
        await tx.user.create({
          data: {
            id: userId,
            status: 'PENDING_VERIFICATION',
            ...(input.locale ? { locale: input.locale } : {}),
            ...(input.timezone ? { timezone: input.timezone } : {}),
          },
        });
        await tx.userEmail.create({
          data: { userId, email: email.display, emailCanonical: email.canonical },
        });
        await tx.passwordCredential.create({
          data: {
            userId,
            passwordHash: credential.hash,
            pepperId: credential.pepperId,
            scheme: credential.scheme,
          },
        });
        await this.audit.record(
          {
            actorType: 'USER',
            actorRef: userId,
            action: 'identity.account.created',
            subjectType: 'user',
            subjectId: userId,
            outcome: 'SUCCESS',
            reasonCode: 'password_registration',
          },
          tx,
        );
        return onCreated ? onCreated(tx, userId) : (undefined as T);
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        await this.audit.recordBestEffort({
          actorType: 'SYSTEM',
          actorRef: 'identity',
          action: 'identity.account.create_rejected',
          subjectType: 'user',
          outcome: 'DENIED',
          policyDecision: 'identity:v1',
          reasonCode: 'email_unavailable',
        });
        return { outcome: 'EMAIL_UNAVAILABLE' };
      }
      throw error;
    }
    return { outcome: 'CREATED', userId, created };
  }

  /** Pre-auth recovery lookup by canonical e-mail (exact match, no enumeration). */
  async findAccountByEmail(
    canonicalEmail: string,
  ): Promise<{ userId: string; status: AccountStatus } | null> {
    const rows = await this.prisma.$queryRaw<{ user_id: string; status: AccountStatus }[]>`
      SELECT user_id, status::text AS status FROM identity.lookup_password_login(${canonicalEmail})`;
    const row = rows[0];
    return row ? { userId: row.user_id, status: row.status } : null;
  }

  /** The account's e-mail (display + canonical), read inside the user's RLS scope. */
  async emailOf(userId: string): Promise<{ display: string; canonical: string }> {
    const row = await this.prisma.withUserScope(userId, (tx) =>
      tx.userEmail.findUniqueOrThrow({
        where: { userId },
        select: { email: true, emailCanonical: true },
      }),
    );
    return { display: row.email, canonical: row.emailCanonical };
  }

  /** Run `fn` in a transaction scoped to `userId` (RLS). */
  withUserTransaction<T>(userId: string, fn: (tx: TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.withUserScope(userId, fn);
  }

  /** Hash an already policy-checked, normalized password (bounded by the hashing gate). */
  hashNormalizedPassword(normalized: string): Promise<StoredPasswordHash> {
    return this.gated(() => this.hasher.hash(normalized));
  }

  /**
   * Checks an e-mail/password pair. Uniform cost: unknown e-mails, malformed input and
   * accounts without a password all perform one full dummy Argon2id verification, so timing
   * does not distinguish them from a wrong password. Does NOT decide access — the caller
   * applies `accountAccessLevel(status)` and must reveal status only after VALID.
   * Upgrades outdated hashes (params/pepper) after a successful check.
   */
  async checkPasswordCredential(
    rawEmail: string,
    rawPassword: string,
  ): Promise<CredentialCheckResult> {
    // Oversized input is never normalized or hashed as-is; the cost stays uniform.
    const bounded = rawPassword.length <= PASSWORD_RAW_MAX_UNITS;
    const email = canonicalizeEmail(rawEmail);
    const password = bounded ? normalizePassword(rawPassword) : null;
    if (!email.ok || password === null) {
      await this.gated(() => this.hasher.verifyDummy(bounded ? rawPassword : ''));
      return { outcome: 'INVALID' };
    }
    const rows = await this.prisma.$queryRaw<LoginRow[]>`
      SELECT user_id, status::text AS status, email_verified, password_hash, pepper_id, scheme,
             credential_version
      FROM identity.lookup_password_login(${email.canonical})`;
    const row = rows[0];
    if (!row?.password_hash || !row.scheme || row.credential_version === null) {
      await this.gated(() => this.hasher.verifyDummy(password));
      return { outcome: 'INVALID' };
    }
    const stored: StoredPasswordHash = {
      hash: row.password_hash,
      pepperId: row.pepper_id,
      scheme: row.scheme,
    };
    const result = await this.gated(() => this.hasher.verify(password, stored));
    if (!result.valid) return { outcome: 'INVALID' };
    if (result.needsRehash) await this.upgradeHash(row.user_id, row.credential_version, password);
    return {
      outcome: 'VALID',
      userId: row.user_id,
      status: row.status,
      emailVerified: row.email_verified,
    };
  }

  /**
   * Applies an account status transition with optimistic concurrency, validated by the domain
   * state machine (and again by the database trigger). Audited in the same transaction.
   */
  async transitionStatus(userId: string, to: AccountStatus, actor: StatusActor): Promise<void> {
    await this.prisma.withUserScope(userId, async (tx) => {
      const current = await tx.user.findUnique({
        where: { id: userId },
        select: { status: true, version: true },
      });
      if (!current) throw new ApiError('NOT_FOUND', 'Account not found.');
      assertAccountTransition(current.status, to);
      const updated = await tx.user.updateMany({
        where: { id: userId, version: current.version, status: current.status },
        data: { status: to, version: { increment: 1 } },
      });
      if (updated.count !== 1) {
        throw new ApiError('CONFLICT', 'The account changed concurrently. Please retry.', {
          retryable: true,
        });
      }
      // Leaving ACTIVE ends every session in the same transaction (no window of access).
      if (to !== 'ACTIVE') await this.sessions.revokeInTx(tx, userId, {}, 'account_status');
      await this.audit.record(
        {
          actorType: actor.actorType,
          actorRef: actor.actorRef,
          action: 'identity.account.status_changed',
          subjectType: 'user',
          subjectId: userId,
          outcome: 'SUCCESS',
          policyDecision: 'account-state:v1',
          reasonCode: actor.reasonCode,
          metadata: { from: current.status, to },
        },
        tx,
      );
    });
  }

  /**
   * Re-hashes with current parameters/pepper. Guarded by the credential version so it can
   * never overwrite a password changed concurrently. A failure here does not fail sign-in
   * (the old hash is still valid) but is logged — never silently ignored.
   */
  private async upgradeHash(userId: string, version: number, password: string): Promise<void> {
    try {
      const next = await this.hasher.hash(password);
      const updated = await this.prisma.withUserScope(userId, (tx) =>
        tx.passwordCredential.updateMany({
          where: { userId, version },
          data: {
            passwordHash: next.hash,
            pepperId: next.pepperId,
            scheme: next.scheme,
            version: { increment: 1 },
          },
        }),
      );
      if (updated.count === 1) {
        this.logger.log({ user_ref: this.userRef(userId) }, 'Password hash upgraded');
      }
    } catch (error) {
      this.logger.warn(
        { err: error, user_ref: this.userRef(userId) },
        'Password hash upgrade failed; old hash remains valid',
      );
    }
  }

  /** Hashing capacity exhausted → retryable 503. Never queue unbounded work or weaken params. */
  private async gated<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof GateSaturatedError) {
        this.logger.warn({ reason: error.reason }, 'Password hashing capacity exhausted');
        throw new ApiError(
          'DEPENDENCY_UNAVAILABLE',
          'Sign-in is busy right now. Please retry in a moment.',
          { retryable: true, cause: error },
        );
      }
      throw error;
    }
  }

  private userRef(userId: string): string {
    return pseudonymizeUserId(userId, this.pseudonymKey);
  }
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
