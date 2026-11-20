import { execFileSync } from 'node:child_process';
import { TEST_OWNER_DATABASE_URL } from './env.js';

/**
 * Applies all migrations to the dedicated test database (reproducibility check included) as
 * the owner role, then the least-privilege grants + local runtime login role. The API under
 * test connects as that runtime role, so row-level security is exercised for real.
 */
export default function setup(): void {
  const env = { ...process.env, APP_ENV: 'test', MIGRATION_DATABASE_URL: TEST_OWNER_DATABASE_URL };
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], { env, stdio: 'pipe' });
  execFileSync('node', ['scripts/db-roles.mjs', TEST_OWNER_DATABASE_URL], { env, stdio: 'pipe' });
}
