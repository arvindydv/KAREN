import { describe, expect, it } from 'vitest';
import { signTimestamped, verifyTimestamped } from './index.js';

const secret = 'test-only-webhook-secret';
const payload = '{"event":"status","ref":"x"}';

describe('timestamped HMAC signatures', () => {
  it('round-trips', () => {
    const header = signTimestamped(secret, payload, 1_700_000_000);
    expect(
      verifyTimestamped({
        secret,
        payload,
        header,
        nowUnixSeconds: 1_700_000_010,
        toleranceSeconds: 300,
      }),
    ).toEqual({ ok: true, timestamp: 1_700_000_000 });
  });

  it('rejects tampered payloads, wrong secrets, stale timestamps and malformed headers', () => {
    const header = signTimestamped(secret, payload, 1_700_000_000);
    const v = (o: Partial<Parameters<typeof verifyTimestamped>[0]>) =>
      verifyTimestamped({
        secret,
        payload,
        header,
        nowUnixSeconds: 1_700_000_000,
        toleranceSeconds: 300,
        ...o,
      });
    expect(v({ payload: payload.replace('x', 'y') })).toEqual({
      ok: false,
      reason: 'SIGNATURE_MISMATCH',
    });
    expect(v({ secret: 'other' })).toEqual({ ok: false, reason: 'SIGNATURE_MISMATCH' });
    expect(v({ nowUnixSeconds: 1_700_000_301 })).toEqual({
      ok: false,
      reason: 'TIMESTAMP_OUT_OF_TOLERANCE',
    });
    expect(v({ header: 'garbage' })).toEqual({ ok: false, reason: 'MALFORMED' });
    expect(v({ header: undefined })).toEqual({ ok: false, reason: 'MALFORMED' });
  });
});
