/**
 * SSE pass-through for one assistant message's stream (Phase 02, ADR-0022):
 *   GET /api/v1/conversations/{id}/messages/{messageId}/stream
 *
 * Same protections as the JSON proxy (Fetch-Metadata check, session from the HttpOnly cookie as
 * a bearer token, no cookies / client Authorization forwarded) but the body is streamed through
 * unbuffered: no overall timeout once headers arrive (the API sends heartbeats and ends the
 * stream itself), and the upstream request is aborted as soon as the browser disconnects.
 * Errors before the stream starts (401/404/…) pass through as the API's JSON envelope.
 */
import { bffError } from '../errors';
import { getServerEnv, type ServerEnv } from '../env';
import { STREAM_PATH } from './allowlist';
import { signedClientIpHeaders } from './client-ip';
import { clearCookie, cookieModeFor, parseCookieHeader, readCookie } from './cookies';
import { checkFetchSite } from './csrf';
import { bffLog, errorName } from './log';
import { forbidden, notFound } from './proxy-handler';

export const STREAM_CONNECT_TIMEOUT_MS = 15_000;
const RESUME = /^\d{1,9}$/;

export interface StreamDeps {
  fetch?: typeof globalThis.fetch;
  env?: ServerEnv;
  connectTimeoutMs?: number;
}

export async function handleStreamProxy(
  request: Request,
  conversationId: string,
  messageId: string,
  deps: StreamDeps = {},
): Promise<Response> {
  const path = `conversations/${conversationId}/messages/${messageId}/stream`;
  if (request.method.toUpperCase() !== 'GET' || !STREAM_PATH.test(path)) return notFound();
  return proxyEventStream(request, path, deps);
}

/** SSE pass-through: Fetch-Metadata, cookie → bearer, unbuffered, abort on disconnect. */
async function proxyEventStream(
  request: Request,
  path: string,
  deps: StreamDeps,
): Promise<Response> {
  const env = deps.env ?? getServerEnv();
  const siteFailure = checkFetchSite(request);
  if (siteFailure) {
    bffLog('warn', 'bff.stream.csrf_rejected', { reason: siteFailure });
    return forbidden();
  }
  const mode = cookieModeFor(request.url, env);
  const token = readCookie(parseCookieHeader(request.headers.get('cookie')), 'session', env);
  if (!token) {
    return Response.json(bffError('UNAUTHENTICATED', 'Please sign in again.'), {
      status: 401,
      headers: { 'cache-control': 'no-store', 'set-cookie': clearCookie('session', mode) },
    });
  }

  const headers = new Headers({
    accept: 'text/event-stream',
    authorization: `Bearer ${token}`,
    'x-request-id': crypto.randomUUID(),
  });
  const lastEventId = request.headers.get('last-event-id');
  if (lastEventId && RESUME.test(lastEventId)) headers.set('last-event-id', lastEventId);
  for (const [k, v] of Object.entries(
    await signedClientIpHeaders(env.INTERNAL_SERVICE_HMAC_SECRET, env.BFF_TRUSTED_PROXY_HOPS),
  )) {
    headers.set(k, v);
  }
  const after = new URL(request.url).searchParams.get('after');
  const search = after && RESUME.test(after) ? `?after=${after}` : '';
  const base = env.API_INTERNAL_BASE_URL.replace(/\/+$/, '');

  // Abort upstream when the browser goes away; bound only the time to response headers.
  const upstreamAbort = new AbortController();
  const onClientAbort = () => upstreamAbort.abort();
  request.signal.addEventListener('abort', onClientAbort, { once: true });
  const connectTimer = setTimeout(
    () => upstreamAbort.abort(),
    deps.connectTimeoutMs ?? STREAM_CONNECT_TIMEOUT_MS,
  );
  let upstream: Response;
  try {
    upstream = await (deps.fetch ?? globalThis.fetch)(`${base}/v1/${path}${search}`, {
      method: 'GET',
      headers,
      redirect: 'manual',
      cache: 'no-store',
      signal: upstreamAbort.signal,
    });
  } catch (e) {
    request.signal.removeEventListener('abort', onClientAbort);
    bffLog('error', 'bff.stream.unreachable', { error: errorName(e) });
    return Response.json(
      bffError(
        'DEPENDENCY_UNAVAILABLE',
        'KAREN is temporarily unavailable. Please try again shortly.',
        { retryable: true },
      ),
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  } finally {
    clearTimeout(connectTimer);
  }

  const outHeaders = new Headers({ 'cache-control': 'no-store' });
  const requestId = upstream.headers.get('x-request-id');
  if (requestId) outHeaders.set('x-request-id', requestId);
  const isStream =
    upstream.ok && (upstream.headers.get('content-type') ?? '').startsWith('text/event-stream');
  if (!isStream || !upstream.body) {
    request.signal.removeEventListener('abort', onClientAbort);
    if (upstream.status === 401) outHeaders.append('set-cookie', clearCookie('session', mode));
    outHeaders.set('content-type', upstream.headers.get('content-type') ?? 'application/json');
    return new Response(await upstream.arrayBuffer(), {
      status: upstream.status,
      headers: outHeaders,
    });
  }
  outHeaders.set('content-type', 'text/event-stream; charset=utf-8');
  outHeaders.set('cache-control', 'no-store, no-transform');
  outHeaders.set('x-accel-buffering', 'no');
  const body = upstream.body;
  const reader = body.getReader();
  const passThrough = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          request.signal.removeEventListener('abort', onClientAbort);
          controller.close();
        } else controller.enqueue(value);
      } catch {
        // Upstream ended abruptly: end the browser stream; the client resumes with Last-Event-ID.
        request.signal.removeEventListener('abort', onClientAbort);
        controller.close();
      }
    },
    cancel() {
      upstreamAbort.abort();
      void reader.cancel().catch(() => undefined);
    },
  });
  return new Response(passThrough, { status: 200, headers: outHeaders });
}
