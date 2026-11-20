// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { getServerEnv } from '../env';
import {
  clearCookie,
  cookieModeFor,
  parseCookieHeader,
  readCookie,
  sessionMaxAge,
  setCookie,
} from './cookies';

const local = getServerEnv({ APP_ENV: 'local' });
const prod = getServerEnv({
  APP_ENV: 'production',
  WEB_PUBLIC_ORIGIN: 'https://app.karen.test',
  INTERNAL_SERVICE_HMAC_SECRET: 'test-only-internal-hmac-secret-0123456789',
});

describe('cookie mode', () => {
  it('uses local-http only for local/test over plain http to a private host', () => {
    expect(cookieModeFor('http://localhost:3000/x', local)).toBe('local-http');
    expect(cookieModeFor('http://192.168.1.20:3000/x', local)).toBe('local-http');
    expect(cookieModeFor('http://127.0.0.1:3000/x', getServerEnv({ APP_ENV: 'test' }))).toBe(
      'local-http',
    );
    expect(cookieModeFor('https://localhost:3000/x', local)).toBe('secure');
    expect(cookieModeFor('http://karen.example.com/x', local)).toBe('secure');
  });

  it('is always secure outside local/test, even over http localhost', () => {
    for (const APP_ENV of ['dev', 'staging', 'production']) {
      expect(
        cookieModeFor(
          'http://localhost:3000/x',
          getServerEnv({
            APP_ENV,
            INTERNAL_SERVICE_HMAC_SECRET: 'test-only-internal-hmac-secret-0123456789',
          }),
        ),
      ).toBe('secure');
    }
  });
});

describe('cookie attributes', () => {
  it('production session cookie: __Host-, Secure, HttpOnly, Path=/, SameSite=Lax, no Domain', () => {
    const c = setCookie('session', 'kss_abc', 'secure', 3600);
    expect(c).toBe(
      '__Host-karen_session=kss_abc; Path=/; Max-Age=3600; Secure; HttpOnly; SameSite=Lax',
    );
    expect(c).not.toMatch(/Domain/i);
  });

  it('local-http session cookie drops the prefix and Secure but stays HttpOnly', () => {
    const c = setCookie('session', 'kss_abc', 'local-http', 3600);
    expect(c).toBe('karen_session=kss_abc; Path=/; Max-Age=3600; HttpOnly; SameSite=Lax');
  });

  it('CSRF cookie is readable by JS and SameSite=Strict', () => {
    const c = setCookie('csrf', 'tok', 'secure', 60);
    expect(c).toContain('__Host-karen_csrf=tok');
    expect(c).toContain('SameSite=Strict');
    expect(c).not.toContain('HttpOnly');
  });

  it('challenge and device cookies are HttpOnly', () => {
    expect(setCookie('challenge', 'x', 'secure', 60)).toContain('HttpOnly; SameSite=Strict');
    expect(setCookie('device', 'x', 'secure', 60)).toContain('HttpOnly');
  });

  it('clearing sets Max-Age=0 with the same name and flags', () => {
    expect(clearCookie('session', 'secure')).toBe(
      '__Host-karen_session=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax',
    );
  });

  it('refuses values that could inject attributes', () => {
    expect(() => setCookie('session', 'a; Domain=evil', 'secure', 1)).toThrow();
  });

  it('session lifetime follows the API absolute expiry, capped at 30 days', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    expect(sessionMaxAge('2026-01-01T01:00:00Z', now)).toBe(3600);
    expect(sessionMaxAge('2027-01-01T00:00:00Z', now)).toBe(30 * 24 * 3600);
    expect(sessionMaxAge('garbage', now)).toBe(0);
  });
});

describe('reading cookies', () => {
  it('ignores the plain (non-__Host-) session name in production (subdomain cookie tossing)', () => {
    const jar = parseCookieHeader('karen_session=planted');
    expect(readCookie(jar, 'session', prod)).toBeUndefined();
    expect(readCookie(jar, 'session', local)).toBe('planted');
    expect(readCookie(parseCookieHeader('__Host-karen_session=real'), 'session', prod)).toBe(
      'real',
    );
  });
});
