import { createHmac, randomInt } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { API_ENV } from '../config/config.module.js';
import type { ApiEnv } from '../config/env.js';
import type { ChallengePurpose } from '../generated/prisma/client.js';
import {
  PrismaService,
  type TransactionClient,
} from '../infrastructure/database/prisma.service.js';
import {
  issueOpaqueToken,
  type OpaqueTokenKind,
  parseOpaqueToken,
  verifiersEqual,
} from '../security/opaque-token.js';

export const CHALLENGE_TTL_MS = 15 * 60 * 1000;
export const CHALLENGE_MAX_ATTEMPTS = 5;
export const CHALLENGE_MAX_SENDS = 5;
const LOCAL_OTP_KEY = 'local-only-otp-hmac-key-not-a-secret-0000';

const KIND: Record<ChallengePurpose, OpaqueTokenKind> = {
  EMAIL_VERIFICATION: 'verification',
  PASSWORD_RESET: 'reset',
};

export interface IssuedChallenge {
  /** Give to the client once. Never log. */
  handle: string;
  /** Put in the e-mail only. Never log, never store. */
  code: string;
  expiresAt: Date;
}

export interface ChallengeContext {
  challengeId: string;
  userId: string;
}

export type ChallengeCheck<T> = { ok: true; userId: string; value: T } | { ok: false };

interface ChallengeRow {
  id: string;
  user_id: string;
  purpose: ChallengePurpose;
  code_mac: string;
  attempts: number;
  max_attempts: number;
  send_count: number;
  expires_at: Date;
  closed_at: Date | null;
}

/**
 * One-time e-mail codes (6 digits) bound to an opaque, client-held handle (ADR-0015).
 *
 * - Only verifiers are stored: SHA-256(handle) and HMAC-SHA256(OTP_HMAC_KEY, handle‖code).
 * - ≤ 5 wrong attempts per challenge, then it is closed (`attempts_exhausted`); 15 min expiry;
 *   ≤ 5 sends per challenge (resend rotates the code and resets attempts).
 * - Issuing a challenge supersedes the user's other open challenges of the same purpose.
 * - Every check locks the row (`FOR UPDATE`), so concurrent checks of one code serialize and a
 *   code can be consumed exactly once.
 * - Unknown, malformed, expired, closed and wrong-code cases are indistinguishable to callers.
 */
