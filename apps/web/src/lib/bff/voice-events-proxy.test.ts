// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { getServerEnv } from '../env';
import { maxBodyBytesFor, resolveAllowedPath, VOICE_EVENTS_PATH } from './allowlist';
import { handleVoiceEventsProxy } from './stream-proxy';

const env = getServerEnv({
  APP_ENV: 'production',
  WEB_PUBLIC_ORIGIN: 'https://app.karen.test',
  API_INTERNAL_BASE_URL: 'http://api.internal:4100',
  INTERNAL_SERVICE_HMAC_SECRET: 'test-only-internal-hmac-secret-0123456789',
});
const ORIGIN = 'https://app.karen.test';
const SID = `lv_${'a1B2'.repeat(10)}`;

const browser = (headers: Record<string, string> = {}, query = '') =>
  new Request(`${ORIGIN}/api/v1/voice/sessions/${SID}/events${query}`, {
    headers: { cookie: '__Host-karen_session=kss_secret_token; __Host-karen_csrf=c', ...headers },
  });

const sse = (body: string) =>
  new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });

describe('live voice BFF routes (ADR-0027)', () => {
  it('allowlists exactly the live voice calls', () => {
    expect(resolveAllowedPath('GET', ['voice', 'options'])).toBe('voice/options');
    expect(resolveAllowedPath('POST', ['voice', 'sessions'])).toBe('voice/sessions');
    expect(resolveAllowedPath('POST', ['voice', 'sessions', SID, 'audio'])).not.toBeNull();
    expect(resolveAllowedPath('POST', ['voice', 'sessions', SID, 'close'])).not.toBeNull();
    // Events only via the dedicated SSE route; other methods and malformed IDs are denied.
    expect(resolveAllowedPath('GET', ['voice', 'sessions', SID, 'events'])).toBeNull();
    expect(resolveAllowedPath('DELETE', ['voice', 'sessions', SID, 'close'])).toBeNull();
    expect(resolveAllowedPath('POST', ['voice', 'sessions', 'lv_short', 'audio'])).toBeNull();
    expect(resolveAllowedPath('GET', ['voice', 'sessions'])).toBeNull();
    expect(maxBodyBytesFor('POST', `voice/sessions/${SID}/audio`, 1)).toBeGreaterThan(44_000);
    expect(VOICE_EVENTS_PATH.test(`voice/sessions/${SID}/events`)).toBe(true);
  });

  it('streams events with the session as bearer and a validated resume cursor', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(sse('id: 1700000000000-1\nevent: ready\ndata: {"type":"ready"}\n\n')),
    );
    const res = await handleVoiceEventsProxy(
      browser(
        { 'sec-fetch-site': 'same-origin', authorization: 'Bearer x' },
        '?after=1700000000000-0',
      ),
      SID,
      { env, fetch },
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('"type":"ready"');
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(
      `http://api.internal:4100/v1/voice/sessions/${SID}/events?after=1700000000000-0`,
    );
    const h = new Headers(init?.headers);
    expect(h.get('authorization')).toBe('Bearer kss_secret_token');
    expect(h.get('cookie')).toBeNull();
  });

  it('drops malformed cursors and rejects cross-site or malformed session IDs', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(sse('')));
    await handleVoiceEventsProxy(browser({}, '?after=1;drop'), SID, { env, fetch });
    expect(fetch.mock.calls[0]![0] as string).not.toContain('after');
    const blocked = vi.fn<typeof globalThis.fetch>();
    expect(
      (
        await handleVoiceEventsProxy(browser({ 'sec-fetch-site': 'cross-site' }), SID, {
          env,
          fetch: blocked,
        })
      ).status,
    ).toBe(403);
    expect((await handleVoiceEventsProxy(browser(), '../me', { env, fetch: blocked })).status).toBe(
      404,
    );
    expect(blocked).not.toHaveBeenCalled();
  });

  it('passes JSON errors (e.g. 404 for another user’s session) through', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(Response.json({ error: { code: 'NOT_FOUND' } }, { status: 404 })),
    );
    const res = await handleVoiceEventsProxy(browser(), SID, { env, fetch });
    expect(res.status).toBe(404);
  });
});
