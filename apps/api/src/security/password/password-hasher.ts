import { type Algorithm, hash, verify } from '@node-rs/argon2';
import { randomBytes } from 'node:crypto';
import { type ConcurrencyGate, GateSaturatedError } from '../concurrency-gate.js';
import { PASSWORD_NORMALIZATION } from './password-policy.js';

/**
 * Argon2id password hashing (ADR-0015 §Password storage, OWASP Password Storage Cheat Sheet,
 * RFC 9106). Implementation: @node-rs/argon2 — verified in unit tests against the
 * phc-winner-argon2 reference test vector, so we depend on spec behaviour, not on trust.
 *
 * - Unique 16-byte CSPRNG salt per hash (node:crypto), encoded in the PHC string.
 * - Versioned parameters: the PHC string records m/t/p, so raising them later only requires a
 *   new entry below; old hashes keep verifying and are upgraded on the next successful login.
 * - Optional pepper = Argon2 secret input (K), held outside the database (Secrets Manager) and
 *   versioned by id, so a database-only compromise does not yield crackable hashes.
 * - All hashing runs through a bounded ConcurrencyGate (DoS protection, see that file).
 * - Inputs are NFKC-normalized by the caller (`normalizePassword`); the scheme string records
 *   the normalization so it can evolve.
 */

export interface Argon2Params {
  memoryCost: number; // KiB
  timeCost: number;
  parallelism: number;
}

/**
 * Parameter set v1, chosen from scripts/bench-password-hash.mjs (results and environment in
 * docs/security/password-hashing-benchmark.md): RFC 9106 §4 second recommended option
 * (64 MiB, t=3, p=1). p=1 keeps one hash on one thread so the gate maps 1:1 to threads.
 * Production latency on the target ECS task size is NOT VERIFIED yet (M10 benchmark).
 */
export const CURRENT_PASSWORD_PARAMS: Argon2Params = {
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
};

export const PASSWORD_SCHEME = `argon2id+${PASSWORD_NORMALIZATION}`;
const ARGON2ID = 2 as Algorithm; // const enum value (isolatedModules forbids enum access)
const PHC_RE = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/;

export interface StoredPasswordHash {
  /** PHC string: $argon2id$v=19$m=…,t=…,p=…$salt$hash. Never logged. */
  hash: string;
  /** Pepper key id used, or null when hashed without a pepper. */
  pepperId: string | null;
  scheme: string;
}

export interface PasswordVerification {
  valid: boolean;
  /** True when the hash should be re-computed with current params/pepper after success. */
  needsRehash: boolean;
}

export class PasswordHashingError extends Error {
  constructor(
    readonly reason: 'UNKNOWN_PEPPER' | 'UNSUPPORTED_SCHEME' | 'CORRUPT_HASH',
    cause?: unknown,
  ) {
    super(`Password hashing failed: ${reason}`, { cause });
    this.name = 'PasswordHashingError';
  }
}

export interface PasswordHasherOptions {
  peppers: ReadonlyMap<string, Buffer>;
  currentPepperId: string | null;
  gate: ConcurrencyGate;
  /** Override only in tests (tiny params keep unit tests fast). */
  params?: Argon2Params;
}

export class PasswordHasher {
  private readonly params: Argon2Params;
  private dummy: Promise<StoredPasswordHash> | undefined;

  constructor(private readonly options: PasswordHasherOptions) {
    if (options.currentPepperId !== null && !options.peppers.has(options.currentPepperId)) {
      throw new Error('PasswordHasher: current pepper id has no key');
    }
    for (const [id, key] of options.peppers) {
      if (key.length < 32) throw new Error(`PasswordHasher: pepper ${id} shorter than 32 bytes`);
    }
    this.params = options.params ?? CURRENT_PASSWORD_PARAMS;
  }

  async hash(normalizedPassword: string): Promise<StoredPasswordHash> {
    const pepperId = this.options.currentPepperId;
    const secret = pepperId === null ? undefined : this.options.peppers.get(pepperId);
    const encoded = await this.options.gate.run(() =>
      hash(normalizedPassword, {
        algorithm: ARGON2ID,
        ...this.params,
        salt: randomBytes(16),
        ...(secret ? { secret } : {}),
      }),
    );
    return { hash: encoded, pepperId, scheme: PASSWORD_SCHEME };
  }

  async verify(
    normalizedPassword: string,
    stored: StoredPasswordHash,
  ): Promise<PasswordVerification> {
    if (stored.scheme !== PASSWORD_SCHEME) throw new PasswordHashingError('UNSUPPORTED_SCHEME');
    if (!PHC_RE.test(stored.hash)) throw new PasswordHashingError('CORRUPT_HASH');
    let secret: Buffer | undefined;
    if (stored.pepperId !== null) {
      secret = this.options.peppers.get(stored.pepperId);
      // A retired-but-still-referenced pepper is an operator error, not a wrong password.
      if (!secret) throw new PasswordHashingError('UNKNOWN_PEPPER');
    }
    let valid: boolean;
    try {
      valid = await this.options.gate.run(() =>
        verify(stored.hash, normalizedPassword, secret ? { secret } : {}),
      );
    } catch (error) {
      if (error instanceof GateSaturatedError) throw error;
      throw new PasswordHashingError('CORRUPT_HASH', error);
    }
    return { valid, needsRehash: valid && this.needsRehash(stored) };
  }

  /**
   * Performs a full verification against a fixed dummy hash with current parameters, so that
   * "no such account" costs the same as "wrong password" (user-enumeration timing defence).
   * Always returns false.
   */
  async verifyDummy(normalizedPassword: string): Promise<false> {
    this.dummy ??= this.hash(randomBytes(24).toString('base64url'));
    const dummy = await this.dummy;
    await this.verify(normalizedPassword, dummy);
    return false;
  }

  needsRehash(stored: StoredPasswordHash): boolean {
    const match = PHC_RE.exec(stored.hash);
    if (!match) return true;
    const [, m, t, p] = match.map(Number);
    return (
      stored.scheme !== PASSWORD_SCHEME ||
      stored.pepperId !== this.options.currentPepperId ||
      m !== this.params.memoryCost ||
      t !== this.params.timeCost ||
      p !== this.params.parallelism
    );
  }
}

/**
 * Parses PASSWORD_PEPPERS ("id:base64url,id2:base64url"). Ids are short slugs; keys decode to
 * ≥ 32 bytes. Throws with a message that never contains key material.
 */
export function parsePepperKeys(raw: string | undefined): Map<string, Buffer> {
  const keys = new Map<string, Buffer>();
  for (const entry of (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    const sep = entry.indexOf(':');
    const id = entry.slice(0, sep);
    if (sep <= 0 || !/^[a-z0-9-]{1,32}$/.test(id)) {
      throw new Error('PASSWORD_PEPPERS: each entry must be "<id>:<base64url key>"');
    }
    const key = Buffer.from(entry.slice(sep + 1), 'base64url');
    if (key.length < 32) throw new Error(`PASSWORD_PEPPERS: key "${id}" must decode to ≥ 32 bytes`);
    if (keys.has(id)) throw new Error(`PASSWORD_PEPPERS: duplicate id "${id}"`);
    keys.set(id, key);
  }
  return keys;
}
