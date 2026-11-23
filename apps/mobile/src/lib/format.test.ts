import { describe, expect, it } from '@jest/globals';
import { formatDate, formatDateTime, plural } from './format';

describe('format', () => {
  it('drops seconds from date-times', () => {
    const s = formatDateTime('2026-11-21T12:15:42.000Z');
    expect(s).not.toMatch(/:42/);
    expect(s).toMatch(/2026/);
  });
  it('passes through unparseable input', () => {
    expect(formatDate('not-a-date')).toBe('not-a-date');
  });
  it('pluralises', () => {
    expect(plural(1, 'active session')).toBe('1 active session');
    expect(plural(3, 'active session')).toBe('3 active sessions');
  });
});
