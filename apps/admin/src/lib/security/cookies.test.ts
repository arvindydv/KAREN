import { describe, expect, it } from 'vitest';
import { allowsInsecureCookies, csrfCookie, expired, sessionCookie } from './cookies';

describe('staff cookie policy', () => {
  it('uses __Host- + Secure + HttpOnly + SameSite=Strict + Path=/ for production builds', () => {
    const spec = sessionCookie({ APP_ENV: 'production', NODE_ENV: 'production' });
    expect(spec.name).toBe('__Host-karen_staff');
    expect(spec.options).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
      maxAge: 8 * 60 * 60,
    });
    expect(spec.options).not.toHaveProperty('domain');
  });

  it('stays secure for a production build even when APP_ENV says local/test', () => {
    for (const APP_ENV of ['local', 'test']) {
      expect(allowsInsecureCookies({ APP_ENV, NODE_ENV: 'production' })).toBe(false);
      expect(sessionCookie({ APP_ENV, NODE_ENV: 'production' }).name).toBe('__Host-karen_staff');
    }
  });

  it('stays secure in deployed environments under next dev', () => {
    for (const APP_ENV of ['dev', 'staging', 'production']) {
      expect(sessionCookie({ APP_ENV, NODE_ENV: 'development' }).options.secure).toBe(true);
    }
  });

  it('drops Secure and the __Host- prefix only for local/test dev servers (plain http)', () => {
    const spec = sessionCookie({ APP_ENV: 'local', NODE_ENV: 'development' });
    expect(spec.name).toBe('karen_staff');
    expect(spec.options.secure).toBe(false);
    expect(spec.options.httpOnly).toBe(true);
    expect(spec.options.sameSite).toBe('strict');
  });

  it('CSRF cookie is readable by JS (double-submit) but otherwise locked down', () => {
    const secure = csrfCookie({ APP_ENV: 'production', NODE_ENV: 'production' });
    expect(secure.name).toBe('__Host-karen_staff_csrf');
    expect(secure.options).toMatchObject({
      httpOnly: false,
      secure: true,
      sameSite: 'strict',
      path: '/',
    });
    expect(csrfCookie({ APP_ENV: 'test', NODE_ENV: 'test' }).name).toBe('karen_staff_csrf');
  });

  it('clearing keeps the attributes a __Host- cookie needs to be overwritten', () => {
    const cleared = expired(sessionCookie({ APP_ENV: 'production', NODE_ENV: 'production' }));
    expect(cleared.options).toMatchObject({ maxAge: 0, secure: true, path: '/', httpOnly: true });
  });
});
