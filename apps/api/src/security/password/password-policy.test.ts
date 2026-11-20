import { describe, expect, it } from 'vitest';
import { evaluatePassword, normalizePassword } from './password-policy.js';

const reasons = (pw: string, email?: string) => {
  const r = evaluatePassword(pw, email ? { email } : {});
  return r.ok ? [] : r.reasons;
};

describe('evaluatePassword (NIST SP 800-63B-4)', () => {
  it('accepts long passphrases without composition rules', () => {
    expect(reasons('mango monsoon bicycle lantern')).toEqual([]);
    expect(reasons('all lowercase no digits at all')).toEqual([]);
    expect(reasons('मेरा पासवर्ड बहुत लंबा है')).toEqual([]); // Hindi passphrase
  });

  it('enforces 15 minimum and supports at least 64 code points', () => {
    expect(reasons('short but okay')).toEqual(['TOO_SHORT']); // 14
    expect(reasons('tangerine river')).toEqual([]); // 15
    const sixtyFour = 'velvet harbour quietly folds paper cranes beneath amber lamps now';
    expect([...sixtyFour].length).toBeGreaterThanOrEqual(64);
    expect(reasons(sixtyFour)).toEqual([]);
    expect(reasons('x'.repeat(10) + 'ab'.repeat(200))).toEqual(['TOO_LONG']);
    // Megabyte input is refused before normalization.
    expect(reasons('a'.repeat(5_000_000))).toEqual(['TOO_LONG']);
  });

  it('counts code points, not UTF-16 units (emoji are one character each)', () => {
    expect(reasons('🙂🙃😀😁😂🤣😃😄😅😆😉😊😋😎')).toEqual(['TOO_SHORT']); // 14 emoji
  });

  it('normalizes with NFKC so equivalent input verifies identically', () => {
    // Full-width letters and a precomposed vs decomposed accent normalize to the same string.
    expect(normalizePassword('ＡＢＣ')).toBe('ABC');
    expect(normalizePassword('café')).toBe(normalizePassword('café'));
  });

  it('rejects control characters and lone surrogates', () => {
    expect(reasons('valid looking pass\u0000word')).toEqual(['INVALID_CHARACTERS']);
    expect(reasons('valid looking pass\tword')).toEqual(['INVALID_CHARACTERS']);
    expect(reasons('valid looking password \uD800')).toEqual(['INVALID_CHARACTERS']);
  });

  it('rejects commonly used passwords and base-word concatenations', () => {
    expect(reasons('Password@12345678')).toContain('COMMONLY_USED');
    expect(reasons('iloveyouiloveyou')).toContain('COMMONLY_USED');
    expect(reasons('correct horse battery staple')).toContain('COMMONLY_USED');
    expect(reasons('Welcome2India!!2026')).toContain('COMMONLY_USED');
    expect(reasons('1234567890123456')).not.toEqual([]);
  });

  it('rejects repetitive and sequential strings', () => {
    expect(reasons('aaaaaaaaaaaaaaaaaaa')).toContain('REPETITIVE_OR_SEQUENTIAL');
    expect(reasons('abcabcabcabcabcabc')).toContain('REPETITIVE_OR_SEQUENTIAL');
    expect(reasons('abcdefghijklmnop')).toContain('REPETITIVE_OR_SEQUENTIAL');
    expect(reasons('qwertyuiopasdfgh')).toContain('REPETITIVE_OR_SEQUENTIAL');
    expect(reasons('ponmlkjihgfedcba')).toContain('REPETITIVE_OR_SEQUENTIAL');
  });

  it('rejects context-specific words only when little else remains', () => {
    expect(reasons('asha.rao2026asha', 'asha.rao@example.com')).toContain('CONTEXT_SPECIFIC');
    expect(reasons('karenkaren123456')).not.toEqual([]);
    // A genuine passphrase that merely mentions the service is fine.
    expect(reasons('karen books my dentist on tuesdays', 'asha@example.com')).toEqual([]);
  });

  it('never echoes the password in its result', () => {
    expect(JSON.stringify(evaluatePassword('Password@12345678'))).not.toContain('12345678');
  });
});
