// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { getServerEnv } from '../env';
import { resolveAllowedPath } from './allowlist';
import { handleStreamProxy } from './stream-proxy';

const env = getServerEnv({
  APP_ENV: 'production',
  WEB_PUBLIC_ORIGIN: 'https://app.karen.test',
  API_INTERNAL_BASE_URL: 'http://api.internal:4100',
  INTERNAL_SERVICE_HMAC_SECRET: 'test-only-internal-hmac-secret-0123456789',
});
const ORIGIN = 'https://app.karen.test';
const CID = '0b5e8a5c-1c1d-4f7a-9d55-2b1f7a3c9e10';
const MID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

const browser = (headers: Record<string, string> = {}, query = '', signal?: AbortSignal) =>
  new Request(`${ORIGIN}/api/v1/conversations/${CID}/messages/${MID}/stream${query}`, {
    headers: { cookie: '__Host-karen_session=kss_secret_token; __Host-karen_csrf=c', ...headers },
    ...(signal ? { signal } : {}),
  });

const sse = (chunks: string[], hold = false) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        for (const x of chunks) c.enqueue(new TextEncoder().encode(x));
        if (!hold) c.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream', 'x-request-id': 'req-1' } },
  );

describe('stream proxy', () => {
  it('streams the body through with the session as bearer, resume headers, and no cookies', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(sse(['id: 1\ndata: {"seq":1}\n\n', 'id: 2\ndata: {"seq":2}\n\n'])),
    );
    const res = await handleStreamProxy(
      browser(
        { 'last-event-id': '7', authorization: 'Bearer attacker', 'sec-fetch-site': 'same-origin' },
        '?after=3',
      ),
      CID,
      MID,
      { env, fetch },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-store, no-transform');
    expect(res.headers.get('x-accel-buffering')).toBe('no');
    expect(await res.text()).toBe('id: 1\ndata: {"seq":1}\n\nid: 2\ndata: {"seq":2}\n\n');
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(
      `http://api.internal:4100/v1/conversations/${CID}/messages/${MID}/stream?after=3`,
    );
    const h = new Headers(init?.headers);
    expect(h.get('authorization')).toBe('Bearer kss_secret_token');
    expect(h.get('last-event-id')).toBe('7');
    expect(h.get('cookie')).toBeNull();
  });

  it('drops malformed resume values', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(sse([])));
    await handleStreamProxy(browser({ 'last-event-id': '1; drop' }, '?after=x'), CID, MID, {
      env,
      fetch,
    });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url as string).not.toContain('?after');
    expect(new Headers(init?.headers).get('last-event-id')).toBeNull();
  });

  it('rejects cross-site requests and non-UUID paths without calling the API', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    expect(
      (
        await handleStreamProxy(browser({ 'sec-fetch-site': 'cross-site' }), CID, MID, {
          env,
          fetch,
        })
      ).status,
    ).toBe(403);
    expect((await handleStreamProxy(browser(), 'nope', MID, { env, fetch })).status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('401 without a session cookie, and clears the cookie when the API says 401', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(
        Response.json(
          {
            error: { code: 'UNAUTHENTICATED', message: 'x', correlation_id: 'c', retryable: false },
          },
          { status: 401 },
        ),
      ),
    );
    const anon = new Request(`${ORIGIN}/api/v1/conversations/${CID}/messages/${MID}/stream`);
    expect((await handleStreamProxy(anon, CID, MID, { env, fetch })).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
    const res = await handleStreamProxy(browser(), CID, MID, { env, fetch });
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toMatch(/^__Host-karen_session=;.*Max-Age=0/);
  });

  it('passes JSON errors through unchanged (e.g. 404 for someone else’s message)', async () => {
    const body = {
      error: {
        code: 'NOT_FOUND',
        message: 'Message not found.',
        correlation_id: 'c1',
        retryable: false,
      },
    };
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(Response.json(body, { status: 404 })),
    );
    const res = await handleStreamProxy(browser(), CID, MID, { env, fetch });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(body);
  });

  it('503 envelope when the API is unreachable', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.reject(new TypeError('fetch failed')),
    );
    const res = await handleStreamProxy(browser(), CID, MID, { env, fetch });
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('DEPENDENCY_UNAVAILABLE');
  });

  it('aborts the upstream request when the browser disconnects', async () => {
    let upstreamSignal: AbortSignal | undefined;
    const fetch = vi.fn<typeof globalThis.fetch>((_u, init) => {
      upstreamSignal = init?.signal ?? undefined;
      return Promise.resolve(sse(['id: 1\ndata: {}\n\n'], true));
    });
    const client = new AbortController();
    const res = await handleStreamProxy(browser({}, '', client.signal), CID, MID, { env, fetch });
    const reader = res.body!.getReader();
    await reader.read();
    client.abort();
    expect(upstreamSignal?.aborted).toBe(true);
    await reader.cancel();
  });

  it('times out only the connection, not a long-running stream', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      (_u, init) =>
        new Promise((_, reject) =>
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
        ),
    );
    const res = await handleStreamProxy(browser(), CID, MID, { env, fetch, connectTimeoutMs: 20 });
    expect(res.status).toBe(503);
  });
});

describe('allowlist (Phase 02 conversations)', () => {
  const segs = (p: string) => p.split('/');
  it('allows the conversation API surface and nothing more', () => {
    for (const [m, p] of [
      ['GET', 'me/ai-usage'],
      ['GET', 'conversations'],
      ['POST', 'conversations'],
      ['GET', `conversations/${CID}`],
      ['PATCH', `conversations/${CID}`],
      ['DELETE', `conversations/${CID}`],
      ['GET', `conversations/${CID}/messages`],
      ['POST', `conversations/${CID}/messages`],
      ['POST', `conversations/${CID}/fork`],
      ['GET', `conversations/${CID}/messages/${MID}`],
      ['POST', `conversations/${CID}/messages/${MID}/cancel`],
      ['POST', `conversations/${CID}/messages/${MID}/regenerate`],
      ['POST', `conversations/${CID}/messages/${MID}/feedback`],
      ['DELETE', `conversations/${CID}/messages/${MID}/feedback`],
    ] as const) {
      expect(resolveAllowedPath(m, segs(p)), `${m} ${p}`).toBe(p);
    }
    for (const [m, p] of [
      ['PUT', `conversations/${CID}`],
      ['DELETE', `conversations/${CID}/messages/${MID}`],
      ['GET', `conversations/${CID}/messages/${MID}/stream`], // dedicated route only
      ['POST', `conversations/not-a-uuid/messages`],
      ['GET', `conversations/${CID}/messages/${MID}/cancel`],
    ] as const) {
      expect(resolveAllowedPath(m, segs(p)), `${m} ${p}`).toBeNull();
    }
  });
});
