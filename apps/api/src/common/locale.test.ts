import { describe, expect, it } from 'vitest';
import { isValidCurrency, isValidTimeZone } from './locale.js';

describe('locale validation', () => {
  it('accepts IANA zones including aliases ICU does not list as canonical', () => {
    for (const tz of [
      'Asia/Kolkata',
      'Asia/Calcutta',
      'UTC',
      'America/New_York',
      'Europe/London',
    ]) {
      expect(isValidTimeZone(tz)).toBe(true);
    }
  });
  it('rejects unknown or absurd zones', () => {
    for (const tz of ['Mars/Olympus', '', 'x'.repeat(100), '../../etc/passwd']) {
      expect(isValidTimeZone(tz)).toBe(false);
    }
  });
  it('validates ISO 4217 currency codes', () => {
    expect(isValidCurrency('INR')).toBe(true);
    expect(isValidCurrency('ZZZ')).toBe(false);
    expect(isValidCurrency('inr')).toBe(false);
  });
});
