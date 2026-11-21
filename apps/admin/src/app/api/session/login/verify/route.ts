import { ceremonyFinishSchema, staffSessionSchema } from '@karen/api-contracts';
import type { NextRequest } from 'next/server';
import { staffApi } from '@/lib/api';
import {
  cookieSpecs,
  errorResponse,
  guardRequest,
  readJsonBody,
  relay,
  setCookie,
  upstreamUnavailable,
} from '@/lib/bff/handler';
import { logEvent } from '@/lib/log';

const ROUTE = 'session.login.verify';

/**
 * Sign-in step 2: security-key assertion → staff session. The `kst_` token goes ONLY into the
 * HttpOnly session cookie; the browser receives the non-secret `me` summary.
 */
export async function POST(request: NextRequest) {
  const denied = guardRequest(request, ROUTE);
  if (denied) return denied;
  const body = await readJsonBody(request, ceremonyFinishSchema);
  if (!body.ok) return body.response;
  try {
    const { data, error, response } = await staffApi().POST('/v1/staff/auth/login/verify', {
      body: body.data,
    });
    if (!data) return relay(response.status, error);
    const session = staffSessionSchema.safeParse(data);
    if (!session.success) {
      logEvent('error', 'bff.unexpected_upstream_shape', { route: ROUTE });
      return errorResponse(
        502,
        'DEPENDENCY_UNAVAILABLE',
        'Unexpected response from the staff API.',
      );
    }
    const result = relay(200, { me: session.data.me });
    setCookie(result, cookieSpecs().session, session.data.session_token);
    return result;
  } catch (error) {
    return upstreamUnavailable(ROUTE, error);
  }
}
