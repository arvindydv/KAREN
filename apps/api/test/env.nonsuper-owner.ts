/**
 * Connection constants for the non-superuser-owner integration project (NEW-1 harness,
 * `global-setup.nonsuper-owner.ts`). Local/CI only; the password is a local-only constant.
 */
export const NONSUPER_OWNER_ROLE = 'karen_owner_nonsuper';
export const NONSUPER_OWNER_PASSWORD = 'nonsuper_karen_local_only';
// Overridable so parallel worktrees never drop each other's harness database.
export const NONSUPER_OWNER_DATABASE = process.env.TEST_NONSUPER_DATABASE ?? 'karen_test_nonsuper';

const HOST = process.env.TEST_DATABASE_HOST ?? 'localhost:5442';

/** Superuser connection to the maintenance database (creates the role and database). */
export const TEST_SUPERUSER_ADMIN_URL =
  process.env.TEST_SUPERUSER_ADMIN_URL ?? `postgresql://karen:karen_local_only@${HOST}/postgres`;

/** The non-superuser migration role: owns every object in the harness database. */
export const NONSUPER_OWNER_MIGRATION_URL = `postgresql://${NONSUPER_OWNER_ROLE}:${NONSUPER_OWNER_PASSWORD}@${HOST}/${NONSUPER_OWNER_DATABASE}`;

/** Superuser connection to the harness database, used only by fixtures and the operator step. */
export const nonsuperFixtureUrl = (): string => {
  const u = new URL(TEST_SUPERUSER_ADMIN_URL);
  u.pathname = `/${NONSUPER_OWNER_DATABASE}`;
  return u.toString();
};

/** The API's least-privilege runtime login (created by scripts/db-roles.mjs). */
export const nonsuperRuntimeUrl = (): string =>
  `postgresql://karen_api_local:karen_api_local_only@${HOST}/${NONSUPER_OWNER_DATABASE}`;
