import { describe, expect, it } from 'vitest';
import { safeNextPath, safeRelativePath } from './safe-redirect';

describe('open-redirect validator', () => {
  it.each(['/app', '/app/settings/profile', '/app?tab=x#y', '/', '/%0a'])(
    'accepts same-origin path %s',
    (p) => {
      expect(safeRelativePath(p)).toBe(p);
    },
  );

  it.each([
    '//evil.example',
    '//evil.example/app',
    '/\\evil.example',
    '\\\\evil.example',
    '/app\\..\\..\\evil',
    'https://evil.example',
    'http:/evil.example',
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,hi',
    'app',
    '',
    ' /app',
    '/\t/evil.example',
    '/\n/evil.example',
    '\u0000/app',
  ])('rejects %j', (p) => {
    expect(safeRelativePath(p)).toBeNull();
  });

  it('rejects non-strings and over-long values', () => {
    expect(safeRelativePath(undefined)).toBeNull();
    expect(safeRelativePath(['/app'])).toBeNull();
    expect(safeRelativePath(`/${'a'.repeat(600)}`)).toBeNull();
  });

  it('falls back when unsafe', () => {
    expect(safeNextPath('//evil.example')).toBe('/app');
    expect(safeNextPath('/app/onboarding')).toBe('/app/onboarding');
  });
});
