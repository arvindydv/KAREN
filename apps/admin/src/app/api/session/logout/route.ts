import { NextResponse, type NextRequest } from 'next/server';
import { staffApi } from '@/lib/api';
import { clearSessionCookie, guardRequest, sessionToken } from '@/lib/bff/handler';
import { logEvent } from '@/lib/log';

const ROUTE = 'session.logout';

/** Revoke the staff session upstream; the cookie is cleared even if the API call fails. */
export async function POST(request: NextRequest) {
  const denied = guardRequest(request, ROUTE);
  if (denied) return denied;
  const token = sessionToken(request);
  if (token) {
    try {
      const { response } = await staffApi(token).POST('/v1/staff/auth/logout');
      if (!response.ok && response.status !== 401) {
        logEvent('warn', 'bff.logout_upstream_failed', { status: response.status });
      }
    } catch (error) {
      logEvent('warn', 'bff.logout_upstream_failed', {
        error: error instanceof Error ? error.name : 'unknown',
      });
    }
  }
  const response = new NextResponse(null, {
    status: 204,
    headers: { 'cache-control': 'no-store' },
  });
  clearSessionCookie(response);
  return response;
}
