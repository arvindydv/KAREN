// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { getServerEnv } from '../env';
import {
  decodeChallenge,
  encodeChallenge,
  handleLogin,
  handleRegister,
  handleVerifyEmail,
} from './auth-handlers';

const env = getServerEnv({
  APP_ENV: 'production',
  WEB_PUBLIC_ORIGIN: 'https://app.karen.test',
  INTERNAL_SERVICE_HMAC_SECRET: 'test-only-internal-hmac-secret-0123456789',
});
const ORIGIN = 'https://app.karen.test';
const DEVICE = '9b2e1c3a-4d5e-4f60-8a7b-1c2d3e4f5a6b';

function post(
  path: string,
  body: unknown,
  cookie = '__Host-karen_csrf=c1',
  extra: Record<string, string> = {},
) {
  return new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: {
      origin: ORIGIN,
      'sec-fetch-site': 'same-origin',
      'x-csrf-token': 'c1',
      'content-type': 'application/json',
      cookie,
      ...extra,
    },
    body: JSON.stringify(body),
  });
}

const setCookies = (res: Response) => res.headers.getSetCookie();
const challenge = {
  challenge_handle: 'chl_handle_123',
  expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
  code_length: 6,
  delivery: 'email',
};

describe('login', () => {
  it('stores the session token ONLY in an HttpOnly __Host- cookie and rotates CSRF', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(
        Response.json({
          result: 'signed_in',
          user_id: '0b5e8a5c-1c1d-4f7a-9d55-2b1f7a3c9e10',
          session_id: '1b5e8a5c-1c1d-4f7a-9d55-2b1f7a3c9e10',
          session_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
          account_status: 'ACTIVE',
          session_token: 'kss_secret',
        }),
      ),
    );
    const res = await handleLogin(
      post(
        '/api/auth/login',
        { email: 'a@example.com', password: 'correct horse battery' },
        `__Host-karen_csrf=c1; __Host-karen_device=${DEVICE}`,
      ),
      { env, fetch },
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain('kss_secret');
    const cookies = setCookies(res);
    const session = cookies.find((c) => c.startsWith('__Host-karen_session='));
    expect(session).toMatch(
      /^__Host-karen_session=kss_secret; Path=\/; Max-Age=\d+; Secure; HttpOnly; SameSite=Lax$/,
    );
    const csrf = cookies.find((c) => c.startsWith('__Host-karen_csrf='));
    expect(csrf).toBeDefined();
    expect(csrf).not.toContain('csrf=c1;');
    // Sent to the API as a web client with the existing installation id.
    const sent = JSON.parse(fetch.mock.calls[0]![1]?.body as string) as {
      client: string;
      device: { installation_id: string };
    };
    expect(sent.client).toBe('web');
    expect(sent.device.installation_id).toBe(DEVICE);
  });

  it('verification_required → challenge cookie, no handle in the body', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(Response.json({ result: 'verification_required', challenge })),
    );
    const res = await handleLogin(
      post('/api/auth/login', { email: 'a@example.com', password: 'x' }),
      { env, fetch },
    );
    expect(await res.json()).toEqual({ result: 'verification_required' });
    expect(
      setCookies(res).some(
        (c) => c.startsWith('__Host-karen_challenge=') && c.includes('HttpOnly'),
      ),
    ).toBe(true);
    expect(setCookies(res).some((c) => c.startsWith('__Host-karen_session='))).toBe(false);
  });

  it('passes API errors through (status + envelope) without setting a session', async () => {
    const envelope = {
      error: {
        code: 'INVALID_CREDENTIALS',
        message: 'Wrong e-mail or password.',
        correlation_id: 'c',
        retryable: false,
      },
    };
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(Response.json(envelope, { status: 401 })),
    );
    const res = await handleLogin(
      post('/api/auth/login', { email: 'a@example.com', password: 'x' }),
      { env, fetch },
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(envelope);
    expect(setCookies(res).some((c) => c.startsWith('__Host-karen_session='))).toBe(false);
  });

  it('requires same-origin + CSRF', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const res = await handleLogin(
      post('/api/auth/login', { email: 'a@example.com', password: 'x' }, '__Host-karen_csrf=c1', {
        origin: 'https://evil.example',
      }),
      { env, fetch },
    );
    expect(res.status).toBe(403);
    const res2 = await handleLogin(
      post('/api/auth/login', { email: 'a@example.com', password: 'x' }, ''),
      { env, fetch },
    );
    expect(res2.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects unexpected body fields (no mass assignment to the API)', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const res = await handleLogin(
      post('/api/auth/login', { email: 'a@example.com', password: 'x', client: 'ios' }),
      { env, fetch },
    );
    expect(res.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('register / verify', () => {
  it('register keeps the challenge handle out of the response body', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(Response.json(challenge, { status: 202 })),
    );
    const res = await handleRegister(
      post('/api/auth/register', { email: 'a@example.com', password: 'p'.repeat(20) }),
      { env, fetch },
    );
    expect(res.status).toBe(202);
    expect(await res.text()).not.toContain('chl_handle_123');
    const cookie = setCookies(res).find((c) => c.startsWith('__Host-karen_challenge='));
    expect(cookie).toMatch(/HttpOnly; SameSite=Strict$/);
  });

  it('verify-email without a challenge cookie fails without calling the API', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const res = await handleVerifyEmail(post('/api/auth/verify-email', { code: '123456' }), {
      env,
      fetch,
    });
    expect(res.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('verify-email sends the handle from the cookie and clears it on success', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(Response.json({ status: 'email_verified', next: 'sign_in' })),
    );
    const cookie = `__Host-karen_csrf=c1; __Host-karen_challenge=${encodeChallenge('chl_handle_123', 'verify')}`;
    const res = await handleVerifyEmail(
      post('/api/auth/verify-email', { code: '123456' }, cookie),
      { env, fetch },
    );
    expect(res.status).toBe(200);
    expect(JSON.parse(fetch.mock.calls[0]![1]?.body as string)).toEqual({
      challenge_handle: 'chl_handle_123',
      code: '123456',
    });
    expect(
      setCookies(res).some(
        (c) => c.startsWith('__Host-karen_challenge=;') && c.includes('Max-Age=0'),
      ),
    ).toBe(true);
  });

  it('challenge cookie encoding round-trips and rejects tampering', () => {
    expect(decodeChallenge(encodeChallenge('h', 'reset'))).toEqual({ h: 'h', p: 'reset' });
    expect(decodeChallenge('not-base64!')).toBeNull();
    expect(decodeChallenge(undefined)).toBeNull();
  });
});
