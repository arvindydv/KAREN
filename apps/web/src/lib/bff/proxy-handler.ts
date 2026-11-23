/**
 * The ONE allowlisted proxy from the browser to the API (/api/v1/[...path]). It:
 *  - rejects anything not in the allowlist (404) and any cross-site request (403);
 *  - requires same-origin + double-submit CSRF for every state-changing method;
 *  - forwards ONLY safe request headers, never cookies or a client-supplied Authorization;
 *  - attaches the session token from the HttpOnly cookie as a bearer token;
 *  - passes the API status and JSON error envelope through unchanged;
 *  - clears the session cookie on sign-out even if the API call fails.
 */
import { bffError } from '../errors';
import { getServerEnv, type ServerEnv } from '../env';
import { maxBodyBytesFor, resolveAllowedPath, SIGN_OUT_PATHS } from './allowlist';
import { clearCookie, cookieModeFor, parseCookieHeader, readCookie } from './cookies';
import { checkFetchSite, checkStateChangingRequest, STATE_CHANGING_METHODS } from './csrf';
import { bffLog } from './log';
import { callApi, type UpstreamDeps } from './upstream';

/** Request headers the browser may send through. Everything else is dropped. */
export const FORWARDED_REQUEST_HEADERS = ['content-type', 'if-match', 'idempotency-key'] as const;
/** Response headers passed back. Hop-by-hop and Set-Cookie are never passed. */
export const FORWARDED_RESPONSE_HEADERS = [
  'content-type',
  'etag',
  'content-disposition',
  'retry-after',
  'x-content-sha256',
  'x-request-id',
] as const;

export const MAX_BODY_BYTES = 64 * 1024;

export function forbidden(
  message = 'This request was blocked for your security. Reload the page and try again.',
): Response {
  return Response.json(bffError('FORBIDDEN', message), {
    status: 403,
    headers: { 'cache-control': 'no-store' },
  });
}

export function notFound(): Response {
  return Response.json(bffError('NOT_FOUND', 'Not found.'), {
    status: 404,
    headers: { 'cache-control': 'no-store' },
  });
}

/** Reads a request body with a hard size cap. Returns null when too large. */
export async function readBoundedBody(
  request: Request,
  max = MAX_BODY_BYTES,
): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > max) return null;
  const text = await request.text();
  return new TextEncoder().encode(text).length > max ? null : text;
}

export async function handleProxy(
  request: Request,
  segments: readonly string[],
  deps: UpstreamDeps = {},
): Promise<Response> {
  const env: ServerEnv = deps.env ?? getServerEnv();
  const method = request.method.toUpperCase();
  const path = resolveAllowedPath(method, segments);
  if (!path) return notFound();

  const siteFailure = checkFetchSite(request);
  if (siteFailure) {
    bffLog('warn', 'bff.proxy.csrf_rejected', { reason: siteFailure });
    return forbidden();
  }
  const stateChanging = STATE_CHANGING_METHODS.has(method);
  if (stateChanging) {
    const failure = checkStateChangingRequest(request, env);
    if (failure) {
      bffLog('warn', 'bff.proxy.csrf_rejected', { reason: failure });
      return forbidden();
    }
  }

  const mode = cookieModeFor(request.url, env);
  const token = readCookie(parseCookieHeader(request.headers.get('cookie')), 'session', env);
  const signOut = SIGN_OUT_PATHS.has(path);

  let upstream: Response;
  if (!token) {
    upstream = Response.json(bffError('UNAUTHENTICATED', 'Please sign in again.'), { status: 401 });
  } else {
    const headers: Record<string, string> = {};
    for (const name of FORWARDED_REQUEST_HEADERS) {
      const v = request.headers.get(name);
      if (v) headers[name] = v;
    }
    let body: string | undefined;
    if (stateChanging) {
      const raw = await readBoundedBody(request, maxBodyBytesFor(method, path, MAX_BODY_BYTES));
      if (raw === null) {
        return Response.json(bffError('PAYLOAD_TOO_LARGE', 'That request is too large.'), {
          status: 413,
        });
      }
      body = raw.length > 0 ? raw : undefined;
    }
    upstream = await callApi(
      { method, path: `v1/${path}`, search: new URL(request.url).search, token, body, headers },
      deps,
    );
  }

  const outHeaders = new Headers({ 'cache-control': 'no-store' });
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const v = upstream.headers.get(name);
    if (v) outHeaders.set(name, v);
  }
  // A revoked/expired session or an explicit sign-out ends the browser session locally.
  if (signOut || upstream.status === 401) {
    outHeaders.append('set-cookie', clearCookie('session', mode));
  }
  const noBody = upstream.status === 204 || upstream.status === 304 || method === 'HEAD';
  const payload = noBody ? null : await upstream.arrayBuffer();
  if (signOut && !upstream.ok) {
    bffLog('warn', 'bff.proxy.signout_upstream_failed', { status: upstream.status });
    // The cookie is cleared regardless; report success to the browser so it leaves the app.
    return Response.json(
      { revoked_sessions: 0, local_only: true },
      { status: 200, headers: outHeaders },
    );
  }
  return new Response(payload, { status: upstream.status, headers: outHeaders });
}
