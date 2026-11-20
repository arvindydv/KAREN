// Migration safety gate (runs in `pnpm verify` and CI).
//
// Prisma applies a migration's SQL WITHOUT an implicit transaction: when a statement fails
// halfway, earlier statements stay applied and `prisma migrate resolve --rolled-back` then
// leaves a half-migrated schema (reproduced in the Phase 00 migration-failure drill). Every
// migration must therefore be explicitly atomic — `BEGIN;` … `COMMIT;` — unless it carries
// `-- karen:no-transaction <reason>` (e.g. CREATE INDEX CONCURRENTLY, which cannot run in a
// transaction; such migrations must contain exactly one statement).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'apps/api/prisma/migrations';
// Applied before this rule existed; never edit an applied migration.
const BASELINE = new Set(['20261119173616_foundation']);

const strip = (sql) =>
  sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .trim();

const problems = [];
for (const name of readdirSync(DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort()) {
  if (BASELINE.has(name)) continue;
  const raw = readFileSync(join(DIR, name, 'migration.sql'), 'utf8');
  const optOut = /^--\s*karen:no-transaction\s+\S+/m.test(raw);
  const body = strip(raw);
  if (optOut) {
    if (/\b(BEGIN|COMMIT)\b/i.test(body))
      problems.push(`${name}: opted out but contains BEGIN/COMMIT`);
    if (body.replace(/;\s*$/, '').includes(';')) {
      problems.push(`${name}: no-transaction migrations must contain exactly one statement`);
    }
    continue;
  }
  if (!/^BEGIN;/i.test(body) || !/COMMIT;$/i.test(body)) {
    problems.push(
      `${name}: must start with "BEGIN;" and end with "COMMIT;" (or opt out with a reason)`,
    );
  }
  if (/\bCONCURRENTLY\b/i.test(body)) {
    problems.push(
      `${name}: CONCURRENTLY cannot run inside a transaction; use a separate opted-out migration`,
    );
  }
}
if (problems.length > 0) {
  process.stderr.write(`Migration gate FAILED:\n  ${problems.join('\n  ')}\n`);
  process.exit(1);
}
process.stdout.write('Migration gate passed.\n');
