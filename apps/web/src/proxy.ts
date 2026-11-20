import { NextResponse, type NextRequest } from 'next/server';
import { getServerEnv } from './lib/env';
import { buildCsp, generateNonce } from './lib/csp';
import {
  cookieModeFor,
  CSRF_MAX_AGE_S,
  parseCookieHeader,
  randomToken,
  readCookie,
  setCookie,
} from './lib/bff/cookies';

/**
 * Next.js 16 Proxy (formerly middleware) for page requests:
 *  1. a fresh CSP nonce per request (header for the browser + request header for rendering);
 *  2. issues the double-submit CSRF cookie when missing;
 *  3. optimistic redirect of signed-out visitors away from /app (the (app) layout still
 *     validates the session with the API — this only saves a round trip).
 */
export function proxy(request: NextRequest) {
  const env = getServerEnv();
  const nonce = generateNonce();
  const csp = buildCsp(nonce, process.env.NODE_ENV === 'development');
  const cookies = parseCookieHeader(request.headers.get('cookie'));
  const mode = cookieModeFor(request.url, env);
  const { pathname, search } = request.nextUrl;

  const isAppArea = pathname === '/app' || pathname.startsWith('/app/');
  let response: NextResponse;
  if (isAppArea && !readCookie(cookies, 'session', env)) {
    const target = new URL('/sign-in', request.url);
    target.searchParams.set('next', `${pathname}${search}`);
    response = NextResponse.redirect(target);
  } else {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-nonce', nonce);
    requestHeaders.set('content-security-policy', csp);
    requestHeaders.set('x-karen-pathname', `${pathname}${search}`);
    response = NextResponse.next({ request: { headers: requestHeaders } });
  }
  response.headers.set('content-security-policy', csp);
  if (!readCookie(cookies, 'csrf', env)) {
    response.headers.append('set-cookie', setCookie('csrf', randomToken(), mode, CSRF_MAX_AGE_S));
  }
  return response;
}

export const config = {
  matcher: [
    {
      source: '/((?!api/|_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
