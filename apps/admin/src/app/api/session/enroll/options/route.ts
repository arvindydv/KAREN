import { enrollmentStartSchema } from '@karen/api-contracts';
import type { NextRequest } from 'next/server';
import { staffApi } from '@/lib/api';
import { guardRequest, readJsonBody, relay, upstreamUnavailable } from '@/lib/bff/handler';

const ROUTE = 'session.enroll.options';

/** Enrollment step 1. The one-time token arrives in the JSON body only (never path/query). */
export async function POST(request: NextRequest) {
  const denied = guardRequest(request, ROUTE);
  if (denied) return denied;
  const body = await readJsonBody(request, enrollmentStartSchema);
  if (!body.ok) return body.response;
  try {
    const { data, error, response } = await staffApi().POST('/v1/staff/auth/enroll/options', {
      body: body.data,
    });
    return relay(response.status, data ?? error);
  } catch (error) {
    return upstreamUnavailable(ROUTE, error);
  }
}
