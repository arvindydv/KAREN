/**
 * Node-only deterministic crypto helpers (hashing, HMAC signatures). Kept in a separate
 * entrypoint so browser/React Native bundles never pull in `node:crypto`.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { canonicalJson } from '../approval.js';

export const sha256Hex = (input: string | Buffer): string =>
  createHash('sha256').update(input).digest('hex');

/** `sha256:<hex>` of the canonical JSON payload — the value bound into approvals. */
export const computePayloadHash = (payload: unknown): string =>
  `sha256:${sha256Hex(canonicalJson(payload))}`;

export const hmacSha256Hex = (secret: string, message: string | Buffer): string =>
  createHmac('sha256', secret).update(message).digest('hex');

export function constantTimeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export type SignatureFailure = 'MALFORMED' | 'TIMESTAMP_OUT_OF_TOLERANCE' | 'SIGNATURE_MISMATCH';

/**
 * Timestamped HMAC-SHA256 signature scheme used for (a) mock/sandbox provider webhooks and
 * (b) internal service-to-service requests. Header format: `t=<unix seconds>,v1=<hex>`.
 * The signed message is `<t>.<payload>` which binds the timestamp and defeats replay
 * outside the tolerance window. Replay *inside* the window is handled by a dedupe store.
 */
export function signTimestamped(secret: string, payload: string, unixSeconds: number): string {
  return `t=${unixSeconds},v1=${hmacSha256Hex(secret, `${unixSeconds}.${payload}`)}`;
}

export function verifyTimestamped(opts: {
  secret: string;
  payload: string;
  header: string | undefined;
  nowUnixSeconds: number;
  toleranceSeconds: number;
}): { ok: true; timestamp: number } | { ok: false; reason: SignatureFailure } {
  const match = /^t=(\d{1,12}),v1=([0-9a-f]{64})$/.exec(opts.header ?? '');
  if (!match?.[1] || !match[2]) return { ok: false, reason: 'MALFORMED' };
  const timestamp = Number(match[1]);
  if (Math.abs(opts.nowUnixSeconds - timestamp) > opts.toleranceSeconds) {
    return { ok: false, reason: 'TIMESTAMP_OUT_OF_TOLERANCE' };
  }
  const expected = hmacSha256Hex(opts.secret, `${timestamp}.${opts.payload}`);
  return constantTimeEqualHex(expected, match[2])
    ? { ok: true, timestamp }
    : { ok: false, reason: 'SIGNATURE_MISMATCH' };
}

/** Canonical string signed for internal service calls (shared with the Python service). */
export const internalRequestSigningString = (
  method: string,
  pathWithQuery: string,
  body: string,
): string => `${method.toUpperCase()}\n${pathWithQuery}\n${sha256Hex(body)}`;
export * from './outbound.js';
