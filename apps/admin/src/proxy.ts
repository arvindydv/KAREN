import { NextResponse, type NextRequest } from 'next/server';
import { csrfCookie } from './lib/security/cookies';
import { buildCsp, generateNonce } from './lib/security/csp';
import { generateCsrfToken, isWellFormedCsrfToken } from './lib/security/csrf';

/**
 * Next.js 16 Proxy (formerly Middleware) for page requests:
 *  1. a fresh nonce + Content-Security-Policy per request. Next.js reads the nonce from the
 *     REQUEST's CSP header while rendering and stamps it on its scripts (pages are dynamic —
 *     see the root layout). The same policy is set on the response.
 *  2. issues the double-submit CSRF cookie when it is missing or malformed.
 *
 * Authentication is NOT decided here: every console page calls `requireStaffSession()`, and the
 * API authorises every call. Static headers (HSTS, XFO, nosniff, …) live in next.config.ts.
 */
export function proxy(request: NextRequest) {
  const nonce = generateNonce();
  const csp = buildCsp({ nonce, isDev: process.env.NODE_ENV === 'development' });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('content-security-policy', csp);

  const appEnv =
    process.env.APP_ENV ?? (process.env.NODE_ENV === 'production' ? 'production' : 'local');
  const csrf = csrfCookie({ APP_ENV: appEnv, NODE_ENV: process.env.NODE_ENV });
  if (!isWellFormedCsrfToken(request.cookies.get(csrf.name)?.value)) {
    response.cookies.set(csrf.name, generateCsrfToken(), csrf.options);
  }
  return response;
}

export const config = {
  matcher: [
    {
      // Pages only: BFF route handlers return JSON and do their own checks.
      source: '/((?!api/|_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
