-- Phase 01 / M6 — versioned notices, append-only hash-chained consent receipts, one current
-- decision per (user, purpose, scope), notice hash on legal acceptances.
-- Rollback: DROP TABLE consent.consent_receipts, consent.notices;
--   DROP INDEX consent.consent_grants_user_id_purpose_scope_key;
--   ALTER TABLE consent.legal_acceptances DROP COLUMN notice_sha256;
-- Atomic: Prisma does not wrap migrations in a transaction (scripts/check-migrations.mjs).
BEGIN;

-- AlterTable
ALTER TABLE "consent"."legal_acceptances" ADD COLUMN     "notice_sha256" VARCHAR(80);

-- CreateTable
CREATE TABLE "consent"."notices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" VARCHAR(32) NOT NULL,
    "locale" VARCHAR(8) NOT NULL,
    "version" VARCHAR(32) NOT NULL,
    "state" VARCHAR(16) NOT NULL DEFAULT 'draft',
    "content" TEXT NOT NULL,
    "content_sha256" VARCHAR(80) NOT NULL,
    "effective_from" TIMESTAMPTZ(3),
    "approved_by" VARCHAR(128),
    "approved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent"."consent_receipts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "purpose" "consent"."ConsentPurpose" NOT NULL,
    "scope" VARCHAR(255) NOT NULL DEFAULT '*',
    "decision" VARCHAR(16) NOT NULL,
    "notice_kind" VARCHAR(32) NOT NULL,
    "notice_version" VARCHAR(32) NOT NULL,
    "notice_sha256" VARCHAR(80) NOT NULL,
    "source" VARCHAR(32) NOT NULL,
    "method" VARCHAR(64) NOT NULL,
    "idempotency_key" VARCHAR(128),
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "prev_hash" VARCHAR(80),
    "receipt_hash" VARCHAR(80) NOT NULL,
    "receipt_mac" VARCHAR(100) NOT NULL,

    CONSTRAINT "consent_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notices_kind_locale_version_key" ON "consent"."notices"("kind", "locale", "version");

-- CreateIndex
CREATE UNIQUE INDEX "consent_receipts_user_id_seq_key" ON "consent"."consent_receipts"("user_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "consent_receipts_user_id_idempotency_key_key" ON "consent"."consent_receipts"("user_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "consent_grants_user_id_purpose_scope_key" ON "consent"."consent_grants"("user_id", "purpose", "scope");

-- AddForeignKey
ALTER TABLE "consent"."consent_receipts" ADD CONSTRAINT "consent_receipts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "consent"."notices"
  ADD CONSTRAINT "notices_kind" CHECK ("kind" IN ('privacy_notice', 'terms_of_service', 'ai_disclosure')),
  ADD CONSTRAINT "notices_locale" CHECK ("locale" IN ('en-IN', 'hi-IN')),
  ADD CONSTRAINT "notices_state" CHECK ("state" IN ('draft', 'approved', 'retired')),
  ADD CONSTRAINT "notices_hash" CHECK ("content_sha256" ~ '^sha256:[0-9a-f]{64}$'),
  ADD CONSTRAINT "notices_approval" CHECK (
    ("state" = 'draft') = ("approved_at" IS NULL) AND ("approved_at" IS NULL) = ("approved_by" IS NULL)
    AND ("state" = 'draft' OR "effective_from" IS NOT NULL));

-- Approved notices are immutable: only approved → retired is allowed, nothing else changes.
CREATE OR REPLACE FUNCTION "consent"."protect_approved_notice"() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.state <> 'draft' THEN
      RAISE EXCEPTION 'consent.notices: % notices cannot be deleted', OLD.state USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.state = 'draft' THEN RETURN NEW; END IF;
  IF NEW.content IS DISTINCT FROM OLD.content OR NEW.content_sha256 IS DISTINCT FROM OLD.content_sha256
     OR NEW.version IS DISTINCT FROM OLD.version OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.locale IS DISTINCT FROM OLD.locale OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
     OR NEW.approved_by IS DISTINCT FROM OLD.approved_by OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
     OR NOT (NEW.state = OLD.state OR (OLD.state = 'approved' AND NEW.state = 'retired')) THEN
    RAISE EXCEPTION 'consent.notices: approved notices are immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "notices_immutable_when_approved"
  BEFORE UPDATE OR DELETE ON "consent"."notices"
  FOR EACH ROW EXECUTE FUNCTION "consent"."protect_approved_notice"();
-- Content hash must match content (computed by the database, not trusted from the writer).
CREATE OR REPLACE FUNCTION "consent"."check_notice_hash"() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.content_sha256 <> 'sha256:' || encode(sha256(convert_to(NEW.content, 'UTF8')), 'hex') THEN
    RAISE EXCEPTION 'consent.notices: content_sha256 does not match content' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "notices_hash_matches"
  BEFORE INSERT OR UPDATE ON "consent"."notices"
  FOR EACH ROW EXECUTE FUNCTION "consent"."check_notice_hash"();

ALTER TABLE "consent"."consent_receipts"
  ADD CONSTRAINT "consent_receipts_decision" CHECK ("decision" IN ('granted', 'denied', 'revoked')),
  ADD CONSTRAINT "consent_receipts_seq" CHECK ("seq" >= 1),
  ADD CONSTRAINT "consent_receipts_chain" CHECK (("seq" = 1) = ("prev_hash" IS NULL)),
  ADD CONSTRAINT "consent_receipts_hash" CHECK ("receipt_hash" ~ '^sha256:[0-9a-f]{64}$');

-- Receipts are append-only (same pattern as audit.audit_events). Erasure on account deletion is
-- done by the M7 deletion routine, which disables this trigger only inside its own definer function.
CREATE OR REPLACE FUNCTION "consent"."reject_receipt_mutation"() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF current_setting('karen.erasure', true) = 'on' AND TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'consent.consent_receipts is append-only (% rejected)', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$;
CREATE TRIGGER "consent_receipts_append_only"
  BEFORE UPDATE OR DELETE ON "consent"."consent_receipts"
  FOR EACH ROW EXECUTE FUNCTION "consent"."reject_receipt_mutation"();

-- RLS: receipts are owner-only (FORCEd). Notices are public reference data (no RLS; SELECT-only grant).
ALTER TABLE "consent"."consent_receipts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "consent"."consent_receipts" FORCE ROW LEVEL SECURITY;
CREATE POLICY "consent_receipts_owner" ON "consent"."consent_receipts"
  USING ("user_id" = "identity"."current_user_id"())
  WITH CHECK ("user_id" = "identity"."current_user_id"());

COMMIT;
