import { describe, expect, it } from 'vitest';
import {
  issueOpaqueToken,
  opaqueTokenVerifier,
  parseOpaqueToken,
  verifiersEqual,
} from './opaque-token.js';

describe('opaque tokens', () => {
  it('issues unique 256-bit tokens and stores only a verifier', () => {
    const tokens = Array.from({ length: 1000 }, () => issueOpaqueToken('refresh'));
    expect(new Set(tokens.map((t) => t.token)).size).toBe(1000);
    const { token, verifier } = tokens[0]!;
    expect(token).toMatch(/^krt_[A-Za-z0-9_-]{43}$/);
    expect(verifier).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(verifier).not.toContain(token.slice(4));
  });

  it('parses only well-formed tokens of the expected kind (token-type separation)', () => {
    const { token, verifier } = issueOpaqueToken('session');
    expect(parseOpaqueToken('session', token)).toBe(verifier);
    expect(parseOpaqueToken('refresh', token)).toBeNull();
    expect(parseOpaqueToken('session', undefined)).toBeNull();
    expect(parseOpaqueToken('session', `${token}x`)).toBeNull();
    expect(parseOpaqueToken('session', token.replace(/.$/, '='))).toBeNull();
    expect(parseOpaqueToken('session', 'kss_' + 'a'.repeat(4000))).toBeNull();
  });

  it('compares verifiers in constant time and handles length mismatch', () => {
    const v = opaqueTokenVerifier('x');
    expect(verifiersEqual(v, opaqueTokenVerifier('x'))).toBe(true);
    expect(verifiersEqual(v, opaqueTokenVerifier('y'))).toBe(false);
    expect(verifiersEqual(v, 'short')).toBe(false);
  });
});
