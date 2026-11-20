/**
 * BFF request guard: same-origin + double-submit CSRF. Pure and runtime-agnostic (Web Crypto
 * only) so it runs in route handlers, the proxy and Vitest alike.
 *
 * A request is accepted only when ALL hold:
 *  1. `Origin` is present and equals the admin app origin (no `null`, no missing header);
 *  2. `Sec-Fetch-Site`, when the browser sends it, is `same-origin`;
 *  3. the CSRF cookie and the `x-csrf-token` header are both present, well-formed and equal
 *     (constant-time comparison).
 */

/** 32 random bytes, base64url (43 chars). */
export function generateCsrfToken(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;
export const isWellFormedCsrfToken = (value: string | null | undefined): value is string =>
  typeof value === 'string' && TOKEN_SHAPE.test(value);

/**
 * Constant-time string comparison: the running time depends only on the length of `b` (the
 * attacker-independent cookie value), never on where the first mismatch is.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i += 1) {
    diff |= (a.charCodeAt(i) || 0) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export type GuardFailure = 'origin' | 'fetch_site' | 'csrf';

export interface GuardInput {
  /** Header accessor (e.g. `request.headers.get`). */
  header: (name: string) => string | null;
  csrfCookie: string | undefined;
  /** The admin app origin, or null when it cannot be determined (fails closed). */
  allowedOrigin: string | null;
}

export function checkBffRequest(
  input: GuardInput,
): { ok: true } | { ok: false; reason: GuardFailure } {
  const origin = input.header('origin');
  if (!input.allowedOrigin || !origin || origin !== input.allowedOrigin) {
    return { ok: false, reason: 'origin' };
  }
  const site = input.header('sec-fetch-site');
  if (site !== null && site !== 'same-origin') return { ok: false, reason: 'fetch_site' };
  const header = input.header('x-csrf-token');
  if (!isWellFormedCsrfToken(input.csrfCookie) || !isWellFormedCsrfToken(header)) {
    return { ok: false, reason: 'csrf' };
  }
  if (!constantTimeEqual(header, input.csrfCookie)) return { ok: false, reason: 'csrf' };
  return { ok: true };
}
