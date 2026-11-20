-- Phase 01 / M8 — first-party staff realm (ADR-0017). Separate schema reached only through the
-- karen_staff_runtime role; consumer request-path role has no privileges here.
-- Rollback: DROP SCHEMA staff CASCADE; DROP FUNCTION identity.staff_account_status(uuid);
-- Atomic: Prisma does not wrap migrations in a transaction (scripts/check-migrations.mjs).
BEGIN;

CREATE SCHEMA IF NOT EXISTS "staff";
REVOKE ALL ON SCHEMA "staff" FROM PUBLIC;

-- CreateTable
CREATE TABLE "staff"."accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" VARCHAR(254) NOT NULL,
    "email_canonical" VARCHAR(254) NOT NULL,
    "display_name" VARCHAR(120) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'invited',
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff"."password_credentials" (
    "staff_id" UUID NOT NULL,
    "password_hash" TEXT NOT NULL,
    "pepper_id" VARCHAR(32),
    "scheme" VARCHAR(32) NOT NULL,
    "password_changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "password_credentials_pkey" PRIMARY KEY ("staff_id")
);

-- CreateTable
CREATE TABLE "staff"."webauthn_credentials" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "staff_id" UUID NOT NULL,
    "credential_id" VARCHAR(1024) NOT NULL,
    "public_key" BYTEA NOT NULL,
    "counter" BIGINT NOT NULL DEFAULT 0,
    "transports" VARCHAR(16)[] DEFAULT ARRAY[]::VARCHAR(16)[],
    "device_type" VARCHAR(32) NOT NULL,
    "backed_up" BOOLEAN NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(3),

    CONSTRAINT "webauthn_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff"."sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "staff_id" UUID NOT NULL,
    "token_verifier" VARCHAR(80) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idle_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "absolute_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "step_up_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "revoke_reason" VARCHAR(48),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff"."role_grants" (
    "staff_id" UUID NOT NULL,
    "role" VARCHAR(32) NOT NULL,
    "granted_by" UUID,
    "granted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_grants_pkey" PRIMARY KEY ("staff_id","role")
);

-- CreateTable
CREATE TABLE "staff"."elevations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "staff_id" UUID NOT NULL,
    "role" VARCHAR(32) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "ticket_ref" VARCHAR(64) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
    "duration_minutes" INTEGER NOT NULL,
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3),

    CONSTRAINT "elevations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff"."enrollments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "staff_id" UUID NOT NULL,
    "token_verifier" VARCHAR(80) NOT NULL,
    "created_by" UUID,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounts_email_canonical_key" ON "staff"."accounts"("email_canonical");

-- CreateIndex
CREATE UNIQUE INDEX "webauthn_credentials_credential_id_key" ON "staff"."webauthn_credentials"("credential_id");

-- CreateIndex
CREATE INDEX "webauthn_credentials_staff_id_idx" ON "staff"."webauthn_credentials"("staff_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_verifier_key" ON "staff"."sessions"("token_verifier");

-- CreateIndex
CREATE INDEX "sessions_staff_id_revoked_at_idx" ON "staff"."sessions"("staff_id", "revoked_at");

-- CreateIndex
CREATE INDEX "elevations_staff_id_status_idx" ON "staff"."elevations"("staff_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "enrollments_token_verifier_key" ON "staff"."enrollments"("token_verifier");

-- AddForeignKey
ALTER TABLE "staff"."password_credentials" ADD CONSTRAINT "password_credentials_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"."accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff"."webauthn_credentials" ADD CONSTRAINT "webauthn_credentials_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"."accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff"."sessions" ADD CONSTRAINT "sessions_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"."accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff"."role_grants" ADD CONSTRAINT "role_grants_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"."accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff"."elevations" ADD CONSTRAINT "elevations_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"."accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff"."enrollments" ADD CONSTRAINT "enrollments_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"."accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "staff"."accounts"
  ADD CONSTRAINT "staff_accounts_status" CHECK ("status" IN ('invited', 'active', 'disabled')),
  ADD CONSTRAINT "staff_accounts_canonical" CHECK ("email_canonical" = lower("email_canonical")),
  ADD CONSTRAINT "staff_accounts_name_plain" CHECK ("display_name" !~ '[[:cntrl:]]');
ALTER TABLE "staff"."password_credentials"
  ADD CONSTRAINT "staff_password_argon2id" CHECK ("password_hash" LIKE '$argon2id$v=19$%');
ALTER TABLE "staff"."sessions"
  ADD CONSTRAINT "staff_sessions_token" CHECK ("token_verifier" ~ '^sha256:[0-9a-f]{64}$'),
  ADD CONSTRAINT "staff_sessions_revoked" CHECK (("revoked_at" IS NULL) = ("revoke_reason" IS NULL));
ALTER TABLE "staff"."role_grants"
  ADD CONSTRAINT "staff_role_grants_role" CHECK ("role" IN ('support_agent', 'ops_admin', 'security_admin'));
ALTER TABLE "staff"."elevations"
  ADD CONSTRAINT "staff_elevations_role" CHECK ("role" IN ('support_agent', 'ops_admin', 'security_admin')),
  ADD CONSTRAINT "staff_elevations_status" CHECK ("status" IN ('pending', 'active', 'rejected', 'revoked')),
  ADD CONSTRAINT "staff_elevations_duration" CHECK ("duration_minutes" BETWEEN 5 AND 240),
  ADD CONSTRAINT "staff_elevations_two_person" CHECK ("decided_by" IS NULL OR "decided_by" <> "staff_id"),
  ADD CONSTRAINT "staff_elevations_active" CHECK (("status" = 'active') <= ("expires_at" IS NOT NULL));
ALTER TABLE "staff"."enrollments"
  ADD CONSTRAINT "staff_enrollments_token" CHECK ("token_verifier" ~ '^sha256:[0-9a-f]{64}$');

-- Staff support lookups of consumer accounts expose STATUS ONLY, through this narrow function
-- (the staff role has no privileges on identity.* tables). Callers audit each use with a reason.
CREATE OR REPLACE FUNCTION "identity"."staff_account_status"(p_user_id uuid)
RETURNS TABLE ("status" text, "created_at" timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$ SELECT u."status"::text, u."created_at" FROM "identity"."users" u WHERE u."id" = p_user_id $$;
REVOKE ALL ON FUNCTION "identity"."staff_account_status"(uuid) FROM PUBLIC;

COMMIT;
