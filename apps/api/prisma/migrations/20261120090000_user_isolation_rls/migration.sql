-- User-data isolation: PostgreSQL Row-Level Security (docs/security/data-isolation.md).
--
-- Mechanism: the API opens a transaction per user-scoped unit of work and runs
--   SELECT set_config('karen.user_id', '<uuid>', true)   -- transaction-local; pool-safe
-- (PrismaService.withUserScope). Every policy compares the row owner with that setting.
-- A missing/empty setting yields NULL, so an unscoped query sees and writes NOTHING
-- (deny by default) instead of everything.
--
-- RLS is enforced for the runtime role (karen_api_runtime, see infra/database/roles.sql),
-- which never owns tables and has no BYPASSRLS. Table owners (the migration role) bypass
-- non-FORCEd RLS; tables with no definer-function access path also get FORCE so even the
-- owner role is subject to the policies.

-- Current request user from the transaction-local setting; NULL when unset or empty.
-- Atomic: Prisma does not wrap migrations in a transaction (scripts/check-migrations.mjs).
BEGIN;

CREATE OR REPLACE FUNCTION "identity"."current_user_id"() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$ SELECT NULLIF(current_setting('karen.user_id', true), '')::uuid $$;

-- ── identity.users: a user can see and update only their own row ─────────────────────────
ALTER TABLE "identity"."users" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_self" ON "identity"."users"
  USING ("id" = "identity"."current_user_id"())
  WITH CHECK ("id" = "identity"."current_user_id"());

-- ── identity.external_identities: own links only ─────────────────────────────────────────
-- Resolving a token to a user happens BEFORE the user is known, so lookup goes through the
-- narrow SECURITY DEFINER function below (owner context), never through a policy hole.
ALTER TABLE "identity"."external_identities" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "external_identities_owner" ON "identity"."external_identities"
  USING ("user_id" = "identity"."current_user_id"())
  WITH CHECK ("user_id" = "identity"."current_user_id"());

-- ── identity.staff_role_grants: read own grants; writes only via the owner/security path ──
ALTER TABLE "identity"."staff_role_grants" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff_role_grants_read_own" ON "identity"."staff_role_grants"
  FOR SELECT USING ("user_id" = "identity"."current_user_id"());

-- ── consent.* and platform.idempotency_records: owner-only, FORCEd ───────────────────────
ALTER TABLE "consent"."consent_grants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "consent"."consent_grants" FORCE ROW LEVEL SECURITY;
CREATE POLICY "consent_grants_owner" ON "consent"."consent_grants"
  USING ("user_id" = "identity"."current_user_id"())
  WITH CHECK ("user_id" = "identity"."current_user_id"());

ALTER TABLE "consent"."legal_acceptances" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "consent"."legal_acceptances" FORCE ROW LEVEL SECURITY;
CREATE POLICY "legal_acceptances_owner" ON "consent"."legal_acceptances"
  USING ("user_id" = "identity"."current_user_id"())
  WITH CHECK ("user_id" = "identity"."current_user_id"());

ALTER TABLE "platform"."idempotency_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform"."idempotency_records" FORCE ROW LEVEL SECURITY;
CREATE POLICY "idempotency_records_owner" ON "platform"."idempotency_records"
  USING ("user_id" = "identity"."current_user_id"())
  WITH CHECK ("user_id" = "identity"."current_user_id"());

-- audit.audit_events and platform.outbox_events are system tables with no user read path;
-- they are protected by GRANTs (runtime role: INSERT only), not RLS.

-- ── Identity resolution (pre-authentication lookup) ──────────────────────────────────────
-- Returns the link for exactly one verified (issuer, subject) pair. It cannot enumerate:
-- both arguments are required and matched by the unique index. Runs as the table owner.
CREATE OR REPLACE FUNCTION "identity"."lookup_external_identity"(p_issuer text, p_subject text)
RETURNS TABLE ("identity_id" uuid, "user_id" uuid, "last_seen_at" timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT ei."id", ei."user_id", ei."last_seen_at"
  FROM "identity"."external_identities" ei
  WHERE ei."issuer" = p_issuer AND ei."subject" = p_subject
$$;

-- Functions are executable by PUBLIC by default; grant explicitly instead (roles.sql).
REVOKE ALL ON FUNCTION "identity"."lookup_external_identity"(text, text) FROM PUBLIC;

COMMIT;
