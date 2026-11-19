-- KAREN foundation migration.
-- Extensions are managed here (not via Prisma preview features). pgvector is enabled now so
-- the memory feature can add vector columns via SQL migrations (see docs/database/pgvector.md).
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "audit";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "consent";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "identity";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "platform";

-- CreateEnum
CREATE TYPE "identity"."UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETION_REQUESTED');

-- CreateEnum
CREATE TYPE "identity"."StaffRole" AS ENUM ('support_agent', 'ops_admin', 'security_admin');

-- CreateEnum
CREATE TYPE "consent"."ConsentPurpose" AS ENUM ('AI_PROCESSING', 'MEMORY_STORAGE', 'CONNECTOR_ACCESS', 'PROACTIVE_SUGGESTIONS', 'COMMUNICATIONS', 'ACTION_EXECUTION', 'PRODUCT_ANALYTICS');

-- CreateEnum
CREATE TYPE "consent"."ConsentStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "audit"."ActorType" AS ENUM ('USER', 'STAFF', 'SYSTEM', 'SERVICE');

-- CreateEnum
CREATE TYPE "audit"."AuditOutcome" AS ENUM ('SUCCESS', 'DENIED', 'FAILURE');

-- CreateTable
CREATE TABLE "identity"."users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "display_name" VARCHAR(120),
    "locale" VARCHAR(35) NOT NULL DEFAULT 'en-IN',
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
    "status" "identity"."UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."external_identities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "issuer" VARCHAR(512) NOT NULL,
    "subject" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "external_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."staff_role_grants" (
    "user_id" UUID NOT NULL,
    "role" "identity"."StaffRole" NOT NULL,
    "granted_by" UUID,
    "granted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_role_grants_pkey" PRIMARY KEY ("user_id","role")
);

-- CreateTable
CREATE TABLE "consent"."consent_grants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "purpose" "consent"."ConsentPurpose" NOT NULL,
    "scope" VARCHAR(255) NOT NULL DEFAULT '*',
    "provider_id" VARCHAR(64),
    "policy_version" VARCHAR(32) NOT NULL,
    "status" "consent"."ConsentStatus" NOT NULL DEFAULT 'ACTIVE',
    "receipt_hash" VARCHAR(80) NOT NULL,
    "granted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "consent_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent"."legal_acceptances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "document_type" VARCHAR(64) NOT NULL,
    "document_version" VARCHAR(32) NOT NULL,
    "locale" VARCHAR(35) NOT NULL,
    "accepted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_acceptances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit"."audit_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_type" "audit"."ActorType" NOT NULL,
    "actor_ref" VARCHAR(128),
    "action" VARCHAR(128) NOT NULL,
    "subject_type" VARCHAR(64),
    "subject_id" VARCHAR(128),
    "outcome" "audit"."AuditOutcome" NOT NULL,
    "request_id" VARCHAR(128),
    "trace_id" VARCHAR(64),
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."outbox_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "aggregate_type" VARCHAR(64) NOT NULL,
    "aggregate_id" VARCHAR(128) NOT NULL,
    "event_type" VARCHAR(128) NOT NULL,
    "event_version" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."idempotency_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "scope" VARCHAR(64) NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "request_fingerprint" VARCHAR(80) NOT NULL,
    "response_status" INTEGER,
    "response_body" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "external_identities_user_id_idx" ON "identity"."external_identities"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "external_identities_issuer_subject_key" ON "identity"."external_identities"("issuer", "subject");

-- CreateIndex
CREATE INDEX "consent_grants_user_id_purpose_status_idx" ON "consent"."consent_grants"("user_id", "purpose", "status");

-- CreateIndex
CREATE UNIQUE INDEX "legal_acceptances_user_id_document_type_document_version_key" ON "consent"."legal_acceptances"("user_id", "document_type", "document_version");

-- CreateIndex
CREATE INDEX "audit_events_actor_ref_occurred_at_idx" ON "audit"."audit_events"("actor_ref", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "audit_events_subject_type_subject_id_occurred_at_idx" ON "audit"."audit_events"("subject_type", "subject_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "audit_events_request_id_idx" ON "audit"."audit_events"("request_id");

-- CreateIndex
CREATE INDEX "outbox_events_published_at_occurred_at_idx" ON "platform"."outbox_events"("published_at", "occurred_at");

-- CreateIndex
CREATE INDEX "idempotency_records_expires_at_idx" ON "platform"."idempotency_records"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_user_id_scope_key_key" ON "platform"."idempotency_records"("user_id", "scope", "key");

-- AddForeignKey
ALTER TABLE "identity"."external_identities" ADD CONSTRAINT "external_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."staff_role_grants" ADD CONSTRAINT "staff_role_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent"."consent_grants" ADD CONSTRAINT "consent_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent"."legal_acceptances" ADD CONSTRAINT "legal_acceptances_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Audit events are append-only: reject UPDATE and DELETE at the database level
-- (defence in depth on top of application code). Retention/archival will use partition
-- detachment by a privileged maintenance role, not row deletes.
CREATE OR REPLACE FUNCTION "audit"."reject_audit_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit.audit_events is append-only (% rejected)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER "audit_events_append_only"
  BEFORE UPDATE OR DELETE ON "audit"."audit_events"
  FOR EACH ROW EXECUTE FUNCTION "audit"."reject_audit_mutation"();

CREATE TRIGGER "audit_events_no_truncate"
  BEFORE TRUNCATE ON "audit"."audit_events"
  FOR EACH STATEMENT EXECUTE FUNCTION "audit"."reject_audit_mutation"();
