import type { NextRequest } from 'next/server';
import { callUpstream } from '@/lib/api';
import { resolveStaffProxyRoute } from '@/lib/bff/allowlist';
import {
  clearSessionCookie,
  errorResponse,
  guardRequest,
  readJsonBody,
  relay,
  sessionToken,
  upstreamUnavailable,
} from '@/lib/bff/handler';

const ROUTE = 'staff.proxy';

interface Context {
  params: Promise<{ path: string[] }>;
}

/**
 * Allowlisted relay for authenticated staff actions (see `lib/bff/allowlist.ts`). Adds the staff
 * bearer from the HttpOnly cookie; forwards only validated bodies and allowlisted headers.
 */
async function handle(request: NextRequest, { params }: Context) {
  const denied = guardRequest(request, ROUTE);
  if (denied) return denied;
  const { path } = await params;
  const target = resolveStaffProxyRoute(request.method, path);
  if (!target) return errorResponse(404, 'NOT_FOUND', 'Not found.');
  const token = sessionToken(request);
  if (!token)
    return errorResponse(401, 'UNAUTHENTICATED', 'Your session has ended. Sign in again.');

  let body: unknown;
  if (target.bodySchema) {
    const parsed = await readJsonBody(request, target.bodySchema);
    if (!parsed.ok) return parsed.response;
    body = parsed.data;
  }
  const headers: Record<string, string> = {};
  for (const { name, schema } of target.forwardHeaders) {
    const value = schema.safeParse(request.headers.get(name));
    if (!value.success) {
      return errorResponse(400, 'VALIDATION_FAILED', `Header ${name} is missing or invalid.`);
    }
    headers[name] = value.data;
  }

  try {
    const upstream = await callUpstream({
      method: request.method,
      path: target.upstreamPath,
      token,
      body,
      headers,
    });
    const response = relay(upstream.status, upstream.body);
    if (upstream.status === 401) clearSessionCookie(response);
    return response;
  } catch (error) {
    return upstreamUnavailable(ROUTE, error);
  }
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