@Injectable()
export class ChallengeService {
  private readonly logger = new Logger(ChallengeService.name);
  private readonly key: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(API_ENV) env: ApiEnv,
  ) {
    // Config validation requires a real key in deployed environments.
    this.key = env.OTP_HMAC_KEY ?? LOCAL_OTP_KEY;
  }

  /** Issue inside the caller's transaction (already scoped to `userId`). */
  async issue(
    tx: TransactionClient,
    userId: string,
    purpose: ChallengePurpose,
  ): Promise<IssuedChallenge> {
    await tx.verificationChallenge.updateMany({
      where: { userId, purpose, closedAt: null },
      data: { closedAt: new Date(), closeReason: 'superseded' },
    });
    const { token, verifier } = issueOpaqueToken(KIND[purpose]);
    const code = newCode();
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);
    await tx.verificationChallenge.create({
      data: {
        userId,
        purpose,
        handleVerifier: verifier,
        codeMac: this.mac(verifier, code),
        maxAttempts: CHALLENGE_MAX_ATTEMPTS,
        expiresAt,
      },
    });
    return { handle: token, code, expiresAt };
  }

  /** Close the user's other open challenges (e.g. after a password reset). */
  async closeOpen(
    tx: TransactionClient,
    userId: string,
    purposes: ChallengePurpose[],
  ): Promise<void> {
    await tx.verificationChallenge.updateMany({
      where: { userId, purpose: { in: purposes }, closedAt: null },
      data: { closedAt: new Date(), closeReason: 'superseded' },
    });
  }

  /**
   * Checks a code. Wrong codes count an attempt (committed even though the check fails).
   * On success runs `onSuccess` in the same transaction while the row is locked; it decides
   * whether to consume (call `consume`), or returns `REFUSE` to fail without consuming.
   */
  async check<T>(
    handle: string,
    code: string,
    purpose: ChallengePurpose,
    onSuccess: (tx: TransactionClient, ctx: ChallengeContext) => Promise<T | typeof REFUSE>,
  ): Promise<ChallengeCheck<T>> {
    const located = await this.locate(handle, purpose);
    if (!located) return { ok: false };
    return this.prisma.withUserScope(located.userId, async (tx) => {
      const row = await this.lockRow(tx, located.challengeId);
      if (!row || row.purpose !== purpose || row.closed_at !== null) return { ok: false };
      if (row.expires_at.getTime() <= Date.now()) return { ok: false };
      const presented = /^\d{6}$/.test(code)
        ? this.mac(locatedVerifier(handle, purpose), code)
        : '';
      if (!verifiersEqual(presented, row.code_mac)) {
        const attempts = row.attempts + 1;
        const exhausted = attempts >= row.max_attempts;
        await tx.verificationChallenge.update({
          where: { id: row.id },
          data: {
            attempts,
            ...(exhausted ? { closedAt: new Date(), closeReason: 'attempts_exhausted' } : {}),
          },
        });
        await this.audit.record(
          {
            actorType: 'USER',
            actorRef: row.user_id,
            action: 'identity.challenge.failed',
            subjectType: 'user',
            subjectId: row.user_id,
            outcome: 'DENIED',
            policyDecision: 'challenge:v1',
            reasonCode: exhausted ? 'attempts_exhausted' : 'code_mismatch',
            metadata: { purpose, attempts },
          },
          tx,
        );
        return { ok: false };
      }
      const value = await onSuccess(tx, { challengeId: row.id, userId: row.user_id });
      if (value === REFUSE) return { ok: false };
      return { ok: true, userId: row.user_id, value };
    });
  }

  /** Mark the challenge used. Call from `onSuccess`. */
  async consume(tx: TransactionClient, challengeId: string): Promise<void> {
    await tx.verificationChallenge.update({
      where: { id: challengeId },
      data: { closedAt: new Date(), closeReason: 'consumed' },
    });
  }

  /**
   * Resend: rotates the code (new code, attempts reset, fresh expiry) on an open challenge
   * that has sends left. Returns null for unknown/closed/exhausted handles.
   */
  async rotate(
    handle: string,
    purpose: ChallengePurpose,
  ): Promise<{ userId: string; code: string; expiresAt: Date } | null> {
    const located = await this.locate(handle, purpose);
    if (!located) return null;
    return this.prisma.withUserScope(located.userId, async (tx) => {
      const row = await this.lockRow(tx, located.challengeId);
      if (!row || row.purpose !== purpose || row.closed_at !== null) return null;
      if (row.send_count >= CHALLENGE_MAX_SENDS) return null;
      const code = newCode();
      const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);
      await tx.verificationChallenge.update({
        where: { id: row.id },
        data: {
          codeMac: this.mac(locatedVerifier(handle, purpose), code),
          attempts: 0,
          sendCount: row.send_count + 1,
          expiresAt,
        },
      });
      return { userId: row.user_id, code, expiresAt };
    });
  }

  /** A syntactically valid handle that matches nothing (enumeration-resistant responses). */
  decoy(purpose: ChallengePurpose): { handle: string; expiresAt: Date } {
    return {
      handle: issueOpaqueToken(KIND[purpose]).token,
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    };
  }

  /** Which purpose a handle was issued for (by its type prefix), or null. */
  static purposeOf(handle: string): ChallengePurpose | null {
    if (parseOpaqueToken('verification', handle)) return 'EMAIL_VERIFICATION';
    if (parseOpaqueToken('reset', handle)) return 'PASSWORD_RESET';
    return null;
  }

  private async locate(
    handle: string,
    purpose: ChallengePurpose,
  ): Promise<ChallengeContext | null> {
    const verifier = parseOpaqueToken(KIND[purpose], handle);
    if (!verifier) return null;
    const rows = await this.prisma.$queryRaw<{ challenge_id: string; user_id: string }[]>`
      SELECT challenge_id, user_id FROM identity.lookup_challenge(${verifier})`;
    const row = rows[0];
    if (!row) {
      this.logger.debug({ purpose }, 'Challenge handle not found');
      return null;
    }
    return { challengeId: row.challenge_id, userId: row.user_id };
  }

  private async lockRow(tx: TransactionClient, id: string): Promise<ChallengeRow | undefined> {
    const rows = await tx.$queryRaw<ChallengeRow[]>`
      SELECT id, user_id, purpose::text AS purpose, code_mac, attempts, max_attempts, send_count,
             expires_at, closed_at
      FROM identity.verification_challenges WHERE id = ${id}::uuid FOR UPDATE`;
    return rows[0];
  }

  private mac(handleVerifier: string, code: string): string {
    return `hmac-sha256:${createHmac('sha256', this.key).update(`${handleVerifier}:${code}`).digest('hex')}`;
  }
}

/** Sentinel an `onSuccess` callback returns to refuse without consuming. */
export const REFUSE: unique symbol = Symbol('challenge.refuse');

function newCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

function locatedVerifier(handle: string, purpose: ChallengePurpose): string {
  // Only called after `locate` succeeded, so the handle is well-formed for this purpose.
  return parseOpaqueToken(KIND[purpose], handle) ?? '';
}
