import { describe, expect, it } from 'vitest';
import {
  OutboundRequestBlockedError,
  assertOutboundUrlAllowed,
  isPublicAddress,
  nextRedirectUrl,
  publicOnlyLookup,
  safeFetch,
} from './outbound.js';

const policy = { allowedHosts: ['api.partner.example', '*.cdn.example'] };

const reason = (fn: () => unknown): string => {
  try {
    fn();
    return 'ALLOWED';
  } catch (e) {
    return e instanceof OutboundRequestBlockedError ? e.reason : `OTHER:${String(e)}`;
  }
};

describe('isPublicAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254', // cloud metadata
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    '::ffff:127.0.0.1', // IPv4-mapped loopback
    '::ffff:169.254.169.254',
    'fd00::1',
    'fe80::1',
    '2002:7f00:1::', // 6to4 wrapping 127.0.0.1
    'not-an-ip',
  ])('rejects %s', (ip) => expect(isPublicAddress(ip)).toBe(false));

  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])('accepts %s', (ip) =>
    expect(isPublicAddress(ip)).toBe(true),
  );
});

describe('assertOutboundUrlAllowed', () => {
  it('allows only https URLs on the allowlist', () => {
    expect(reason(() => assertOutboundUrlAllowed('https://api.partner.example/x', policy))).toBe(
      'ALLOWED',
    );
    expect(reason(() => assertOutboundUrlAllowed('https://img.cdn.example/a.png', policy))).toBe(
      'ALLOWED',
    );
  });

  it.each([
    ['http://api.partner.example/', 'SCHEME_NOT_ALLOWED'],
    ['file:///etc/passwd', 'SCHEME_NOT_ALLOWED'],
    ['gopher://api.partner.example/', 'SCHEME_NOT_ALLOWED'],
    ['https://user:pw@api.partner.example/', 'CREDENTIALS_IN_URL'],
    ['https://api.partner.example:8443/', 'PORT_NOT_ALLOWED'],
    ['https://evil.example/', 'HOST_NOT_ALLOWED'],
    ['https://api.partner.example.evil.example/', 'HOST_NOT_ALLOWED'],
    ['https://cdn.example/', 'HOST_NOT_ALLOWED'], // suffix pattern does not match the apex
    ['https://169.254.169.254/latest/meta-data/', 'ADDRESS_NOT_PUBLIC'],
    ['https://[::1]/', 'ADDRESS_NOT_PUBLIC'],
    ['https://[::ffff:7f00:1]/', 'ADDRESS_NOT_PUBLIC'],
    ['https://2130706433/', 'ADDRESS_NOT_PUBLIC'], // decimal-encoded 127.0.0.1
    ['not a url', 'INVALID_URL'],
  ])('blocks %s (%s)', (url, expected) =>
    expect(reason(() => assertOutboundUrlAllowed(url, policy))).toBe(expected),
  );

  it('an empty allowlist allows nothing', () => {
    expect(
      reason(() => assertOutboundUrlAllowed('https://api.partner.example/', { allowedHosts: [] })),
    ).toBe('HOST_NOT_ALLOWED');
  });
});

describe('redirects', () => {
  it('re-validates every hop (open redirect to metadata or another host is blocked)', () => {
    const from = new URL('https://api.partner.example/start');
    expect(reason(() => nextRedirectUrl(from, '/next', policy))).toBe('ALLOWED');
    expect(reason(() => nextRedirectUrl(from, 'https://169.254.169.254/', policy))).toBe(
      'ADDRESS_NOT_PUBLIC',
    );
    expect(reason(() => nextRedirectUrl(from, 'http://api.partner.example/', policy))).toBe(
      'SCHEME_NOT_ALLOWED',
    );
    expect(reason(() => nextRedirectUrl(from, 'https://evil.example/', policy))).toBe(
      'HOST_NOT_ALLOWED',
    );
  });
});

describe('connect-time address enforcement (anti DNS-rebinding)', () => {
  it('refuses to connect when an allowlisted name resolves to a private address', async () => {
    // "localhost" stands in for a rebinding attacker's domain: allowlisted, resolves locally.
    await expect(
      safeFetch('https://localhost/', { allowedHosts: ['localhost'] }),
    ).rejects.toMatchObject({ reason: 'ADDRESS_NOT_PUBLIC' });
  });

  it('the lookup hook rejects private answers for both single and `all` lookups', async () => {
    const run = (all: boolean) =>
      new Promise<unknown>((resolve) => {
        publicOnlyLookup('localhost', { all }, (err) => resolve(err));
      });
    expect(await run(false)).toBeInstanceOf(OutboundRequestBlockedError);
    expect(await run(true)).toBeInstanceOf(OutboundRequestBlockedError);
  });
});
