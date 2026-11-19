import { providerDescriptorSchema } from '@karen/domain';
import { verifyTimestamped } from '@karen/domain/node';
import { describe, expect, it } from 'vitest';
import {
  internalSignatureVectors,
  mockProviderWebhooks,
  sandboxTransactionalProvider,
  syntheticUsers,
} from './index.js';

describe('fixtures are self-consistent', () => {
  it('sandbox provider descriptor is valid', () => {
    expect(providerDescriptorSchema.safeParse(sandboxTransactionalProvider).success).toBe(true);
  });

  it('webhook fixtures verify exactly as labelled', () => {
    const { secret, tolerance_seconds, fixtures } = mockProviderWebhooks();
    for (const f of fixtures) {
      const r = verifyTimestamped({
        secret,
        payload: f.body,
        header: f.header,
        nowUnixSeconds: f.timestamp + 5,
        toleranceSeconds: tolerance_seconds,
      });
      const outcome = r.ok
        ? 'ACCEPT'
        : r.reason === 'MALFORMED'
          ? 'REJECT_MALFORMED'
          : 'REJECT_SIGNATURE_MISMATCH';
      expect(outcome, f.name).toBe(f.expected);
    }
  });

  it('signature vectors are present and synthetic users use example.com', () => {
    expect(internalSignatureVectors().vectors.length).toBeGreaterThan(0);
    expect(syntheticUsers().every((u) => u.email.endsWith('@example.com'))).toBe(true);
  });
});
