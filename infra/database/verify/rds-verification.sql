-- KAREN — RDS verification probe (Phase 03 + NEW-1). NON-PRODUCTION ONLY, synthetic data only.
-- Procedure, expected results and the evidence form: docs/phase-03/PHASE_03_RDS_VERIFICATION.md.
--
-- Run after `prisma migrate deploy` and `roles.sql`, against a NON-production database, with two
-- connection strings: the dedicated MIGRATION role (not the RDS master user) and an API RUNTIME
-- login (member of karen_api_runtime):
--   psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -v migration_url="$MIGRATION_DATABASE_URL" \
--        -v runtime_url="$RUNTIME_DATABASE_URL" -f infra/database/verify/rds-verification.sql
-- Every check prints one row `check | result | detail`. Nothing here creates an extension or
-- changes a role. Two synthetic rows (fixed ids below, prefix f0000000-) are created, erased by the
-- probe itself, and removed at the end.
\set QUIET on
\pset format unaligned
\pset fieldsep ' | '
\pset tuples_only on
\connect :migration_url

-- ── R-00 owner model (T-AWS-01 prerequisite) ─────────────────────────────────────────────
SELECT 'R-00 migration role is not superuser/bypassrls',
       CASE WHEN NOT rolsuper AND NOT rolbypassrls THEN 'PASS' ELSE 'FAIL' END,
       current_user || ' super=' || rolsuper || ' bypassrls=' || rolbypassrls
  FROM pg_roles WHERE rolname = current_user;
SELECT 'R-01 every app table owned by the migration role',
       CASE WHEN count(*) FILTER (WHERE r.rolname <> current_user) = 0 THEN 'PASS' ELSE 'FAIL' END,
       count(*) || ' tables'
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_roles r ON r.oid = c.relowner
 WHERE n.nspname IN ('identity','consent','audit','platform','conversation','memory','staff') AND c.relkind = 'r';
SELECT 'R-02 runtime role flags', CASE WHEN NOT rolsuper AND NOT rolbypassrls THEN 'PASS' ELSE 'FAIL' END,
       rolname FROM pg_roles WHERE rolname = 'karen_api_runtime';

-- ── R-10 FORCE RLS on memory + consent tables (SR-RLS-01/05) ──────────────────────────────
SELECT 'R-10 memory.* ENABLE+FORCE', CASE WHEN bool_and(relrowsecurity AND relforcerowsecurity) AND count(*) = 6 THEN 'PASS' ELSE 'FAIL' END,
       count(*) || ' tables'
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'memory' AND c.relkind = 'r';
SELECT 'R-11 memory content tables have only the owner policy',
       CASE WHEN count(*) FILTER (WHERE policyname NOT LIKE '%\_owner' AND policyname <> 'extraction_jobs_owner_lookup') = 0 THEN 'PASS' ELSE 'FAIL' END,
       string_agg(tablename || ':' || policyname, ',')
  FROM pg_policies WHERE schemaname = 'memory';

-- ── R-20 locale (Q2) and extensions (Q3) — read-only ───────────────────────────────────────
SELECT 'R-20 database collation/ctype', 'INFO', datcollate || ' / ' || datctype FROM pg_database WHERE datname = current_database();
SELECT 'R-21 Devanagari tokens under F1 parser (Q2)',
       CASE WHEN tsvector_to_array(to_tsvector('simple', 'मेरा घर पुणे में है')) @> ARRAY['मेरा','घर','पुणे','में','है']
             AND cardinality(tsvector_to_array(to_tsvector('simple', 'मेरा घर पुणे में है'))) = 5 THEN 'PASS' ELSE 'DIFFERS' END,
       to_tsvector('simple', 'मेरा घर पुणे में है')::text;
SELECT 'R-22 matra / chandrabindu kept in one token (Q2)', 'INFO', to_tsvector('simple', 'हूँ खाना')::text;
SELECT 'R-23 pg_trgm available (Q3; NOT installed by this probe)', 'INFO',
       coalesce((SELECT default_version FROM pg_available_extensions WHERE name = 'pg_trgm'), 'not available')
       || ' installed=' || EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm');
