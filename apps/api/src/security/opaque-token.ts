import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * High-entropy opaque credentials (verification/reset codes' handles, refresh tokens, session
 * ids — ADR-0016). 256 bits from the OS CSPRNG, base64url, with a short type prefix so a token
 * of one kind can never be accepted as another (token-type separation) and so leaked tokens
 * are recognizable by secret scanners.
 *
 * Only a SHA-256 verifier is stored server-side. With 256-bit random inputs a fast hash is
 * sufficient (no dictionary to attack); a database leak yields no usable tokens.
 */
export const OPAQUE_TOKEN_KINDS = {
  session: 'kss',
  refresh: 'krt',
  verification: 'kev',
  reset: 'kpr',
  emailChange: 'kec',
} as const;
export type OpaqueTokenKind = keyof typeof OPAQUE_TOKEN_KINDS;

const BODY_RE = /^[A-Za-z0-9_-]{43}$/; // 32 bytes base64url, unpadded

export interface IssuedOpaqueToken {
  /** Give to the client once; never store or log. */
  token: string;
  /** Store this. `sha256:<hex>`. */
  verifier: string;
}

export function issueOpaqueToken(kind: OpaqueTokenKind): IssuedOpaqueToken {
  const token = `${OPAQUE_TOKEN_KINDS[kind]}_${randomBytes(32).toString('base64url')}`;
  return { token, verifier: opaqueTokenVerifier(token) };
}

export function opaqueTokenVerifier(token: string): string {
  return `sha256:${createHash('sha256').update(token, 'utf8').digest('hex')}`;
}

/**
 * Validates shape and kind; returns the verifier to look up, or null for anything malformed or
 * of the wrong kind (callers treat null exactly like "not found").
 */
export function parseOpaqueToken(
  kind: OpaqueTokenKind,
  presented: string | undefined,
): string | null {
  if (typeof presented !== 'string' || presented.length !== 47) return null;
  const prefix = `${OPAQUE_TOKEN_KINDS[kind]}_`;
  if (!presented.startsWith(prefix) || !BODY_RE.test(presented.slice(4))) return null;
  return opaqueTokenVerifier(presented);
}

/** Constant-time comparison of two verifiers (when a lookup is not done by unique index). */
export function verifiersEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}
