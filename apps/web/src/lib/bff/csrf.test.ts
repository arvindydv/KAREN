// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { getServerEnv } from '../env';
import { checkStateChangingRequest, timingSafeEqualString } from './csrf';

const prod = getServerEnv({
  APP_ENV: 'production',
  WEB_PUBLIC_ORIGIN: 'https://app.karen.test',
  INTERNAL_SERVICE_HMAC_SECRET: 'test-only-internal-hmac-secret-0123456789',
});
const local = getServerEnv({ APP_ENV: 'local' });

function req(headers: Record<string, string>, url = 'https://app.karen.test/api/v1/me/profile') {
  return new Request(url, { method: 'PATCH', headers });
}

const good = {
  origin: 'https://app.karen.test',
  'sec-fetch-site': 'same-origin',
  cookie: '__Host-karen_csrf=tok123',
  'x-csrf-token': 'tok123',
};

describe('state-changing request checks', () => {
  it('passes a same-origin request with a matching token', () => {
    expect(checkStateChangingRequest(req(good), prod)).toBeNull();
  });

  it('rejects a missing Origin', () => {
    const { origin: _o, ...rest } = good;
    expect(checkStateChangingRequest(req(rest), prod)).toBe('ORIGIN_MISSING');
  });

  it('rejects a mismatched Origin', () => {
    expect(checkStateChangingRequest(req({ ...good, origin: 'https://evil.example' }), prod)).toBe(
      'ORIGIN_MISMATCH',
    );
    expect(
      checkStateChangingRequest(
        req({ ...good, origin: 'https://app.karen.test.evil.example' }),
        prod,
      ),
    ).toBe('ORIGIN_MISMATCH');
  });

  it('rejects cross-site / same-site Sec-Fetch-Site', () => {
    expect(checkStateChangingRequest(req({ ...good, 'sec-fetch-site': 'cross-site' }), prod)).toBe(
      'CROSS_SITE',
    );
    expect(checkStateChangingRequest(req({ ...good, 'sec-fetch-site': 'same-site' }), prod)).toBe(
      'CROSS_SITE',
    );
  });

  it('rejects a missing or mismatched CSRF token', () => {
    const { 'x-csrf-token': _t, ...noHeader } = good;
    expect(checkStateChangingRequest(req(noHeader), prod)).toBe('TOKEN_MISSING');
    expect(checkStateChangingRequest(req({ ...good, cookie: '' }), prod)).toBe('TOKEN_MISSING');
    expect(checkStateChangingRequest(req({ ...good, 'x-csrf-token': 'tok124' }), prod)).toBe(
      'TOKEN_MISMATCH',
    );
  });

  it('does not accept a planted non-__Host- CSRF cookie in production', () => {
    expect(checkStateChangingRequest(req({ ...good, cookie: 'karen_csrf=tok123' }), prod)).toBe(
      'TOKEN_MISSING',
    );
  });

  it('fails closed outside local when the public origin is not configured', () => {
    expect(
      checkStateChangingRequest(
        req(good),
        getServerEnv({
          APP_ENV: 'staging',
          INTERNAL_SERVICE_HMAC_SECRET: 'test-only-internal-hmac-secret-0123456789',
        }),
      ),
    ).toBe('APP_ORIGIN_UNCONFIGURED');
  });

  it('locally uses the request origin', () => {
    const r = req(
      { origin: 'http://localhost:3000', cookie: 'karen_csrf=t', 'x-csrf-token': 't' },
      'http://localhost:3000/api/auth/login',
    );
    expect(checkStateChangingRequest(r, local)).toBeNull();
  });
});

describe('timingSafeEqualString', () => {
  it('compares exactly', () => {
    expect(timingSafeEqualString('abc', 'abc')).toBe(true);
    expect(timingSafeEqualString('abc', 'abd')).toBe(false);
    expect(timingSafeEqualString('abc', 'abcd')).toBe(false);
    expect(timingSafeEqualString('', '')).toBe(true);
  });
});
