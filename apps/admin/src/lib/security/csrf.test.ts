import { describe, expect, it } from 'vitest';
import {
  checkBffRequest,
  constantTimeEqual,
  generateCsrfToken,
  isWellFormedCsrfToken,
} from './csrf';

const ORIGIN = 'https://admin.karen.test';
const token = generateCsrfToken();

const input = (headers: Record<string, string>, cookie: string | undefined = token) => ({
  header: (name: string) => headers[name] ?? null,
  csrfCookie: cookie,
  allowedOrigin: ORIGIN,
});

describe('BFF request guard', () => {
  it('accepts a same-origin request with matching double-submit token', () => {
    expect(
      checkBffRequest(
        input({ origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'x-csrf-token': token }),
      ),
    ).toEqual({ ok: true });
  });

  it('rejects a missing, null or foreign Origin', () => {
    for (const origin of [
      undefined,
      'null',
      'https://evil.test',
      `${ORIGIN}.evil.test`,
      'http://admin.karen.test',
    ]) {
      const headers: Record<string, string> = { 'x-csrf-token': token };
      if (origin) headers.origin = origin;
      expect(checkBffRequest(input(headers))).toEqual({ ok: false, reason: 'origin' });
    }
  });

  it('fails closed when the app origin is unknown', () => {
    expect(
      checkBffRequest({ ...input({ origin: ORIGIN, 'x-csrf-token': token }), allowedOrigin: null }),
    ).toEqual({ ok: false, reason: 'origin' });
  });

  it('rejects cross-site Sec-Fetch-Site even with a matching Origin', () => {
    expect(
      checkBffRequest(
        input({ origin: ORIGIN, 'sec-fetch-site': 'same-site', 'x-csrf-token': token }),
      ),
    ).toEqual({ ok: false, reason: 'fetch_site' });
  });

  it('rejects missing or mismatched CSRF tokens', () => {
    expect(checkBffRequest(input({ origin: ORIGIN }))).toEqual({ ok: false, reason: 'csrf' });
    expect(checkBffRequest(input({ origin: ORIGIN, 'x-csrf-token': token }, ''))).toEqual({
      ok: false,
      reason: 'csrf',
    });
    expect(checkBffRequest(input({ origin: ORIGIN, 'x-csrf-token': generateCsrfToken() }))).toEqual(
      { ok: false, reason: 'csrf' },
    );
    // Malformed values never match, even if equal.
    expect(checkBffRequest(input({ origin: ORIGIN, 'x-csrf-token': 'x' }, 'x'))).toEqual({
      ok: false,
      reason: 'csrf',
    });
  });

  it('generates 256-bit base64url tokens that are unique', () => {
    const a = generateCsrfToken();
    expect(isWellFormedCsrfToken(a)).toBe(true);
    expect(a).not.toBe(generateCsrfToken());
  });

  it('constant-time compare is correct for equal, different and different-length inputs', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
    expect(constantTimeEqual('abcd', 'abc')).toBe(false);
    expect(constantTimeEqual('', '')).toBe(true);
  });
});
