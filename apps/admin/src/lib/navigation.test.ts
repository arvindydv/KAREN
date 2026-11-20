// @vitest-environment node
import { STAFF_ROLE_PERMISSIONS, ROLE_PERMISSIONS } from '@karen/api-contracts';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { visibleNav } from './navigation';

const hrefs = (permissions: readonly string[]) => visibleNav(permissions).map((i) => i.href);

describe('admin navigation (display only)', () => {
  it('shows only universal sections without staff permissions', () => {
    expect(hrefs([])).toEqual(['/account', '/elevations']);
    // Consumer permissions confer nothing in the staff realm.
    expect(hrefs(ROLE_PERMISSIONS.user)).toEqual(['/account', '/elevations']);
  });

  it('shows only permitted sections per staff role', () => {
    expect(hrefs(STAFF_ROLE_PERMISSIONS.support_agent)).toEqual([
      '/account',
      '/system',
      '/elevations',
      '/users',
    ]);
    expect(hrefs(STAFF_ROLE_PERMISSIONS.ops_admin)).toEqual(['/account', '/system', '/elevations']);
    expect(hrefs(STAFF_ROLE_PERMISSIONS.security_admin)).toEqual([
      '/account',
      '/system',
      '/elevations',
      '/invitations',
      '/staff',
    ]);
  });

  it('is never used as an authorization gate by pages or route handlers', () => {
    const appDir = fileURLToPath(new URL('../app', import.meta.url));
    const importers: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx?$/.test(name) && readFileSync(path, 'utf8').includes('@/lib/navigation')) {
          importers.push(path.slice(appDir.length));
        }
      }
    };
    walk(appDir);
    // Only the console shell renders the menu; every page relies on the API's own checks.
    expect(importers).toEqual(['/(console)/layout.tsx']);
  });
});
