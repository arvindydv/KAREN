import { describe, expect, it } from 'vitest';
import { clientIpFromForwardedFor, signClientIp, verifyClientIp } from './client-ip.js';

const SECRET = 'test-only-internal-hmac-secret-0123456789';
const now = 1_800_000_000;

describe('signed client IP forwarding', () => {
  it('verifies a fresh signature and returns the IP', () => {
    const signature = signClientIp(SECRET, '203.0.113.7', now);
    expect(
      verifyClientIp({ secret: SECRET, ip: '203.0.113.7', signature, nowUnixSeconds: now + 5 }),
    ).toBe('203.0.113.7');
    expect(
      verifyClientIp({
        secret: SECRET,
        ip: '2001:db8::1',
        signature: signClientIp(SECRET, '2001:db8::1', now),
        nowUnixSeconds: now,
      }),
    ).toBe('2001:db8::1');
  });
  it('rejects a different IP, wrong secret, stale timestamp, garbage and missing values', () => {
    const signature = signClientIp(SECRET, '203.0.113.7', now);
    expect(
      verifyClientIp({ secret: SECRET, ip: '203.0.113.8', signature, nowUnixSeconds: now }),
    ).toBeNull();
    expect(
      verifyClientIp({ secret: 'x'.repeat(40), ip: '203.0.113.7', signature, nowUnixSeconds: now }),
    ).toBeNull();
    expect(
      verifyClientIp({ secret: SECRET, ip: '203.0.113.7', signature, nowUnixSeconds: now + 3600 }),
    ).toBeNull();
    expect(
      verifyClientIp({
        secret: SECRET,
        ip: 'not-an-ip',
        signature: signClientIp(SECRET, 'not-an-ip', now),
        nowUnixSeconds: now,
      }),
    ).toBeNull();
    expect(
      verifyClientIp({
        secret: SECRET,
        ip: '203.0.113.7',
        signature: undefined,
        nowUnixSeconds: now,
      }),
    ).toBeNull();
    expect(
      verifyClientIp({ secret: SECRET, ip: undefined, signature, nowUnixSeconds: now }),
    ).toBeNull();
  });
  it('picks the client from X-Forwarded-For by trusted hop count', () => {
    expect(clientIpFromForwardedFor('198.51.100.1, 10.0.0.5', 1)).toBe('10.0.0.5');
    expect(clientIpFromForwardedFor('198.51.100.1, 10.0.0.5', 2)).toBe('198.51.100.1');
    // A client-supplied spoofed prefix is ignored: only trusted hops count from the right.
    expect(clientIpFromForwardedFor('6.6.6.6, 198.51.100.1, 10.0.0.5', 2)).toBe('198.51.100.1');
    expect(clientIpFromForwardedFor('10.0.0.5', 2)).toBeUndefined();
    expect(clientIpFromForwardedFor('garbage', 1)).toBeUndefined();
    expect(clientIpFromForwardedFor(null, 1)).toBeUndefined();
    expect(clientIpFromForwardedFor('1.2.3.4', 0)).toBeUndefined();
  });
});
