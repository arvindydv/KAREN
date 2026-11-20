/**
 * BFF cookie policy (ADR-0016). Edge-safe (no Node APIs): used by proxy.ts, route handlers
 * and server components.
 *
 * Production ("secure" mode) uses `__Host-` names: the browser only accepts them with Secure,
 * Path=/ and NO Domain, so a sibling subdomain can never plant or overwrite them (cookie
 * tossing would otherwise defeat both session fixation defences and double-submit CSRF).
 *
 * "local-http" mode exists ONLY so the app works over plain http on localhost / a LAN IP during
 * development, where browsers drop Secure cookies (LAN) — it drops the `__Host-` prefix and
 * Secure. It is permitted only when APP_ENV is local|test AND the request itself is plain http
 * to a loopback/private host. Every other environment always gets secure mode, even over http
 * (the browser then refuses the cookie: fail closed).
 */
import { isLocalEnv, type ServerEnv } from '../env';

export type CookieMode = 'secure' | 'local-http';

export const COOKIE_BASE_NAMES = {
  session: 'karen_session',
  csrf: 'karen_csrf',
  device: 'karen_device',
  challenge: 'karen_challenge',
} as const;
export type CookieKind = keyof typeof COOKIE_BASE_NAMES;

export function cookieName(kind: CookieKind, mode: CookieMode): string {
  const base = COOKIE_BASE_NAMES[kind];
  return mode === 'secure' ? `__Host-${base}` : base;
}

const PRIVATE_HOST =
  /^(localhost|127(?:\.\d{1,3}){3}|\[::1\]|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|[a-z0-9-]+\.local)$/i;

/** Decides the cookie mode for one request. */
export function cookieModeFor(requestUrl: string | URL, env: ServerEnv): CookieMode {
  if (!isLocalEnv(env)) return 'secure';
  const url = typeof requestUrl === 'string' ? new URL(requestUrl) : requestUrl;
  return url.protocol === 'http:' && PRIVATE_HOST.test(url.hostname) ? 'local-http' : 'secure';
}

/**
 * Names that may be READ for a cookie kind. The plain (non-`__Host-`) name is only honoured in
 * local/test: in production a subdomain could plant `karen_session` and we must ignore it.
 */
export function readableCookieNames(kind: CookieKind, env: ServerEnv): string[] {
  const names = [cookieName(kind, 'secure')];
  if (isLocalEnv(env)) names.push(cookieName(kind, 'local-http'));
  return names;
}

export interface CookieAttributes {
  httpOnly: boolean;
  sameSite: 'Strict' | 'Lax';
  /** Seconds; 0 deletes. Omitted = session cookie. */
  maxAge?: number;
}

/** Serialises one Set-Cookie value. Path=/ always; never a Domain attribute. */
export function serializeCookie(
  name: string,
  value: string,
  attrs: CookieAttributes,
  mode: CookieMode,
): string {
  if (!/^[A-Za-z0-9_-]+$/.test(name.replace(/^__Host-/, ''))) {
    throw new Error('invalid cookie name');
  }
  if (!/^[A-Za-z0-9._~+/=-]*$/.test(value)) throw new Error('invalid cookie value');
  const parts = [`${name}=${value}`, 'Path=/'];
  if (attrs.maxAge !== undefined) parts.push(`Max-Age=${Math.max(0, Math.floor(attrs.maxAge))}`);
  if (mode === 'secure') parts.push('Secure');
  if (attrs.httpOnly) parts.push('HttpOnly');
  parts.push(`SameSite=${attrs.sameSite}`);
  return parts.join('; ');
}

/** Cookie attribute policy per kind. */
export const COOKIE_POLICY: Record<CookieKind, Omit<CookieAttributes, 'maxAge'>> = {
  // Lax: the session must survive top-level navigations from e-mail links into the app.
  session: { httpOnly: true, sameSite: 'Lax' },
  // Readable by our JS on purpose (double-submit); Strict: never sent cross-site.
  csrf: { httpOnly: false, sameSite: 'Strict' },
  // Not a secret (per-install id), still kept away from JS.
  device: { httpOnly: true, sameSite: 'Lax' },
  challenge: { httpOnly: true, sameSite: 'Strict' },
};

export const SESSION_MAX_AGE_CAP_S = 30 * 24 * 3600; // ADR-0016 absolute lifetime
export const DEVICE_MAX_AGE_S = 400 * 24 * 3600; // browsers cap cookie lifetime at 400 days
export const CSRF_MAX_AGE_S = 30 * 24 * 3600;
export const CHALLENGE_MAX_AGE_CAP_S = 30 * 60;

export function setCookie(
  kind: CookieKind,
  value: string,
  mode: CookieMode,
  maxAge: number,
): string {
  return serializeCookie(cookieName(kind, mode), value, { ...COOKIE_POLICY[kind], maxAge }, mode);
}

export function clearCookie(kind: CookieKind, mode: CookieMode): string {
  return serializeCookie(cookieName(kind, mode), '', { ...COOKIE_POLICY[kind], maxAge: 0 }, mode);
}

/** Parses a Cookie request header. Later duplicates do not override the first value. */
export function parseCookieHeader(header: string | null | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name && !out.has(name)) out.set(name, value);
  }
  return out;
}

/** Reads a cookie kind from a request's Cookie header, honouring the environment's names. */
export function readCookie(
  cookies: Map<string, string>,
  kind: CookieKind,
  env: ServerEnv,
): string | undefined {
  for (const name of readableCookieNames(kind, env)) {
    const v = cookies.get(name);
    if (v) return v;
  }
  return undefined;
}

/** Session cookie lifetime: until the API's absolute expiry, capped at 30 days. */
export function sessionMaxAge(sessionExpiresAt: string, now: number = Date.now()): number {
  const ms = Date.parse(sessionExpiresAt) - now;
  if (!Number.isFinite(ms)) return 0;
  return Math.min(SESSION_MAX_AGE_CAP_S, Math.max(0, Math.floor(ms / 1000)));
}

/** URL-safe random token (Web Crypto: works in proxy.ts and Node). */
export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let bin = '';
  for (const b of buf) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
