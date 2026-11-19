import { ROLE_PERMISSIONS } from '@karen/api-contracts';
import { describe, expect, it } from 'vitest';
import { visibleNav } from './navigation';

describe('admin navigation', () => {
  it('shows nothing to end users', () => {
    expect(visibleNav(ROLE_PERMISSIONS.user)).toEqual([]);
  });

  it('shows only permitted sections per staff role', () => {
    expect(visibleNav(ROLE_PERMISSIONS.support_agent).map((i) => i.href)).toEqual([
      '/system',
      '/cases',
    ]);
    expect(visibleNav(ROLE_PERMISSIONS.security_admin).map((i) => i.href)).toEqual([
      '/system',
      '/audit',
    ]);
  });
});
