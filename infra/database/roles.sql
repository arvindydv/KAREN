-- KAREN least-privilege database roles and grants (data-isolation.md, layer 3).
--
-- Idempotent. Run by an OPERATOR (never automatically, never by an application) as the role
-- that owns the schemas/tables (the migration role), once per database, after every
-- migration that adds tables:
--     psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f infra/database/roles.sql
-- Locally `pnpm db:roles` does this and also creates the local-only login role.
--
-- Model
--   <owner>            : the migration role (runs `prisma migrate deploy`); owns all objects.
--                        In AWS this is a dedicated role, NOT the RDS master user.
--   karen_api_runtime  : NOLOGIN group role for the API. No ownership, no DDL, no BYPASSRLS,
--                        no DELETE anywhere, INSERT-only on audit/outbox. Subject to RLS.
--   login users        : created per environment and granted the group, e.g.
--                          CREATE ROLE karen_api LOGIN PASSWORD :'pw' IN ROLE karen_api_runtime;
--                        (password from Secrets Manager, or RDS IAM auth via GRANT rds_iam).
-- Other services (temporal-worker, provider-worker, ai-service, voice-agent) have NO
-- PostgreSQL access today; they reach business state through the API. Add a role here only
-- with a feature that needs one.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'karen_api_runtime') THEN
    CREATE ROLE karen_api_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

-- Hard guarantees even if someone altered the role by hand.
ALTER ROLE karen_api_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

-- Nobody but the owner may create objects in public or in KAREN schemas.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA identity, consent, audit, platform FROM PUBLIC;

GRANT USAGE ON SCHEMA identity, consent, audit, platform TO karen_api_runtime;

-- Start from zero on every run so removed privileges do not linger.
REVOKE ALL ON ALL TABLES IN SCHEMA identity, consent, audit, platform FROM karen_api_runtime;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA identity, consent, audit, platform FROM karen_api_runtime;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA identity, consent, audit, platform FROM karen_api_runtime;

-- identity (RLS: own rows only)
GRANT SELECT, INSERT, UPDATE ON identity.users TO karen_api_runtime;
GRANT SELECT, INSERT, UPDATE ON identity.external_identities TO karen_api_runtime;
GRANT SELECT ON identity.staff_role_grants TO karen_api_runtime;   -- writes: security-admin path
GRANT EXECUTE ON FUNCTION identity.current_user_id() TO karen_api_runtime;
GRANT EXECUTE ON FUNCTION identity.lookup_external_identity(text, text) TO karen_api_runtime;
-- First-party credentials (ADR-0015). No DELETE: account erasure is the M7 deletion worker's
-- role, not the request path. Pre-auth reads go only through lookup_password_login.
GRANT SELECT, INSERT, UPDATE ON identity.user_emails TO karen_api_runtime;
GRANT SELECT, INSERT, UPDATE ON identity.password_credentials TO karen_api_runtime;
GRANT EXECUTE ON FUNCTION identity.lookup_password_login(text) TO karen_api_runtime;
-- One-time codes (M2). Closing a challenge is an UPDATE; rows are purged by the M7 worker.
GRANT SELECT, INSERT, UPDATE ON identity.verification_challenges TO karen_api_runtime;
GRANT EXECUTE ON FUNCTION identity.lookup_challenge(text) TO karen_api_runtime;
-- Sessions (M3). Revocation is an UPDATE (revoked_at); rows are purged by the M7 worker.
GRANT SELECT, INSERT, UPDATE ON identity.devices TO karen_api_runtime;
GRANT SELECT, INSERT, UPDATE ON identity.sessions TO karen_api_runtime;
GRANT SELECT, INSERT, UPDATE ON identity.refresh_credentials TO karen_api_runtime;
GRANT EXECUTE ON FUNCTION identity.lookup_session_token(text) TO karen_api_runtime;
GRANT EXECUTE ON FUNCTION identity.lookup_refresh_credential(text) TO karen_api_runtime;
-- Profile (M4). Saved places are user content the user may delete outright (hard DELETE, RLS).
GRANT SELECT, INSERT, UPDATE ON identity.user_preferences TO karen_api_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON identity.saved_places TO karen_api_runtime;
-- Onboarding (M5).
GRANT SELECT, INSERT, UPDATE ON identity.onboarding_progress TO karen_api_runtime;

