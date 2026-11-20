-- Phase 01 / M2 — one-time e-mail codes for verification and password reset (ADR-0015).
-- Stores verifiers only: SHA-256 of the client-held handle, HMAC(OTP_HMAC_KEY) of the code.
-- Rollback: DROP FUNCTION identity.lookup_challenge(text);
--           DROP TABLE identity.verification_challenges; DROP TYPE identity."ChallengePurpose";
-- Atomic: Prisma does not wrap migrations in a transaction (scripts/check-migrations.mjs).
BEGIN;

CREATE TYPE "identity"."ChallengePurpose" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET');

CREATE TABLE "identity"."verification_challenges" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "purpose" "identity"."ChallengePurpose" NOT NULL,
    "handle_verifier" VARCHAR(80) NOT NULL,
    "code_mac" VARCHAR(80) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "send_count" INTEGER NOT NULL DEFAULT 1,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "closed_at" TIMESTAMPTZ(3),
    "close_reason" VARCHAR(32),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "verification_challenges_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "verification_challenges_handle_shape" CHECK ("handle_verifier" ~ '^sha256:[0-9a-f]{64}$'),
    CONSTRAINT "verification_challenges_mac_shape" CHECK ("code_mac" ~ '^hmac-sha256:[0-9a-f]{64}$'),
    CONSTRAINT "verification_challenges_attempts" CHECK ("attempts" >= 0 AND "attempts" <= "max_attempts" AND "max_attempts" BETWEEN 1 AND 10),
    CONSTRAINT "verification_challenges_closed" CHECK (("closed_at" IS NULL) = ("close_reason" IS NULL)),
    CONSTRAINT "verification_challenges_close_reason" CHECK ("close_reason" IN ('consumed', 'superseded', 'attempts_exhausted'))
);

CREATE UNIQUE INDEX "verification_challenges_handle_verifier_key" ON "identity"."verification_challenges"("handle_verifier");
CREATE INDEX "verification_challenges_user_id_purpose_idx" ON "identity"."verification_challenges"("user_id", "purpose");

ALTER TABLE "identity"."verification_challenges" ADD CONSTRAINT "verification_challenges_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Owner-only RLS; not FORCEd because the handle lookup below runs as the owner.
ALTER TABLE "identity"."verification_challenges" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "verification_challenges_owner" ON "identity"."verification_challenges"
  USING ("user_id" = "identity"."current_user_id"())
  WITH CHECK ("user_id" = "identity"."current_user_id"());

-- Pre-authentication: resolve exactly one handle verifier to its owner. Returns no secret
-- material; the caller then works inside that user's RLS scope with SELECT … FOR UPDATE.
CREATE OR REPLACE FUNCTION "identity"."lookup_challenge"(p_handle_verifier text)
RETURNS TABLE ("challenge_id" uuid, "user_id" uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT c."id", c."user_id" FROM "identity"."verification_challenges" c
  WHERE c."handle_verifier" = p_handle_verifier
$$;

REVOKE ALL ON FUNCTION "identity"."lookup_challenge"(text) FROM PUBLIC;

COMMIT;
