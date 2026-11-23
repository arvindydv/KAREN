// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { getServerEnv } from '../env';
import { maxBodyBytesFor, resolveAllowedPath, VOICE_UPLOAD_MAX_BODY_BYTES } from './allowlist';
import { handleProxy, MAX_BODY_BYTES } from './proxy-handler';
import { handleSpeechProxy } from './speech-proxy';

/** Voice through the BFF (ADR-0026): larger upload cap on one route, streamed audio back. */
const env = getServerEnv({
  APP_ENV: 'production',
  WEB_PUBLIC_ORIGIN: 'https://app.karen.test',
  API_INTERNAL_BASE_URL: 'http://api.internal:4100',
  INTERNAL_SERVICE_HMAC_SECRET: 'test-only-internal-hmac-secret-0123456789',
});
const ORIGIN = 'https://app.karen.test';
const CID = '0b5e8a5c-1c1d-4f7a-9d55-2b1f7a3c9e10';
const MID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const COOKIES = '__Host-karen_session=kss_secret_token; __Host-karen_csrf=csrf123';
const STATE_CHANGING = {
  origin: ORIGIN,
  'sec-fetch-site': 'same-origin',
  'x-csrf-token': 'csrf123',
};

const speechRequest = (headers: Record<string, string> = STATE_CHANGING, signal?: AbortSignal) =>
  new Request(`${ORIGIN}/api/v1/conversations/${CID}/messages/${MID}/speech`, {
    method: 'POST',
    headers: { cookie: COOKIES, ...headers },
    ...(signal ? { signal } : {}),
  });

const audio = (chunks: string[], headers: Record<string, string> = {}) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        for (const x of chunks) c.enqueue(new TextEncoder().encode(x));
        c.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'audio/mpeg', ...headers } },
  );

describe('voice allowlist', () => {
  it('allows only POST transcriptions and gives that route alone a larger body cap', () => {
    expect(resolveAllowedPath('POST', ['voice', 'transcriptions'])).toBe('voice/transcriptions');
    expect(resolveAllowedPath('GET', ['voice', 'transcriptions'])).toBeNull();
    expect(maxBodyBytesFor('POST', 'voice/transcriptions', MAX_BODY_BYTES)).toBe(
      VOICE_UPLOAD_MAX_BODY_BYTES,
    );
    expect(maxBodyBytesFor('POST', `conversations/${CID}/messages`, MAX_BODY_BYTES)).toBe(
      MAX_BODY_BYTES,
    );
    // Speech never goes through the buffered JSON proxy.
    expect(
      resolveAllowedPath('POST', ['conversations', CID, 'messages', MID, 'speech']),
    ).toBeNull();
  });

  it('forwards a voice upload above 64 KiB but refuses one above the voice cap', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(Response.json({ text: 'hello', language: 'en', is_mock: true })),
    );
    const upload = (size: number) =>
      new Request(`${ORIGIN}/api/v1/voice/transcriptions`, {
        method: 'POST',
        headers: { cookie: COOKIES, 'content-type': 'application/json', ...STATE_CHANGING },
        body: JSON.stringify({ audio_base64: 'A'.repeat(size), audio_format: 'webm' }),
      });
    const ok = await handleProxy(upload(200_000), ['voice', 'transcriptions'], { env, fetch });
    expect(ok.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
    const tooBig = await handleProxy(
      upload(VOICE_UPLOAD_MAX_BODY_BYTES),
      ['voice', 'transcriptions'],
      { env, fetch },
    );
    expect(tooBig.status).toBe(413);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('speech proxy', () => {
  it('streams audio with voice metadata, the session as bearer, and no cookies', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(
        audio(['ID3', 'frame'], {
          'x-karen-voice-id': 'v1',
          'x-karen-is-mock': 'false',
          'x-karen-speech-language': 'hi',
          'set-cookie': 'x=1',
        }),
      ),
    );
    const res = await handleSpeechProxy(speechRequest(), CID, MID, { env, fetch });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/mpeg');
    expect(res.headers.get('x-karen-voice-id')).toBe('v1');
    expect(res.headers.get('x-karen-speech-language')).toBe('hi');
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(await res.text()).toBe('ID3frame');
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(`http://api.internal:4100/v1/conversations/${CID}/messages/${MID}/speech`);
    const h = new Headers(init?.headers);
    expect(h.get('authorization')).toBe('Bearer kss_secret_token');
    expect(h.get('cookie')).toBeNull();
  });

  it('requires CSRF protection (it is a state-changing, billable call)', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    for (const headers of [
      {},
      { ...STATE_CHANGING, origin: 'https://evil.example' },
      { ...STATE_CHANGING, 'x-csrf-token': 'wrong' },
    ]) {
      const res = await handleSpeechProxy(speechRequest(headers), CID, MID, { env, fetch });
      expect(res.status).toBe(403);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('passes API errors through as JSON and rejects malformed ids', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(Response.json({ error: { code: 'USAGE_LIMIT_REACHED' } }, { status: 429 })),
    );
    const res = await handleSpeechProxy(speechRequest(), CID, MID, { env, fetch });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: { code: 'USAGE_LIMIT_REACHED' } });
    expect(
      (await handleSpeechProxy(speechRequest(), 'not-a-uuid', MID, { env, fetch })).status,
    ).toBe(404);
  });

  it('aborts the upstream request when the listener interrupts playback', async () => {
    let upstreamSignal: AbortSignal | undefined;
    const fetch = vi.fn<typeof globalThis.fetch>((_url, init) => {
      upstreamSignal = init?.signal ?? undefined;
      return Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(c) {
              c.enqueue(new Uint8Array([1]));
            },
          }),
          {
            status: 200,
            headers: { 'content-type': 'audio/mpeg' },
          },
        ),
      );
    });
    const client = new AbortController();
    const res = await handleSpeechProxy(speechRequest(STATE_CHANGING, client.signal), CID, MID, {
      env,
      fetch,
    });
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();
    expect(upstreamSignal?.aborted).toBe(true);
  });
});
