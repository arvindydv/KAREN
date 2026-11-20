// @vitest-environment node
import { NextRequest } from 'next/server';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { generateCsrfToken } from '@/lib/security/csrf';

const APP = 'http://localhost:3101';
const STAFF_TOKEN = `kst_${'s'.repeat(43)}`;
const STAFF_ID = '3f2b8c1e-9d4a-4b7e-8c2f-1a2b3c4d5e6f';
const csrf = generateCsrfToken();

beforeAll(() => {
  vi.stubEnv('APP_ENV', 'test');
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('API_INTERNAL_BASE_URL', 'http://api.internal:4100');
});
afterEach(() => vi.unstubAllGlobals());

interface Captured {
  url: string;
  method: string;
  headers: Headers;
  body: string | null;
}

/** Mock the upstream API; record exactly what the BFF sent. */
function mockUpstream(status: number, body: unknown) {
  const calls: Captured[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      calls.push({
        url: request.url,
        method: request.method,
        headers: request.headers,
        body: request.body ? await request.text() : null,
      });
      return new Response(body === null ? null : JSON.stringify(body), {
        status,
        headers: body === null ? {} : { 'content-type': 'application/json' },
      });
    }),
  );
  return calls;
}

function bffRequest(
  path: string,
  init: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
    session?: boolean;
  } = {},
) {
  const headers: Record<string, string> = {
    origin: APP,
    'sec-fetch-site': 'same-origin',
    'x-csrf-token': csrf,
    cookie: `karen_staff_csrf=${csrf}${init.session === false ? '' : `; karen_staff=${STAFF_TOKEN}`}; other=1`,
    ...init.headers,
  };
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  return new NextRequest(`${APP}${path}`, {
    method: init.method ?? 'POST',
    headers,
    body: init.body === undefined ? null : JSON.stringify(init.body),
  });
}

const params = (path: string) => ({ params: Promise.resolve({ path: path.split('/') }) });

