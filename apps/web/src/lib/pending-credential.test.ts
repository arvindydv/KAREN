import { beforeEach, describe, expect, it } from 'vitest';
import { HOLD_MS, holdSignIn, takeSignIn } from './pending-credential';

describe('pending sign-in (memory-only verify hand-off)', () => {
  beforeEach(() => void takeSignIn());

  it('is single use', () => {
    holdSignIn({ email: 'a@example.com', password: 'pw', next: '/app/onboarding' }, 0);
    expect(takeSignIn(1)).toEqual({
      email: 'a@example.com',
      password: 'pw',
      next: '/app/onboarding',
    });
    expect(takeSignIn(2)).toBeNull();
  });

  it('expires', () => {
    holdSignIn({ email: 'a@example.com', password: 'pw', next: '/app' }, 0);
    expect(takeSignIn(HOLD_MS + 1)).toBeNull();
  });
});
