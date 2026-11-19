import { execFileSync } from 'node:child_process';
import { TEST_DATABASE_URL } from './env.js';

/** Applies all migrations to the dedicated test database (reproducibility check included). */
export default function setup(): void {
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'pipe',
  });
}
