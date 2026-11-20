-- Phase 01 / M7 — data export / account deletion requests and the erasure routine.
-- Rollback: DROP FUNCTION identity.erase_user(uuid), consent.lookup_data_rights_request(uuid);
--           DROP TABLE consent.data_rights_requests;
-- Atomic: Prisma does not wrap migrations in a transaction (scripts/check-migrations.mjs).
BEGIN;

-- CreateTable
CREATE TABLE "consent"."data_rights_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "active_kind" VARCHAR(16),
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scheduled_for" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3),
    "export_payload" JSONB,
    "export_sha256" VARCHAR(80),
    "workflow_id" VARCHAR(128),
    "retention_exceptions" JSONB NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "data_rights_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "data_rights_requests_user_id_requested_at_idx" ON "consent"."data_rights_requests"("user_id", "requested_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "data_rights_requests_user_id_active_kind_key" ON "consent"."data_rights_requests"("user_id", "active_kind");

-- AddForeignKey
ALTER TABLE "consent"."data_rights_requests" ADD CONSTRAINT "data_rights_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "consent"."data_rights_requests"
  ADD CONSTRAINT "data_rights_kind" CHECK ("kind" IN ('export', 'deletion')),
  ADD CONSTRAINT "data_rights_status" CHECK ("status" IN
    ('requested', 'scheduled', 'processing', 'ready', 'completed', 'cancelled', 'failed', 'expired')),
  -- At most one OPEN request per (user, kind): active_kind is set exactly while open.
  ADD CONSTRAINT "data_rights_active" CHECK (
    ("active_kind" IS NULL) = ("status" NOT IN ('requested', 'scheduled', 'processing'))
    AND ("active_kind" IS NULL OR "active_kind" = "kind")),
  ADD CONSTRAINT "data_rights_deletion_schedule" CHECK ("kind" <> 'deletion' OR "scheduled_for" IS NOT NULL),
  ADD CONSTRAINT "data_rights_export_hash" CHECK (
    ("export_payload" IS NULL) = ("export_sha256" IS NULL)
    AND ("export_sha256" IS NULL OR "export_sha256" ~ '^sha256:[0-9a-f]{64}$'));

ALTER TABLE "consent"."data_rights_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "consent"."data_rights_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY "data_rights_requests_owner" ON "consent"."data_rights_requests"
  USING ("user_id" = "identity"."current_user_id"())
  WITH CHECK ("user_id" = "identity"."current_user_id"());

-- Worker-initiated internal calls know only the request id: resolve its owner (exact match).
CREATE OR REPLACE FUNCTION "consent"."lookup_data_rights_request"(p_id uuid)
RETURNS TABLE ("user_id" uuid, "kind" text, "status" text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT r."user_id", r."kind"::text, r."status"::text FROM "consent"."data_rights_requests" r WHERE r."id" = p_id
$$;
REVOKE ALL ON FUNCTION "consent"."lookup_data_rights_request"(uuid) FROM PUBLIC;

-- Account erasure (ADR-0020). One transaction; idempotent. Refuses unless the request is a
-- scheduled deletion whose cancellation window has passed AND the account is in
-- DELETION_REQUESTED — so even a compromised API role cannot erase arbitrary accounts.
-- Kept (retention exceptions, pending legal review): the users row as a scrubbed tombstone,
-- consent receipts and legal acceptances (proof of consent), audit events (UUIDs only),
-- and the data-rights requests themselves (proof the request was honoured).
CREATE OR REPLACE FUNCTION "identity"."erase_user"(p_request_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  r record;
  v_status text;
BEGIN
  SELECT q."id", q."user_id", q."kind", q."status", q."scheduled_for" INTO r
    FROM "consent"."data_rights_requests" q WHERE q."id" = p_request_id FOR UPDATE;
  IF NOT FOUND OR r.kind <> 'deletion' THEN
    RAISE EXCEPTION 'erase_user: no deletion request %', p_request_id USING ERRCODE = 'no_data_found';
  END IF;
  IF r.status = 'completed' THEN RETURN 'completed'; END IF;
  IF r.status = 'cancelled' THEN RETURN 'cancelled'; END IF;
  IF r.status <> 'scheduled' THEN
    RAISE EXCEPTION 'erase_user: request % is %', p_request_id, r.status USING ERRCODE = 'check_violation';
  END IF;
  IF r.scheduled_for > now() THEN RETURN 'not_due'; END IF;

  PERFORM set_config('karen.user_id', r.user_id::text, true);
  SELECT u."status"::text INTO v_status FROM "identity"."users" u WHERE u."id" = r.user_id FOR UPDATE;
  IF v_status IS DISTINCT FROM 'DELETION_REQUESTED' THEN
    RAISE EXCEPTION 'erase_user: account is %', v_status USING ERRCODE = 'check_violation';
  END IF;

  DELETE FROM "identity"."refresh_credentials" WHERE "user_id" = r.user_id;
  DELETE FROM "identity"."sessions" WHERE "user_id" = r.user_id;
  DELETE FROM "identity"."devices" WHERE "user_id" = r.user_id;
  DELETE FROM "identity"."verification_challenges" WHERE "user_id" = r.user_id;
  DELETE FROM "identity"."password_credentials" WHERE "user_id" = r.user_id;
  DELETE FROM "identity"."user_emails" WHERE "user_id" = r.user_id;
  DELETE FROM "identity"."user_preferences" WHERE "user_id" = r.user_id;
  DELETE FROM "identity"."saved_places" WHERE "user_id" = r.user_id;
  DELETE FROM "identity"."onboarding_progress" WHERE "user_id" = r.user_id;
  DELETE FROM "identity"."external_identities" WHERE "user_id" = r.user_id;
  DELETE FROM "identity"."staff_role_grants" WHERE "user_id" = r.user_id;
  DELETE FROM "consent"."consent_grants" WHERE "user_id" = r.user_id;
  DELETE FROM "platform"."idempotency_records" WHERE "user_id" = r.user_id;
  UPDATE "consent"."data_rights_requests" SET "export_payload" = NULL, "export_sha256" = NULL,
         "updated_at" = now()
   WHERE "user_id" = r.user_id AND "export_payload" IS NOT NULL;

  UPDATE "identity"."users" SET "status" = 'DELETED', "display_name" = NULL, "preferred_name" = NULL,
         "country" = NULL, "currency" = NULL, "locale" = 'en-IN', "timezone" = 'UTC',
         "version" = "version" + 1, "updated_at" = now()
   WHERE "id" = r.user_id;

  UPDATE "consent"."data_rights_requests"
     SET "status" = 'completed', "active_kind" = NULL, "completed_at" = now(),
         "version" = "version" + 1, "updated_at" = now(),
         "retention_exceptions" = jsonb_build_array(
           jsonb_build_object('category', 'account_tombstone', 'reason', 'scrubbed row keeps references consistent; no personal data'),
           jsonb_build_object('category', 'consent_receipts', 'reason', 'proof of consent decisions (pending legal review)'),
           jsonb_build_object('category', 'legal_acceptances', 'reason', 'proof of accepted terms (pending legal review)'),
           jsonb_build_object('category', 'audit_events', 'reason', 'security audit trail; UUIDs and reason codes only'),
           jsonb_build_object('category', 'backups', 'reason', 'database backups expire on their own schedule (not instant)'))
   WHERE "id" = p_request_id;
  RETURN 'completed';
END;
$$;
REVOKE ALL ON FUNCTION "identity"."erase_user"(uuid) FROM PUBLIC;

COMMIT;
