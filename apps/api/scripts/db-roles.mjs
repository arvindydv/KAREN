// Applies infra/database/roles.sql (least-privilege grants) and creates the LOCAL-ONLY API
// login role. Deployed environments run roles.sql with psql as an operator and create their
// login role with a Secrets Manager password; this script refuses to run there.
//
//   pnpm db:roles                              # uses MIGRATION_DATABASE_URL (owner) from .env
//   node scripts/db-roles.mjs <owner-database-url>
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export const LOCAL_API_ROLE = 'karen_api_local';
export const LOCAL_API_PASSWORD = 'karen_api_local_only';
export const LOCAL_STAFF_ROLE = 'karen_staff_local';
export const LOCAL_STAFF_PASSWORD = 'karen_staff_local_only';

const ROLES_SQL = fileURLToPath(new URL('../../../infra/database/roles.sql', import.meta.url));

export async function applyDatabaseRoles(ownerUrl, appEnv) {
  if (appEnv !== 'local' && appEnv !== 'test') {
    throw new Error(
      `db-roles: refusing to run with APP_ENV=${appEnv ?? '(unset)'}; deployed environments ` +
        'apply infra/database/roles.sql via psql as an operator (docs/runbooks/database-migrations.md)',
    );
  }
  const client = new pg.Client({ connectionString: ownerUrl, application_name: 'karen-db-roles' });
  await client.connect();
  try {
    await client.query(readFileSync(ROLES_SQL, 'utf8'));
    // Role names/passwords are constants (no user input); DDL cannot take bind parameters.
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${LOCAL_API_ROLE}') THEN
          CREATE ROLE ${LOCAL_API_ROLE} LOGIN PASSWORD '${LOCAL_API_PASSWORD}';
        END IF;
      END
      $$;
      ALTER ROLE ${LOCAL_API_ROLE} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
      GRANT karen_api_runtime TO ${LOCAL_API_ROLE};
      GRANT CONNECT ON DATABASE "${client.database}" TO ${LOCAL_API_ROLE};
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${LOCAL_STAFF_ROLE}') THEN
          CREATE ROLE ${LOCAL_STAFF_ROLE} LOGIN PASSWORD '${LOCAL_STAFF_PASSWORD}';
        END IF;
      END
      $$;
      ALTER ROLE ${LOCAL_STAFF_ROLE} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
      GRANT karen_staff_runtime TO ${LOCAL_STAFF_ROLE};
      GRANT CONNECT ON DATABASE "${client.database}" TO ${LOCAL_STAFF_ROLE};
    `);
  } finally {
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const url = process.argv[2] ?? process.env.MIGRATION_DATABASE_URL;
  if (!url) {
    process.stderr.write('db-roles: set MIGRATION_DATABASE_URL (owner role) or pass a URL\n');
    process.exit(2);
  }
  await applyDatabaseRoles(url, process.env.APP_ENV);
  process.stdout.write(`db-roles: grants applied; login role ${LOCAL_API_ROLE} ready\n`);
}
