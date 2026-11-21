/**
 * CSRF defences for BFF route handlers (ADR-0016): SameSite cookies, PLUS an exact Origin check
 * (and Sec-Fetch-Site when the browser sends it), PLUS a double-submit token: the readable
 * `karen_csrf` cookie must equal the `x-csrf-token` header (constant-time compare).
 */
import { isLocalEnv, type ServerEnv } from '../env';
import { parseCookieHeader, readCookie } from './cookies';

export const CSRF_HEADER = 'x-csrf-token';
export const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export type CsrfFailure =
  | 'APP_ORIGIN_UNCONFIGURED'
  | 'CROSS_SITE'
  | 'ORIGIN_MISSING'
  | 'ORIGIN_MISMATCH'
  | 'TOKEN_MISSING'
  | 'TOKEN_MISMATCH';

/** The browser-facing origin. Outside local/test it MUST come from configuration. */
export function appOrigin(request: Request, env: ServerEnv): string | null {
  if (env.WEB_PUBLIC_ORIGIN) return new URL(env.WEB_PUBLIC_ORIGIN).origin;
  return isLocalEnv(env) ? new URL(request.url).origin : null;
}

/** Constant-time string comparison (length is not secret: tokens are fixed-length). */
export function timingSafeEqualString(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/**
 * Rejects any request a browser marks as cross-site. Applies to every method: a cross-site
 * page has no business reading or triggering BFF routes.
 */
export function checkFetchSite(request: Request): CsrfFailure | null {
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return 'CROSS_SITE';
  return null;
}

/** Full check for state-changing requests. Returns null when the request may proceed. */
export function checkStateChangingRequest(request: Request, env: ServerEnv): CsrfFailure | null {
  const origin = appOrigin(request, env);
  if (!origin) return 'APP_ORIGIN_UNCONFIGURED';
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') return 'CROSS_SITE';
  const sentOrigin = request.headers.get('origin');
  if (!sentOrigin) return 'ORIGIN_MISSING';
  if (sentOrigin !== origin) return 'ORIGIN_MISMATCH';
  const header = request.headers.get(CSRF_HEADER);
  const cookie = readCookie(parseCookieHeader(request.headers.get('cookie')), 'csrf', env);
  if (!header || !cookie) return 'TOKEN_MISSING';
  if (!timingSafeEqualString(header, cookie)) return 'TOKEN_MISMATCH';
  return null;
}