-- consent (RLS: own rows only; revocation is an UPDATE, never a DELETE)
GRANT SELECT, INSERT, UPDATE ON consent.consent_grants TO karen_api_runtime;
GRANT SELECT, INSERT ON consent.legal_acceptances TO karen_api_runtime;
-- M6: notices are read-only to the API (written by operators after legal approval);
-- receipts are append-only (INSERT + SELECT; a trigger also blocks UPDATE/DELETE).
GRANT SELECT ON consent.notices TO karen_api_runtime;
GRANT SELECT, INSERT ON consent.consent_receipts TO karen_api_runtime;
-- M7: data-rights requests (no DELETE — kept as proof). Erasure only through erase_user(),
-- which refuses anything but a due, scheduled deletion of a DELETION_REQUESTED account.
GRANT SELECT, INSERT, UPDATE ON consent.data_rights_requests TO karen_api_runtime;
GRANT EXECUTE ON FUNCTION consent.lookup_data_rights_request(uuid) TO karen_api_runtime;
GRANT EXECUTE ON FUNCTION identity.erase_user(uuid) TO karen_api_runtime;

-- platform
GRANT SELECT, INSERT, UPDATE ON platform.idempotency_records TO karen_api_runtime;  -- RLS
GRANT INSERT ON platform.outbox_events TO karen_api_runtime;  -- relay gets its own role later

-- audit: append-only for the application (trigger also blocks UPDATE/DELETE/TRUNCATE)
GRANT INSERT ON audit.audit_events TO karen_api_runtime;

-- Objects created by future migrations get NO automatic grants: each new table must be
-- added to this file deliberately (reviewed with the migration), so default privileges
-- are intentionally not used.

-- ── Staff realm (Phase 01 M8, ADR-0017) ───────────────────────────────────────────────────
-- karen_staff_runtime: used ONLY by the API's staff-realm connection pool. It cannot touch
-- consumer tables (identity/consent/platform), and the consumer runtime role cannot touch staff.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'karen_staff_runtime') THEN
    CREATE ROLE karen_staff_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;
ALTER ROLE karen_staff_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

REVOKE ALL ON SCHEMA staff FROM PUBLIC;
REVOKE ALL ON SCHEMA staff FROM karen_api_runtime;
REVOKE ALL ON ALL TABLES IN SCHEMA staff FROM karen_api_runtime;
REVOKE ALL ON ALL TABLES IN SCHEMA staff, identity, consent, audit, platform FROM karen_staff_runtime;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA staff, identity, consent, audit, platform FROM karen_staff_runtime;

GRANT USAGE ON SCHEMA staff, audit, identity TO karen_staff_runtime;
-- No DELETE anywhere: revocation, disablement and expiry are UPDATEs (kept for audit).
GRANT SELECT, INSERT, UPDATE ON staff.accounts, staff.password_credentials,
  staff.webauthn_credentials, staff.sessions, staff.elevations, staff.enrollments
  TO karen_staff_runtime;
GRANT SELECT, INSERT ON staff.role_grants TO karen_staff_runtime;
-- Role removal is the one hard delete (a removed grant must not linger); audited by the API.
GRANT DELETE ON staff.role_grants TO karen_staff_runtime;
GRANT INSERT ON audit.audit_events TO karen_staff_runtime;
-- Support lookups see account STATUS only, never profile/e-mail/content.
GRANT EXECUTE ON FUNCTION identity.staff_account_status(uuid) TO karen_staff_runtime;
