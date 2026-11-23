import { beforeEach, describe, expect, it } from '@jest/globals';
import { HOLD_MS, clearCredential, holdCredential, takeCredential } from './pending-credential';

describe('pending credential (memory-only sign-up → verify hand-off)', () => {
  beforeEach(() => clearCredential());

  it('returns the password once, for the same e-mail (case/space-insensitive)', () => {
    holdCredential(' Asha@Example.com ', 'pw-1', 1_000);
    expect(takeCredential('asha@example.com', 2_000)).toBe('pw-1');
    expect(takeCredential('asha@example.com', 2_000)).toBeNull();
  });

  it('refuses a different e-mail and wipes what was held', () => {
    holdCredential('asha@example.com', 'pw-1', 1_000);
    expect(takeCredential('ravi@example.com', 2_000)).toBeNull();
    expect(takeCredential('asha@example.com', 2_000)).toBeNull();
  });

  it('expires', () => {
    holdCredential('asha@example.com', 'pw-1', 1_000);
    expect(takeCredential('asha@example.com', 1_000 + HOLD_MS + 1)).toBeNull();
  });
});
