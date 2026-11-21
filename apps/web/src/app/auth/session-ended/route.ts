import { getServerEnv } from '@/lib/env';
import { clearCookie, cookieModeFor, parseCookieHeader, readCookie } from '@/lib/bff/cookies';
import { callApi } from '@/lib/bff/upstream';
import { safeNextPath } from '@/lib/safe-redirect';

/**
 * Landing point when a server component finds the session cookie no longer valid. Clears the
 * cookie ONLY if the API confirms the session is dead (401), so a cross-site link to this GET
 * route cannot sign anyone out. Then sends the user to sign in.
 */
export async function GET(request: Request): Promise<Response> {
  const env = getServerEnv();
  const url = new URL(request.url);
  const next = safeNextPath(url.searchParams.get('next'));
  const headers = new Headers({
    location: `/sign-in?next=${encodeURIComponent(next)}`,
    'cache-control': 'no-store',
  });
  const token = readCookie(parseCookieHeader(request.headers.get('cookie')), 'session', env);
  if (token) {
    const res = await callApi({ method: 'GET', path: 'v1/me', token });
    if (res.status === 401)
      headers.append('set-cookie', clearCookie('session', cookieModeFor(request.url, env)));
  }
  return new Response(null, { status: 303, headers });
}
