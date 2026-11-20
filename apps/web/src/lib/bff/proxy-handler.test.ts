// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { getServerEnv } from '../env';
import { resolveAllowedPath } from './allowlist';
import { handleProxy } from './proxy-handler';

const env = getServerEnv({
  APP_ENV: 'production',
  WEB_PUBLIC_ORIGIN: 'https://app.karen.test',
  API_INTERNAL_BASE_URL: 'http://api.internal:4100',
  INTERNAL_SERVICE_HMAC_SECRET: 'test-only-internal-hmac-secret-0123456789',
});
const ORIGIN = 'https://app.karen.test';
const SESSION = '__Host-karen_session=kss_secret_token';
const CSRF = '__Host-karen_csrf=csrf123';

function mockApi(response: Response = Response.json({ ok: true })) {
  return vi.fn<typeof fetch>(() => Promise.resolve(response.clone()));
}

function browser(
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: string,
) {
  return new Request(`${ORIGIN}/api/v1/${path}`, {
    method,
    headers: {
      cookie: `${SESSION}; ${CSRF}`,
      ...(method === 'GET'
        ? {}
        : { origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'x-csrf-token': 'csrf123' }),
      ...headers,
    },
    ...(body !== undefined ? { body } : {}),
  });
}

const segs = (p: string) => p.split('/');

describe('allowlist', () => {
  it('allows listed method + path pairs only', () => {
    expect(resolveAllowedPath('GET', segs('me'))).toBe('me');
    expect(resolveAllowedPath('PATCH', segs('me/profile'))).toBe('me/profile');
    expect(resolveAllowedPath('PUT', segs('me/consents/MEMORY_STORAGE'))).toBe(
      'me/consents/MEMORY_STORAGE',
    );
    expect(
      resolveAllowedPath('DELETE', segs('me/sessions/0b5e8a5c-1c1d-4f7a-9d55-2b1f7a3c9e10')),
    ).not.toBeNull();
    expect(resolveAllowedPath('DELETE', segs('me/profile'))).toBeNull(); // method not allowed
    expect(resolveAllowedPath('POST', segs('auth/login'))).toBeNull(); // login only via /api/auth/login
    expect(resolveAllowedPath('POST', segs('auth/token/refresh'))).toBeNull();
    expect(resolveAllowedPath('GET', segs('admin/system'))).toBeNull();
    expect(resolveAllowedPath('DELETE', segs('me/sessions/not-a-uuid'))).toBeNull();
    expect(resolveAllowedPath('GET', ['me', '..', 'admin'])).toBeNull();
    expect(resolveAllowedPath('GET', ['me%2F..'])).toBeNull();
  });
});