describe('staff relay /api/staff/*', () => {
  it('refuses requests without a valid CSRF token or from another origin, without calling the API', async () => {
    const { POST } = await import('./staff/[...path]/route');
    const calls = mockUpstream(201, {});
    const noCsrf = await POST(
      bffRequest('/api/staff/invitations', { body: {}, headers: { 'x-csrf-token': '' } }),
      params('invitations'),
    );
    expect(noCsrf.status).toBe(403);
    const crossSite = await POST(
      bffRequest('/api/staff/invitations', { body: {}, headers: { origin: 'https://evil.test' } }),
      params('invitations'),
    );
    expect(crossSite.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it('404s for paths outside the allowlist', async () => {
    const { GET } = await import('./staff/[...path]/route');
    const calls = mockUpstream(200, {});
    const response = await GET(
      bffRequest('/api/staff/auth/me', { method: 'GET' }),
      params('auth/me'),
    );
    expect(response.status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it('adds the bearer from the HttpOnly cookie and never forwards browser cookies', async () => {
    const { GET } = await import('./staff/[...path]/route');
    const calls = mockUpstream(200, {
      user_id: STAFF_ID,
      status: 'active',
      created_at: '2026-11-20T00:00:00.000Z',
    });
    const response = await GET(
      bffRequest(`/api/staff/users/${STAFF_ID}/status`, {
        method: 'GET',
        headers: { 'x-access-reason': 'Ticket SUP-42: user cannot sign in', 'x-other': 'nope' },
      }),
      params(`users/${STAFF_ID}/status`),
    );
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe(`http://api.internal:4100/v1/staff/users/${STAFF_ID}/status`);
    expect(call?.headers.get('authorization')).toBe(`Bearer ${STAFF_TOKEN}`);
    expect(call?.headers.get('x-access-reason')).toBe('Ticket SUP-42: user cannot sign in');
    expect(call?.headers.get('cookie')).toBeNull();
    expect(call?.headers.get('x-other')).toBeNull();
    expect(call?.headers.get('x-csrf-token')).toBeNull();
  });

  it('rejects a lookup without an access reason before calling the API', async () => {
    const { GET } = await import('./staff/[...path]/route');
    const calls = mockUpstream(200, {});
    const response = await GET(
      bffRequest(`/api/staff/users/${STAFF_ID}/status`, { method: 'GET' }),
      params(`users/${STAFF_ID}/status`),
    );
    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('validates bodies against the contract and relays STEP_UP_REQUIRED unchanged', async () => {
    const { POST } = await import('./staff/[...path]/route');
    const stepUp = {
      error: {
        code: 'STEP_UP_REQUIRED',
        message: 'Confirm',
        correlation_id: 'c1',
        retryable: false,
      },
    };
    const calls = mockUpstream(403, stepUp);
    const bad = await POST(
      bffRequest('/api/staff/invitations', { body: { email: 'a@b.c', roles: [], sneaky: true } }),
      params('invitations'),
    );
    expect(bad.status).toBe(400);
    const ok = await POST(
      bffRequest('/api/staff/invitations', {
        body: { email: 'new@karen.test', display_name: 'New Person', roles: ['support_agent'] },
      }),
      params('invitations'),
    );
    expect(ok.status).toBe(403);
    expect(await ok.json()).toEqual(stepUp);
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({
      email: 'new@karen.test',
      display_name: 'New Person',
      roles: ['support_agent'],
    });
  });

  it('clears the session cookie when the API says the session is gone', async () => {
    const { PUT } = await import('./staff/[...path]/route');
    mockUpstream(401, {
      error: { code: 'UNAUTHENTICATED', message: 'x', correlation_id: 'c', retryable: false },
    });
    const response = await PUT(
      bffRequest(`/api/staff/accounts/${STAFF_ID}/roles/ops_admin`, { method: 'PUT' }),
      params(`accounts/${STAFF_ID}/roles/ops_admin`),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie')).toMatch(/karen_staff=;.*Max-Age=0/i);
  });
});

describe('session routes', () => {
  const me = {
    id: STAFF_ID,
    email: 'ops@karen.test',
    display_name: 'Ops',
    roles: ['security_admin'],
    elevated_roles: [],
    permissions: ['ops:read', 'audit:read', 'staff:manage'],
    session_expires_at: '2026-11-20T10:00:00.000Z',
    step_up_valid_until: '2026-11-20T09:05:00.000Z',
  };

  it('login/verify stores the staff token in an HttpOnly SameSite=Strict cookie and never returns it', async () => {
    const { POST } = await import('./session/login/verify/route');
    mockUpstream(200, { session_token: STAFF_TOKEN, me });
    const response = await POST(
      bffRequest('/api/session/login/verify', {
        body: { ceremony_handle: 'kwc_handle', credential: { id: 'x' } },
        session: false,
      }),
    );
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain(STAFF_TOKEN);
    expect(JSON.parse(text)).toEqual({ me });
    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toContain(`karen_staff=${STAFF_TOKEN}`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=strict/i);
    expect(cookie).toMatch(/Path=\//);
  });

  it('login/options refuses cross-origin posts (login CSRF)', async () => {
    const { POST } = await import('./session/login/options/route');
    const calls = mockUpstream(200, {});
    const response = await POST(
      bffRequest('/api/session/login/options', {
        body: { email: 'a@b.c', password: 'x'.repeat(20) },
        headers: { origin: 'https://evil.test' },
        session: false,
      }),
    );
    expect(response.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it('logout clears the cookie even when the API is unreachable', async () => {
    const { POST } = await import('./session/logout/route');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('fetch failed'))),
    );
    const response = await POST(bffRequest('/api/session/logout'));
    expect(response.status).toBe(204);
    expect(response.headers.get('set-cookie')).toMatch(/karen_staff=;.*Max-Age=0/i);
  });
});
