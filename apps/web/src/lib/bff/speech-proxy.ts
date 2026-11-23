/**
 * Streaming pass-through for a spoken reply (ADR-0026):
 *   POST /api/v1/conversations/{id}/messages/{messageId}/speech
 *
 * Same protections as the JSON proxy (Fetch-Metadata, same-origin + double-submit CSRF for this
 * state-changing call, session from the HttpOnly cookie as a bearer token, no cookies or client
 * Authorization forwarded). Audio streams through unbuffered so playback starts early; when the
 * browser stops listening (interruption), the upstream request is aborted and the API stops the
 * synthesis. Errors before audio starts pass through as the API's JSON envelope.
 */
import { bffError } from '../errors';
import { getServerEnv, type ServerEnv } from '../env';
import { SPEECH_PATH } from './allowlist';
import { signedClientIpHeaders } from './client-ip';
import { clearCookie, cookieModeFor, parseCookieHeader, readCookie } from './cookies';
import { checkFetchSite, checkStateChangingRequest } from './csrf';
import { bffLog, errorName } from './log';
import { forbidden, notFound } from './proxy-handler';

export const SPEECH_CONNECT_TIMEOUT_MS = 20_000;
/** Voice metadata headers passed back to the browser (never the spoken text). */
export const SPEECH_RESPONSE_HEADERS = [
  'x-karen-speech-language',
  'x-karen-voice-id',
  'x-karen-is-mock',
  'x-karen-text-truncated',
] as const;

export interface SpeechDeps {
  fetch?: typeof globalThis.fetch;
  env?: ServerEnv;
  connectTimeoutMs?: number;
}

export async function handleSpeechProxy(
  request: Request,
  conversationId: string,
  messageId: string,
  deps: SpeechDeps = {},
): Promise<Response> {
  const path = `conversations/${conversationId}/messages/${messageId}/speech`;
  if (request.method.toUpperCase() !== 'POST' || !SPEECH_PATH.test(path)) return notFound();
  return proxyAudio(request, path, null, deps);
}

/** Largest voice-preview request body (`{"voice_id": "…"}`). */
const PREVIEW_MAX_BODY_BYTES = 512;

/**
 * Voice preview (ADR-0031): `POST /api/v1/voice/preview {voice_id}` → KAREN's fixed sample line
 * in that voice, streamed. Same protections as spoken replies.
 */
export async function handleVoicePreviewProxy(
  request: Request,
  deps: SpeechDeps = {},
): Promise<Response> {
  if (request.method.toUpperCase() !== 'POST') return notFound();
  const text = await request.text();
  if (new TextEncoder().encode(text).length > PREVIEW_MAX_BODY_BYTES) {
    return Response.json(bffError('PAYLOAD_TOO_LARGE', 'Request too large.'), { status: 413 });
  }
  return proxyAudio(request, 'voice/preview', text, deps);
}

async function proxyAudio(
  request: Request,
  path: string,
  body: string | null,
  deps: SpeechDeps,
): Promise<Response> {
  const env = deps.env ?? getServerEnv();
  const siteFailure = checkFetchSite(request) ?? checkStateChangingRequest(request, env);
  if (siteFailure) {
    bffLog('warn', 'bff.speech.csrf_rejected', { reason: siteFailure });
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
    accept: 'audio/mpeg, audio/wav',
    authorization: `Bearer ${token}`,
    'x-request-id': crypto.randomUUID(),
    ...(body !== null ? { 'content-type': 'application/json' } : {}),
  });
  for (const [k, v] of Object.entries(
    await signedClientIpHeaders(env.INTERNAL_SERVICE_HMAC_SECRET, env.BFF_TRUSTED_PROXY_HOPS),
  )) {
    headers.set(k, v);
  }
  const base = env.API_INTERNAL_BASE_URL.replace(/\/+$/, '');
  const upstreamAbort = new AbortController();
  const onClientAbort = () => upstreamAbort.abort();
  request.signal.addEventListener('abort', onClientAbort, { once: true });
  const connectTimer = setTimeout(
    () => upstreamAbort.abort(),
    deps.connectTimeoutMs ?? SPEECH_CONNECT_TIMEOUT_MS,
  );
  let upstream: Response;
  try {
    upstream = await (deps.fetch ?? globalThis.fetch)(`${base}/v1/${path}`, {
      method: 'POST',
      headers,
      ...(body !== null ? { body } : {}),
      redirect: 'manual',
      cache: 'no-store',
      signal: upstreamAbort.signal,
    });
  } catch (e) {
    request.signal.removeEventListener('abort', onClientAbort);
    bffLog('error', 'bff.speech.unreachable', { error: errorName(e) });
    return Response.json(
      bffError('DEPENDENCY_UNAVAILABLE', 'Voice is temporarily unavailable.', { retryable: true }),
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  } finally {
    clearTimeout(connectTimer);
  }
  const outHeaders = new Headers({ 'cache-control': 'no-store' });
  const contentType = upstream.headers.get('content-type') ?? 'application/json';
  outHeaders.set('content-type', contentType);
  const isAudio = upstream.ok && contentType.startsWith('audio/');
  if (!isAudio || !upstream.body) {
    request.signal.removeEventListener('abort', onClientAbort);
    if (upstream.status === 401) outHeaders.append('set-cookie', clearCookie('session', mode));
    return new Response(await upstream.arrayBuffer(), {
      status: upstream.status,
      headers: outHeaders,
    });
  }
  for (const name of SPEECH_RESPONSE_HEADERS) {
    const v = upstream.headers.get(name);
    if (v) outHeaders.set(name, v);
  }
  const reader = upstream.body.getReader();
  const passThrough = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          request.signal.removeEventListener('abort', onClientAbort);
          controller.close();
        } else controller.enqueue(value);
      } catch {
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
