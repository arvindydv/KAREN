import { describe, expect, it } from 'vitest';
import { etag, requireIfMatch } from './precondition.js';

describe('requireIfMatch', () => {
  it('parses strong and weak version tags', () => {
    expect(requireIfMatch('"3"')).toBe(3);
    expect(requireIfMatch('W/"12"')).toBe(12);
    expect(requireIfMatch(etag(7))).toBe(7);
  });
  it('428 when missing, 412 when malformed or wildcard', () => {
    expect(() => requireIfMatch(undefined)).toThrow(
      expect.objectContaining({ code: 'PRECONDITION_REQUIRED' }),
    );
    expect(() => requireIfMatch('')).toThrow(
      expect.objectContaining({ code: 'PRECONDITION_REQUIRED' }),
    );
    for (const bad of ['*', '3', '"x"', '"1", "2"', '"9999999999"']) {
      expect(() => requireIfMatch(bad)).toThrow(
        expect.objectContaining({ code: 'PRECONDITION_FAILED' }),
      );
    }
  });
});
