-- Phase 01 / M1 — first-party identity foundation (ADR-0015).
--   * deny-by-default account status for new rows (PENDING_VERIFICATION)
--   * database-enforced account state machine (mirrors @karen/domain ACCOUNT_TRANSITIONS;
--     test/identity.int.test.ts asserts both agree on every pair)
--   * identity.user_emails  — case-insensitive unique canonical e-mail per account
--   * identity.password_credentials — Argon2id verifiers only (never passwords)
--   * identity.lookup_password_login — the ONLY pre-authentication read path (exact match)
-- Rollback (forward-fix preferred): DROP FUNCTION identity.lookup_password_login(text);
--   DROP TABLE identity.password_credentials, identity.user_emails;
--   DROP TRIGGER users_status_transition ON identity.users;
--   ALTER TABLE identity.users ALTER COLUMN status SET DEFAULT 'ACTIVE';
--   (enum values from the previous migration cannot be dropped; they are harmless unused.)
-- Atomic: Prisma does not wrap migrations in a transaction (scripts/check-migrations.mjs).
BEGIN;

ALTER TABLE "identity"."users" ALTER COLUMN "status" SET DEFAULT 'PENDING_VERIFICATION';

-- ── Account state machine ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION "identity"."enforce_user_status_transition"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Accounts are born unverified; ACTIVE only for explicit local/test provisioning and the
    -- (M8) audited bootstrap. Any other initial status is a bug.
    IF NEW.status NOT IN ('PENDING_VERIFICATION', 'ACTIVE') THEN
      RAISE EXCEPTION 'identity.users: invalid initial status %', NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  IF NOT (
       (OLD.status = 'PENDING_VERIFICATION' AND NEW.status IN ('ACTIVE', 'SUSPENDED', 'DELETED'))
    OR (OLD.status = 'ACTIVE'               AND NEW.status IN ('LOCKED', 'SUSPENDED', 'DELETION_REQUESTED'))
    OR (OLD.status = 'LOCKED'               AND NEW.status IN ('ACTIVE', 'SUSPENDED'))
    OR (OLD.status = 'SUSPENDED'            AND NEW.status IN ('ACTIVE', 'DELETED'))
    OR (OLD.status = 'DELETION_REQUESTED'   AND NEW.status IN ('ACTIVE', 'DELETED'))
  ) THEN
    RAISE EXCEPTION 'identity.users: status transition % -> % is not allowed', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "users_status_transition"
  BEFORE INSERT OR UPDATE OF "status" ON "identity"."users"
  FOR EACH ROW EXECUTE FUNCTION "identity"."enforce_user_status_transition"();

-- ── identity.user_emails ──────────────────────────────────────────────────────────────────
CREATE TABLE "identity"."user_emails" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "email_canonical" VARCHAR(254) NOT NULL,
    "verified_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_emails_pkey" PRIMARY KEY ("id"),
    -- Canonical form is produced by the application; the database refuses anything that
    -- would break case-insensitive uniqueness.
    CONSTRAINT "user_emails_canonical_lowercase" CHECK ("email_canonical" = lower("email_canonical")),
    CONSTRAINT "user_emails_canonical_shape" CHECK ("email_canonical" ~ '^[^@\s]+@[a-z0-9.-]+$'),
    CONSTRAINT "user_emails_display_matches" CHECK (lower("email") = "email_canonical")
);

CREATE UNIQUE INDEX "user_emails_user_id_key" ON "identity"."user_emails"("user_id");
CREATE UNIQUE INDEX "user_emails_email_canonical_key" ON "identity"."user_emails"("email_canonical");

ALTER TABLE "identity"."user_emails" ADD CONSTRAINT "user_emails_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── identity.password_credentials ─────────────────────────────────────────────────────────
CREATE TABLE "identity"."password_credentials" (
    "user_id" UUID NOT NULL,
    "password_hash" TEXT NOT NULL,
    "pepper_id" VARCHAR(32),
    "scheme" VARCHAR(32) NOT NULL,
    "password_changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "password_credentials_pkey" PRIMARY KEY ("user_id"),
    -- Defence in depth against ever storing a plaintext or weak-scheme value.
    CONSTRAINT "password_credentials_argon2id" CHECK ("password_hash" LIKE '$argon2id$v=19$%'),
    CONSTRAINT "password_credentials_hash_length" CHECK (char_length("password_hash") BETWEEN 80 AND 512)
);

ALTER TABLE "identity"."password_credentials" ADD CONSTRAINT "password_credentials_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Row-level security: owner-only. NOT FORCEd, because the pre-authentication lookup
-- below runs as the table owner (same pattern as external_identities). ──────────────────────
ALTER TABLE "identity"."user_emails" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_emails_owner" ON "identity"."user_emails"
  USING ("user_id" = "identity"."current_user_id"())
  WITH CHECK ("user_id" = "identity"."current_user_id"());

ALTER TABLE "identity"."password_credentials" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "password_credentials_owner" ON "identity"."password_credentials"
  USING ("user_id" = "identity"."current_user_id"())
  WITH CHECK ("user_id" = "identity"."current_user_id"());

-- ── Pre-authentication lookup ─────────────────────────────────────────────────────────────
-- Exactly one canonical e-mail in, at most one row out (unique index). Cannot enumerate or
-- pattern-match. Returns the verifier because the caller must verify a password; the pepper
-- (outside the DB) is what keeps these hashes uncrackable if this path is abused.
CREATE OR REPLACE FUNCTION "identity"."lookup_password_login"(p_email_canonical text)
RETURNS TABLE (
  "user_id" uuid,
  "status" "identity"."UserStatus",
  "email_verified" boolean,
  "password_hash" text,
  "pepper_id" text,
  "scheme" text,
  "credential_version" integer
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT u."id", u."status", e."verified_at" IS NOT NULL,
         pc."password_hash", pc."pepper_id", pc."scheme", pc."version"
  FROM "identity"."user_emails" e
  JOIN "identity"."users" u ON u."id" = e."user_id"
  LEFT JOIN "identity"."password_credentials" pc ON pc."user_id" = u."id"
  WHERE e."email_canonical" = p_email_canonical
$$;

REVOKE ALL ON FUNCTION "identity"."lookup_password_login"(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "identity"."enforce_user_status_transition"() FROM PUBLIC;

COMMIT;
