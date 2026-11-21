import { NextResponse, type NextRequest } from 'next/server';
import { clearSessionCookie } from '@/lib/bff/handler';

/**
 * Server Components cannot modify cookies, so when the API rejects the staff session (401)
 * `requireStaffSession` redirects here: clear the dead cookie, then go to sign-in. It performs no
 * upstream call and grants nothing, so it needs no CSRF token.
 */
export function GET(request: NextRequest) {
  const response = NextResponse.redirect(new URL('/sign-in', request.nextUrl), 303);
  response.headers.set('cache-control', 'no-store');
  clearSessionCookie(response);
  return response;
}
