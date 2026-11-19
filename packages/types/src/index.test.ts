import { describe, expect, it } from 'vitest';
import { APP_ENVIRONMENTS, err, isDevelopmentEnvironment, ok } from './index.js';

describe('@karen/types runtime helpers', () => {
  it('only local and test are development environments', () => {
    expect(APP_ENVIRONMENTS.filter(isDevelopmentEnvironment)).toEqual(['local', 'test']);
  });

  it('Result constructors are discriminated', () => {
    const a = ok(1);
    const b = err('x');
    expect(a.ok && a.value).toBe(1);
    expect(!b.ok && b.error).toBe('x');
  });
});
