/**
 * Staff console cookie policy (ADR-0017 §2). Pure — no Next.js or server-only imports so the
 * attribute rules are unit-tested directly.
 *
 * - Session cookie: `__Host-karen_staff` — HttpOnly, Secure, Path=/, SameSite=Strict, no Domain.
 *   It carries the opaque `kst_` staff token; the browser's JavaScript never sees it.
 * - CSRF cookie: `__Host-karen_staff_csrf` — Secure, Path=/, SameSite=Strict, deliberately NOT
 *   HttpOnly (double-submit: client JS echoes it in `x-csrf-token`). The `__Host-` prefix stops a
 *   sibling subdomain from planting a value (cookie tossing), which would defeat double-submit.
 *
 * Plain-http local development: browsers other than Chromium refuse `Secure` cookies on
 * http://localhost, so ONLY when APP_ENV is `local`/`test` AND NODE_ENV is not `production`
 * (i.e. `next dev` / Vitest) the names drop the `__Host-` prefix (`karen_staff`,
 * `karen_staff_csrf`) and `Secure` is omitted. Every production build (`next build`/`next start`)
 * uses the secure variant regardless of APP_ENV.
 */
export const SESSION_COOKIE_BASE = 'karen_staff';
export const CSRF_COOKIE_BASE = 'karen_staff_csrf';
export const CSRF_HEADER = 'x-csrf-token';
/** ADR-0017: absolute staff session lifetime is 8 h; the API enforces idle/absolute expiry. */
export const SESSION_COOKIE_MAX_AGE_SECONDS = 8 * 60 * 60;
/** CSRF token lifetime; re-issued by the proxy whenever it is missing. */
export const CSRF_COOKIE_MAX_AGE_SECONDS = 12 * 60 * 60;

export interface CookieEnv {
  APP_ENV: string;
  NODE_ENV?: string | undefined;
}

export interface CookieSpec {
  name: string;
  options: {
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'strict';
    path: '/';
    maxAge: number;
  };
}

/** True only for local/test development servers; never for a production build. */
export const allowsInsecureCookies = (env: CookieEnv): boolean =>
  (env.APP_ENV === 'local' || env.APP_ENV === 'test') && env.NODE_ENV !== 'production';

const named = (base: string, secure: boolean) => (secure ? `__Host-${base}` : base);

export function sessionCookie(env: CookieEnv): CookieSpec {
  const secure = !allowsInsecureCookies(env);
  return {
    name: named(SESSION_COOKIE_BASE, secure),
    options: {
      httpOnly: true,
      secure,
      sameSite: 'strict',
      path: '/',
      maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
    },
  };
}

export function csrfCookie(env: CookieEnv): CookieSpec {
  const secure = !allowsInsecureCookies(env);
  return {
    name: named(CSRF_COOKIE_BASE, secure),
    options: {
      httpOnly: false,
      secure,
      sameSite: 'strict',
      path: '/',
      maxAge: CSRF_COOKIE_MAX_AGE_SECONDS,
    },
  };
}

/** Same attributes with Max-Age=0 — `__Host-` cookies are only cleared when Secure/Path match. */
export const expired = (spec: CookieSpec): CookieSpec => ({
  name: spec.name,
  options: { ...spec.options, maxAge: 0 },
});

/** Browser side: the CSRF cookie name is either variant; the client reads whichever exists. */
export const CSRF_COOKIE_NAMES = [`__Host-${CSRF_COOKIE_BASE}`, CSRF_COOKIE_BASE] as const;
