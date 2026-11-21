import { staffLoginStartSchema } from '@karen/api-contracts';
import type { NextRequest } from 'next/server';
import { staffApi } from '@/lib/api';
import { guardRequest, readJsonBody, relay, upstreamUnavailable } from '@/lib/bff/handler';

const ROUTE = 'session.login.options';

/** Sign-in step 1: e-mail + password → WebAuthn request options (+ opaque ceremony handle). */
export async function POST(request: NextRequest) {
  const denied = guardRequest(request, ROUTE);
  if (denied) return denied;
  const body = await readJsonBody(request, staffLoginStartSchema);
  if (!body.ok) return body.response;
  try {
    const { data, error, response } = await staffApi().POST('/v1/staff/auth/login/options', {
      body: body.data,
    });
    return relay(response.status, data ?? error);
  } catch (error) {
    return upstreamUnavailable(ROUTE, error);
  }
}
