-- Phase 01 / M3 — devices, sessions and rotating refresh credentials (ADR-0016).
-- Stores verifiers only (sha256 of opaque tokens). Sessions are checked on every request.
-- Rollback: DROP FUNCTION identity.lookup_session_token(text), identity.lookup_refresh_credential(text);
--           DROP TABLE identity.refresh_credentials, identity.sessions, identity.devices;
--           DROP TYPE identity."ClientKind";
-- Atomic: Prisma does not wrap migrations in a transaction (scripts/check-migrations.mjs).
BEGIN;

-- CreateEnum
CREATE TYPE "identity"."ClientKind" AS ENUM ('WEB', 'IOS', 'ANDROID');

-- CreateTable
CREATE TABLE "identity"."devices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "installation_id" UUID NOT NULL,
    "platform" "identity"."ClientKind" NOT NULL,
    "name" VARCHAR(64),
    "first_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "client" "identity"."ClientKind" NOT NULL,
    "token_verifier" VARCHAR(80),
    "auth_method" VARCHAR(32) NOT NULL,
    "auth_time" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idle_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "absolute_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "revoke_reason" VARCHAR(48),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."refresh_credentials" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "verifier" VARCHAR(80) NOT NULL,
    "generation" INTEGER NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "successor_id" UUID,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "devices_user_id_installation_id_key" ON "identity"."devices"("user_id", "installation_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_verifier_key" ON "identity"."sessions"("token_verifier");

-- CreateIndex
CREATE INDEX "sessions_user_id_revoked_at_idx" ON "identity"."sessions"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "sessions_device_id_idx" ON "identity"."sessions"("device_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_credentials_verifier_key" ON "identity"."refresh_credentials"("verifier");

-- CreateIndex
CREATE INDEX "refresh_credentials_user_id_idx" ON "identity"."refresh_credentials"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_credentials_session_id_generation_key" ON "identity"."refresh_credentials"("session_id", "generation");

-- AddForeignKey
ALTER TABLE "identity"."devices" ADD CONSTRAINT "devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."sessions" ADD CONSTRAINT "sessions_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "identity"."devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."refresh_credentials" ADD CONSTRAINT "refresh_credentials_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "identity"."sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ── Defence-in-depth constraints ──────────────────────────────────────────────────────────
ALTER TABLE "identity"."sessions"
  ADD CONSTRAINT "sessions_token_verifier_shape" CHECK ("token_verifier" IS NULL OR "token_verifier" ~ '^sha256:[0-9a-f]{64}$'),
  ADD CONSTRAINT "sessions_web_has_token" CHECK (("client" = 'WEB') = ("token_verifier" IS NOT NULL)),
  ADD CONSTRAINT "sessions_revoked_consistent" CHECK (("revoked_at" IS NULL) = ("revoke_reason" IS NULL)),
  ADD CONSTRAINT "sessions_expiry_order" CHECK ("idle_expires_at" <= "absolute_expires_at" AND "absolute_expires_at" > "created_at");
ALTER TABLE "identity"."refresh_credentials"
  ADD CONSTRAINT "refresh_credentials_verifier_shape" CHECK ("verifier" ~ '^sha256:[0-9a-f]{64}$'),
  ADD CONSTRAINT "refresh_credentials_generation" CHECK ("generation" >= 0),
  ADD CONSTRAINT "refresh_credentials_successor_consumed" CHECK ("successor_id" IS NULL OR "consumed_at" IS NOT NULL);
ALTER TABLE "identity"."devices"
  ADD CONSTRAINT "devices_name_plain" CHECK ("name" IS NULL OR "name" !~ '[[:cntrl:]]');

-- ── RLS: owner-only; not FORCEd because the token lookups below run as the owner ──────────
ALTER TABLE "identity"."devices" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "devices_owner" ON "identity"."devices"
  USING ("user_id" = "identity"."current_user_id"())
  WITH CHECK ("user_id" = "identity"."current_user_id"());
ALTER TABLE "identity"."sessions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sessions_owner" ON "identity"."sessions"
  USING ("user_id" = "identity"."current_user_id"())
  WITH CHECK ("user_id" = "identity"."current_user_id"());
ALTER TABLE "identity"."refresh_credentials" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "refresh_credentials_owner" ON "identity"."refresh_credentials"
  USING ("user_id" = "identity"."current_user_id"())
  WITH CHECK ("user_id" = "identity"."current_user_id"());

-- ── Pre-authentication lookups: exactly one verifier in, owner ids out, no secrets ────────
CREATE OR REPLACE FUNCTION "identity"."lookup_session_token"(p_verifier text)
RETURNS TABLE ("session_id" uuid, "user_id" uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT s."id", s."user_id" FROM "identity"."sessions" s WHERE s."token_verifier" = p_verifier
$$;
CREATE OR REPLACE FUNCTION "identity"."lookup_refresh_credential"(p_verifier text)
RETURNS TABLE ("credential_id" uuid, "session_id" uuid, "user_id" uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT r."id", r."session_id", r."user_id" FROM "identity"."refresh_credentials" r WHERE r."verifier" = p_verifier
$$;
REVOKE ALL ON FUNCTION "identity"."lookup_session_token"(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "identity"."lookup_refresh_credential"(text) FROM PUBLIC;

COMMIT;