describe('handleProxy', () => {
  it('404s unknown paths without calling the API', async () => {
    const fetch = mockApi();
    const res = await handleProxy(
      browser('GET', 'internal/v1/data-rights'),
      segs('internal/v1/data-rights'),
      { env, fetch },
    );
    expect(res.status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('forwards the session as a bearer token and never forwards cookies or client auth headers', async () => {
    const fetch = mockApi();
    const req = browser('GET', 'me/profile', {
      authorization: 'Bearer attacker',
      'x-forwarded-for': '1.2.3.4',
      connection: 'keep-alive',
    });
    const res = await handleProxy(req, segs('me/profile'), { env, fetch });
    expect(res.status).toBe(200);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('http://api.internal:4100/v1/me/profile');
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe('Bearer kss_secret_token');
    expect(headers.get('cookie')).toBeNull();
    expect(headers.get('x-forwarded-for')).toBeNull();
    expect(headers.get('connection')).toBeNull();
  });

  it('forwards only safe headers on mutations (content-type, if-match, idempotency-key)', async () => {
    const fetch = mockApi();
    const req = browser(
      'PUT',
      'me/consents/MEMORY_STORAGE',
      {
        'content-type': 'application/json',
        'if-match': '"3"',
        'idempotency-key': 'abcdefgh123',
        'x-access-reason': 'x',
      },
      JSON.stringify({ decision: 'grant', notice_version: '1', source: 'settings' }),
    );
    const res = await handleProxy(req, segs('me/consents/MEMORY_STORAGE'), { env, fetch });
    expect(res.status).toBe(200);
    const headers = new Headers(fetch.mock.calls[0]![1]?.headers);
    expect(headers.get('if-match')).toBe('"3"');
    expect(headers.get('idempotency-key')).toBe('abcdefgh123');
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('x-access-reason')).toBeNull();
    expect(headers.get('x-csrf-token')).toBeNull();
    expect(fetch.mock.calls[0]![1]?.body).toContain('"decision":"grant"');
  });

  it('403s a mutation with no Origin / wrong Origin / missing or wrong CSRF token', async () => {
    const fetch = mockApi();
    const cases: Record<string, string>[] = [
      { origin: '' },
      { origin: 'https://evil.example' },
      { 'x-csrf-token': '' },
      { 'x-csrf-token': 'nope' },
      { 'sec-fetch-site': 'cross-site' },
    ];
    for (const override of cases) {
      const req = browser('PATCH', 'me/profile', override, '{}');
      const h = new Headers(req.headers);
      for (const [k, v] of Object.entries(override)) if (v === '') h.delete(k);
      const res = await handleProxy(new Request(req, { headers: h }), segs('me/profile'), {
        env,
        fetch,
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('FORBIDDEN');
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects cross-site GETs too', async () => {
    const fetch = mockApi();
    const res = await handleProxy(
      browser('GET', 'me', { 'sec-fetch-site': 'cross-site' }),
      ['me'],
      { env, fetch },
    );
    expect(res.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('passes through the API status and error envelope, and never passes Set-Cookie', async () => {
    const envelope = {
      error: {
        code: 'PRECONDITION_FAILED',
        message: 'Stale.',
        correlation_id: 'c1',
        retryable: false,
      },
    };
    const fetch = mockApi(
      Response.json(envelope, { status: 412, headers: { 'set-cookie': 'x=y', etag: '"4"' } }),
    );
    const res = await handleProxy(
      browser('PATCH', 'me/profile', {}, '{"locale":"en-IN"}'),
      segs('me/profile'),
      { env, fetch },
    );
    expect(res.status).toBe(412);
    expect(await res.json()).toEqual(envelope);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(res.headers.get('etag')).toBe('"4"');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('answers 401 without calling the API when there is no session cookie', async () => {
    const fetch = mockApi();
    const res = await handleProxy(browser('GET', 'me', { cookie: CSRF }), ['me'], { env, fetch });
    expect(res.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('clears the session cookie when the API says the session is gone', async () => {
    const fetch = mockApi(
      Response.json(
        { error: { code: 'UNAUTHENTICATED', message: 'x', correlation_id: 'c', retryable: false } },
        { status: 401 },
      ),
    );
    const res = await handleProxy(browser('GET', 'me'), ['me'], { env, fetch });
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toContain('__Host-karen_session=; Path=/; Max-Age=0');
  });

  it('logout clears the cookie even when the API call fails', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.reject(new TypeError('connect ECONNREFUSED')),
    );
    const res = await handleProxy(browser('POST', 'auth/logout'), segs('auth/logout'), {
      env,
      fetch,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toContain('__Host-karen_session=; Path=/; Max-Age=0');
  });

  it('maps an unreachable API to a retryable 503 envelope', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.reject(new TypeError('fetch failed')),
    );
    const res = await handleProxy(browser('GET', 'me'), ['me'], { env, fetch });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string; retryable: boolean } };
    expect(body.error).toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE', retryable: true });
  });

  it('rejects oversized bodies', async () => {
    const fetch = mockApi();
    const res = await handleProxy(
      browser('PATCH', 'me/profile', {}, 'x'.repeat(70 * 1024)),
      segs('me/profile'),
      { env, fetch },
    );
    expect(res.status).toBe(413);
    expect(fetch).not.toHaveBeenCalled();
  });
});
