import { execFileSync } from 'node:child_process';
import pg from 'pg';
import {
  NONSUPER_OWNER_DATABASE,
  NONSUPER_OWNER_MIGRATION_URL,
  NONSUPER_OWNER_PASSWORD,
  NONSUPER_OWNER_ROLE,
  TEST_SUPERUSER_ADMIN_URL,
  nonsuperFixtureUrl,
} from './env.nonsuper-owner.js';

/**
 * NEW-1 verification harness (PHASE_03_SECURITY_RELIABILITY_CHECKLIST.md Part B, B5.1/B5.4).
 *
 * The normal integration database is migrated by the local `karen` role, which is a SUPERUSER:
 * superusers bypass row-level security even on FORCEd tables, so every SECURITY DEFINER function
 * silently "works" there. AWS/RDS migrates with a dedicated NON-superuser role, under which
 * FORCE RLS applies to the definer's owner. This setup reproduces that ownership model locally:
 *
 *   1. a disposable database owned by a NOSUPERUSER NOBYPASSRLS NOCREATEROLE login role;
 *   2. extensions created by the superuser first (on RDS: the rds_superuser master user);
 *   3. `prisma migrate deploy` run AS the non-superuser role, so it owns every object and every
 *      SECURITY DEFINER function runs with its (RLS-subject) privileges;
 *   4. `infra/database/roles.sql` applied by the operator (superuser here; it contains
 *      CREATE/ALTER ROLE, which the migration role must not be able to do).
 *
 * The suite then runs with the API on the least-privilege runtime role; test fixtures use a
 * superuser connection to the same database (they seed/inspect rows directly, as in the normal
 * suite). Only object ownership differs from the normal run — which is exactly what NEW-1 is about.
 * Local and CI only: the role password is a local constant and APP_ENV must be local/test.
 */
export default async function setup(): Promise<void> {
  const appEnv = process.env.APP_ENV ?? 'test';
  if (appEnv !== 'local' && appEnv !== 'test') {
    throw new Error(`non-superuser-owner harness refuses APP_ENV=${appEnv}`);
  }
  const admin = new pg.Client({ connectionString: TEST_SUPERUSER_ADMIN_URL });
  await admin.connect();
  try {
    // Constants only (no user input); DDL cannot take bind parameters.
    await admin.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${NONSUPER_OWNER_ROLE}') THEN
          CREATE ROLE ${NONSUPER_OWNER_ROLE} LOGIN PASSWORD '${NONSUPER_OWNER_PASSWORD}';
        END IF;
      END $$;
      ALTER ROLE ${NONSUPER_OWNER_ROLE} LOGIN PASSWORD '${NONSUPER_OWNER_PASSWORD}'
        NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;`);
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${NONSUPER_OWNER_DATABASE}' AND pid <> pg_backend_pid()`,
    );
    await admin.query(`DROP DATABASE IF EXISTS ${NONSUPER_OWNER_DATABASE}`);
    await admin.query(`CREATE DATABASE ${NONSUPER_OWNER_DATABASE} OWNER ${NONSUPER_OWNER_ROLE}`);
  } finally {
    await admin.end();
  }
  const fixtureUrl = nonsuperFixtureUrl();
  const ext = new pg.Client({ connectionString: fixtureUrl });
  await ext.connect();
  try {
    await ext.query('CREATE EXTENSION IF NOT EXISTS vector');
  } finally {
    await ext.end();
  }
  const env = {
    ...process.env,
    APP_ENV: 'test',
    MIGRATION_DATABASE_URL: NONSUPER_OWNER_MIGRATION_URL,
  };
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], { env, stdio: 'pipe' });
  execFileSync('node', ['scripts/db-roles.mjs', fixtureUrl], { env, stdio: 'pipe' });
}
