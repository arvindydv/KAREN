import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import type { z } from 'zod';
import { serverEnv } from '../env';
import { logEvent } from '../log';
import { csrfCookie, expired, sessionCookie, type CookieSpec } from '../security/cookies';
import { checkBffRequest } from '../security/csrf';

/** WebAuthn credentials and our forms are small; anything bigger is refused before parsing. */
export const MAX_BODY_BYTES = 16 * 1024;

export const cookieSpecs = () => {
  const env = serverEnv();
  return { session: sessionCookie(env), csrf: csrfCookie(env) };
};

/** The origin browser requests must come from. Fails closed outside local/test without config. */
export function allowedOrigin(request: NextRequest): string | null {
  const env = serverEnv();
  if (env.ADMIN_APP_ORIGIN) return env.ADMIN_APP_ORIGIN;
  if (env.APP_ENV === 'local' || env.APP_ENV === 'test') return request.nextUrl.origin;
  return null;
}

/** API-shaped error envelope so the browser handles BFF and API errors identically. */
export function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        correlation_id: globalThis.crypto.randomUUID(),
        retryable: status >= 500,
      },
    },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

/** Same-origin + double-submit CSRF check for every BFF route (all methods). */
export function guardRequest(request: NextRequest, route: string): NextResponse | null {
  const result = checkBffRequest({
    header: (name) => request.headers.get(name),
    csrfCookie: request.cookies.get(cookieSpecs().csrf.name)?.value,
    allowedOrigin: allowedOrigin(request),
  });
  if (result.ok) return null;
  logEvent('warn', 'bff.request_rejected', { route, reason: result.reason });
  return errorResponse(
    403,
    'FORBIDDEN',
    'This request could not be verified. Reload the page and try again.',
  );
}

export type BodyResult<T> = { ok: true; data: T } | { ok: false; response: NextResponse };

/** Read, size-limit and validate a JSON body against a contract schema. Never logs the body. */
export async function readJsonBody<S extends z.ZodType>(
  request: NextRequest,
  schema: S,
): Promise<BodyResult<z.infer<S>>> {
  if (!(request.headers.get('content-type') ?? '').startsWith('application/json')) {
    return { ok: false, response: errorResponse(415, 'VALIDATION_FAILED', 'Expected JSON.') };
  }
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) {
    return { ok: false, response: errorResponse(413, 'PAYLOAD_TOO_LARGE', 'Request too large.') };
  }
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    return { ok: false, response: errorResponse(413, 'PAYLOAD_TOO_LARGE', 'Request too large.') };
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, response: errorResponse(400, 'VALIDATION_FAILED', 'Malformed JSON.') };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      response: errorResponse(400, 'VALIDATION_FAILED', 'Some fields are missing or invalid.'),
    };
  }
  return { ok: true, data: parsed.data };
}

/** Relay an upstream status/body to the browser (204 stays empty). */
export function relay(status: number, body: unknown): NextResponse {
  if (status === 204 || body === null || body === undefined) {
    return new NextResponse(null, { status, headers: { 'cache-control': 'no-store' } });
  }
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export const upstreamUnavailable = (route: string, error: unknown): NextResponse => {
  logEvent('error', 'bff.upstream_unavailable', {
    route,
    error: error instanceof Error ? error.name : 'unknown',
  });
  return errorResponse(502, 'DEPENDENCY_UNAVAILABLE', 'The staff API is unavailable. Try again.');
};

export const setCookie = (response: NextResponse, spec: CookieSpec, value: string) => {
  response.cookies.set(spec.name, value, spec.options);
};

export const clearSessionCookie = (response: NextResponse) => {
  const spec = expired(cookieSpecs().session);
  response.cookies.set(spec.name, '', spec.options);
};

export const sessionToken = (request: NextRequest): string | undefined =>
  request.cookies.get(cookieSpecs().session.name)?.value;