SELECT 'R-24 vector extension', CASE WHEN EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN 'PASS' ELSE 'FAIL' END, '';

-- ── R-30 NEW-1 (T-AWS-02): unscoped definer lookup + erasure as the runtime role ──────────
BEGIN;
SELECT set_config('karen.user_id', 'f0000000-0000-4000-8000-0000000000a1', true) \g /dev/null
INSERT INTO identity.users (id, updated_at) VALUES ('f0000000-0000-4000-8000-0000000000a1', now());
UPDATE identity.users SET status = 'ACTIVE' WHERE id = 'f0000000-0000-4000-8000-0000000000a1';
UPDATE identity.users SET status = 'DELETION_REQUESTED' WHERE id = 'f0000000-0000-4000-8000-0000000000a1';
INSERT INTO consent.data_rights_requests (id, user_id, kind, status, active_kind, scheduled_for, updated_at)
VALUES ('f0000000-0000-4000-8000-0000000000b1', 'f0000000-0000-4000-8000-0000000000a1', 'deletion', 'scheduled', 'deletion', now() - interval '1 day', now());
COMMIT;
\connect :runtime_url
SELECT 'R-30 unscoped lookup as runtime (NEW-1)',
       CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL' END, count(*) || ' row(s)'
  FROM consent.lookup_data_rights_request('f0000000-0000-4000-8000-0000000000b1');
BEGIN;
SELECT set_config('karen.data_rights_lookup_id', 'f0000000-0000-4000-8000-0000000000b1', true) \g /dev/null
SELECT 'R-31 runtime cannot read the table unscoped, even with the lookup GUC',
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END, count(*) || ' row(s)'
  FROM consent.data_rights_requests WHERE id = 'f0000000-0000-4000-8000-0000000000b1';
COMMIT;
SELECT 'R-32 erase_user as runtime (NEW-1)',
       CASE WHEN identity.erase_user('f0000000-0000-4000-8000-0000000000b1') = 'completed' THEN 'PASS' ELSE 'FAIL' END, '';
\connect :migration_url
SELECT 'R-33 erased account tombstoned', CASE WHEN status::text = 'DELETED' THEN 'PASS' ELSE 'FAIL' END, status::text
  FROM identity.users WHERE id = 'f0000000-0000-4000-8000-0000000000a1';

-- ── R-40 memory maintenance (M2b; T-AWS-03) — callable by the runtime role, scope restored ──
\connect :runtime_url
SELECT 'R-40 purge_expired callable by runtime', 'PASS', row_to_json(p)::text FROM memory.purge_expired(NULL, 10) p;
SELECT 'R-41 terminate_stale_jobs callable by runtime', 'PASS', memory.terminate_stale_jobs(10)::text;
SELECT 'R-42 caller scope empty afterwards', CASE WHEN coalesce(current_setting('karen.user_id', true), '') = '' THEN 'PASS' ELSE 'FAIL' END, '';
SELECT 'R-43 runtime sees no jobs unscoped', CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END, count(*)::text FROM memory.extraction_jobs;
\connect :migration_url

-- ── cleanup of the synthetic rows ─────────────────────────────────────────────────────────
BEGIN;
SELECT set_config('karen.user_id', 'f0000000-0000-4000-8000-0000000000a1', true) \g /dev/null
DELETE FROM consent.data_rights_requests WHERE id = 'f0000000-0000-4000-8000-0000000000b1';
DELETE FROM consent.consent_receipts WHERE user_id = 'f0000000-0000-4000-8000-0000000000a1';
DELETE FROM identity.users WHERE id = 'f0000000-0000-4000-8000-0000000000a1';
COMMIT;
SELECT 'R-99 synthetic rows removed', CASE WHEN NOT EXISTS (SELECT 1 FROM identity.users WHERE id = 'f0000000-0000-4000-8000-0000000000a1') THEN 'PASS' ELSE 'FAIL' END, '';
