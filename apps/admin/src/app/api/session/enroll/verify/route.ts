import { enrollmentFinishSchema } from '@karen/api-contracts';
import type { NextRequest } from 'next/server';
import { staffApi } from '@/lib/api';
import { guardRequest, readJsonBody, relay, upstreamUnavailable } from '@/lib/bff/handler';

const ROUTE = 'session.enroll.verify';

/** Enrollment step 2: attestation + key name + password. 204 on success; no session is issued. */
export async function POST(request: NextRequest) {
  const denied = guardRequest(request, ROUTE);
  if (denied) return denied;
  const body = await readJsonBody(request, enrollmentFinishSchema);
  if (!body.ok) return body.response;
  try {
    const { error, response } = await staffApi().POST('/v1/staff/auth/enroll/verify', {
      body: body.data,
    });
    return relay(response.status, error ?? null);
  } catch (error) {
    return upstreamUnavailable(ROUTE, error);
  }
}
