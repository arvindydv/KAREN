-- Phase 02 / P2-M1 — conversations, stream events, feedback, AI invocations, usage ledger
-- (ADR-0021, ADR-0022, ADR-0023). Reviewed SQL; never auto-applied to production.
-- Rollback (pre-production only; destroys conversation data):
--   DROP SCHEMA conversation CASCADE; DROP TABLE platform.ai_invocations, platform.usage_ledger;
--   then re-run 20261120220000_consent_data_rights' erase_user definition.
-- Atomic: Prisma does not wrap migrations in a transaction (scripts/check-migrations.mjs).
BEGIN;
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "conversation";

-- CreateTable
CREATE TABLE "conversation"."threads" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "title_source" VARCHAR(8) NOT NULL DEFAULT 'auto',
    "locale" VARCHAR(35) NOT NULL,
    "mode" VARCHAR(16) NOT NULL DEFAULT 'standard',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMPTZ(3),
    "last_message_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3),
    "next_seq" INTEGER NOT NULL DEFAULT 1,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation"."messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "thread_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "role" VARCHAR(16) NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "client_idempotency_key" VARCHAR(128),
    "request_id" VARCHAR(128),
    "reply_to_message_id" UUID,
    "regenerated_from_id" UUID,
    "superseded_at" TIMESTAMPTZ(3),
    "error_code" VARCHAR(64),
    "error_retryable" BOOLEAN,
    "finish_reason" VARCHAR(32),
    "route_tier" VARCHAR(16),
    "is_mock" BOOLEAN,
    "last_event_seq" INTEGER NOT NULL DEFAULT 0,
    "lease_expires_at" TIMESTAMPTZ(3),
    "cancel_requested_at" TIMESTAMPTZ(3),
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation"."message_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" VARCHAR(24) NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation"."feedback" (
    "message_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "rating" VARCHAR(8) NOT NULL,
    "category" VARCHAR(32),
    "comment" VARCHAR(1000),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "feedback_pkey" PRIMARY KEY ("message_id")
);

-- CreateTable
CREATE TABLE "platform"."ai_invocations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "message_id" UUID,
    "request_id" VARCHAR(128) NOT NULL,
    "route_tier" VARCHAR(16),
    "requested_model" VARCHAR(128),
    "served_model" VARCHAR(128),
    "gateway_request_id" VARCHAR(128),
    "prompt_version" VARCHAR(64),
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "cost_micro_usd" BIGINT NOT NULL DEFAULT 0,
    "ttft_ms" INTEGER,
    "latency_ms" INTEGER,
    "fallback_used" BOOLEAN NOT NULL DEFAULT false,
    "is_mock" BOOLEAN NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "error_code" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_invocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."usage_ledger" (
    "user_id" UUID NOT NULL,
    "period_start" DATE NOT NULL,
    "cost_micro_usd" BIGINT NOT NULL DEFAULT 0,
    "input_tokens" BIGINT NOT NULL DEFAULT 0,
    "output_tokens" BIGINT NOT NULL DEFAULT 0,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "usage_ledger_pkey" PRIMARY KEY ("user_id","period_start")
);

-- CreateIndex
CREATE INDEX "threads_user_id_pinned_last_message_at_idx" ON "conversation"."threads"("user_id", "pinned" DESC, "last_message_at" DESC);

-- CreateIndex
CREATE INDEX "threads_user_id_archived_at_idx" ON "conversation"."threads"("user_id", "archived_at");

-- CreateIndex
CREATE INDEX "messages_user_id_thread_id_seq_idx" ON "conversation"."messages"("user_id", "thread_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "messages_thread_id_seq_key" ON "conversation"."messages"("thread_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "messages_user_id_client_idempotency_key_key" ON "conversation"."messages"("user_id", "client_idempotency_key");

-- CreateIndex
CREATE INDEX "message_events_user_id_message_id_seq_idx" ON "conversation"."message_events"("user_id", "message_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "message_events_message_id_seq_key" ON "conversation"."message_events"("message_id", "seq");

-- CreateIndex
CREATE INDEX "feedback_user_id_idx" ON "conversation"."feedback"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_invocations_request_id_key" ON "platform"."ai_invocations"("request_id");

-- CreateIndex
CREATE INDEX "ai_invocations_user_id_created_at_idx" ON "platform"."ai_invocations"("user_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "conversation"."threads" ADD CONSTRAINT "threads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation"."messages" ADD CONSTRAINT "messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "conversation"."threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation"."message_events" ADD CONSTRAINT "message_events_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "conversation"."messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation"."feedback" ADD CONSTRAINT "feedback_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "conversation"."messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform"."ai_invocations" ADD CONSTRAINT "ai_invocations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform"."usage_ledger" ADD CONSTRAINT "usage_ledger_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ── Domain constraints (the API also validates; the DB is the last line) ──────────────────
ALTER TABLE "conversation"."threads"
  ADD CONSTRAINT "threads_mode" CHECK ("mode" IN ('standard', 'ephemeral')),
  ADD CONSTRAINT "threads_title_source" CHECK ("title_source" IN ('auto', 'user')),
  ADD CONSTRAINT "threads_title_len" CHECK (char_length("title") BETWEEN 1 AND 120),
  ADD CONSTRAINT "threads_ephemeral_expiry" CHECK (("mode" = 'ephemeral') = ("expires_at" IS NOT NULL)),
  ADD CONSTRAINT "threads_next_seq" CHECK ("next_seq" >= 1);

ALTER TABLE "conversation"."messages"
  ADD CONSTRAINT "messages_role" CHECK ("role" IN ('user', 'assistant')),
  ADD CONSTRAINT "messages_status" CHECK ("status" IN
    ('pending', 'accepted', 'streaming', 'completed', 'incomplete', 'failed', 'canceled')),
  ADD CONSTRAINT "messages_user_status" CHECK ("role" <> 'user' OR "status" = 'completed'),
  ADD CONSTRAINT "messages_seq" CHECK ("seq" >= 1),
  ADD CONSTRAINT "messages_content_len" CHECK (char_length("content") <= 100000),
  ADD CONSTRAINT "messages_reply_shape" CHECK (("role" = 'assistant') = ("reply_to_message_id" IS NOT NULL));

-- One generation at a time per thread (concurrency limit, enforced by the database).
CREATE UNIQUE INDEX "messages_one_active_generation_per_thread"
  ON "conversation"."messages" ("thread_id")
  WHERE "role" = 'assistant' AND "status" IN ('pending', 'accepted', 'streaming');
-- Runner/reaper lookups of live generations.
CREATE INDEX "messages_active_lease_idx" ON "conversation"."messages" ("lease_expires_at")
  WHERE "status" IN ('pending', 'accepted', 'streaming');

ALTER TABLE "conversation"."message_events"
  ADD CONSTRAINT "message_events_type" CHECK ("type" IN
    ('accepted', 'status', 'token_delta', 'source', 'tool_proposed', 'usage', 'complete', 'error')),
  ADD CONSTRAINT "message_events_seq" CHECK ("seq" >= 1);

ALTER TABLE "conversation"."feedback"
  ADD CONSTRAINT "feedback_rating" CHECK ("rating" IN ('up', 'down')),
  ADD CONSTRAINT "feedback_category" CHECK ("category" IS NULL OR "category" IN
    ('wrong_fact', 'too_slow', 'language', 'unsafe_action', 'unhelpful', 'other'));

ALTER TABLE "platform"."ai_invocations"
  ADD CONSTRAINT "ai_invocations_status" CHECK ("status" IN ('completed', 'incomplete', 'failed', 'canceled')),
  ADD CONSTRAINT "ai_invocations_cost" CHECK ("cost_micro_usd" >= 0);

ALTER TABLE "platform"."usage_ledger"
  ADD CONSTRAINT "usage_ledger_non_negative" CHECK
    ("cost_micro_usd" >= 0 AND "input_tokens" >= 0 AND "output_tokens" >= 0 AND "requests" >= 0);

-- ── Row-level security: owner only (docs/security/data-isolation.md) ───────────────────────
-- threads/messages/message_events are NOT FORCEd: the table owner must reach them from the
-- narrow SECURITY DEFINER maintenance functions below (reaper, retention purge). The runtime
-- role never owns tables, so RLS always applies to the request path. The other tables have no
-- definer path except erase_user (which scopes itself with karen.user_id) and are FORCEd.
ALTER TABLE "conversation"."threads" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "threads_owner" ON "conversation"."threads"
  USING ("user_id" = "identity"."current_user_id"())
  WITH CHECK ("user_id" = "identity"."current_user_id"());

ALTER TABLE "conversation"."messages" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "messages_owner" ON "conversation"."messages"
  USING ("user_id" = "identity"."current_user_id"())
  WITH CHECK ("user_id" = "identity"."current_user_id"());

ALTER TABLE "conversation"."message_events" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "message_events_owner" ON "conversation"."message_events"
  USING ("user_id" = "identity"."current_user_id"())
  WITH CHECK ("user_id" = "identity"."current_user_id"());

ALTER TABLE "conversation"."feedback" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "conversation"."feedback" FORCE ROW LEVEL SECURITY;
CREATE POLICY "feedback_owner" ON "conversation"."feedback"
  USING ("user_id" = "identity"."current_user_id"())
  WITH CHECK ("user_id" = "identity"."current_user_id"());

ALTER TABLE "platform"."ai_invocations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform"."ai_invocations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ai_invocations_owner" ON "platform"."ai_invocations"
  USING ("user_id" = "identity"."current_user_id"())
  WITH CHECK ("user_id" = "identity"."current_user_id"());

ALTER TABLE "platform"."usage_ledger" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform"."usage_ledger" FORCE ROW LEVEL SECURITY;
CREATE POLICY "usage_ledger_owner" ON "platform"."usage_ledger"
  USING ("user_id" = "identity"."current_user_id"())
  WITH CHECK ("user_id" = "identity"."current_user_id"());

-- Message rows must belong to the thread owner (defence in depth against a forged thread_id).
CREATE OR REPLACE FUNCTION "conversation"."enforce_message_owner"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "conversation"."threads" t
                 WHERE t."id" = NEW."thread_id" AND t."user_id" = NEW."user_id") THEN
    RAISE EXCEPTION 'message owner does not own thread' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "messages_owner_matches_thread" BEFORE INSERT OR UPDATE OF "thread_id", "user_id"
  ON "conversation"."messages" FOR EACH ROW EXECUTE FUNCTION "conversation"."enforce_message_owner"();

-- ── System maintenance (cross-user; narrow SECURITY DEFINER entry points) ────────────────
-- Generations whose runner stopped renewing its lease (process crash, deploy) are closed as
-- incomplete (some text) or failed (no text), with a terminal error event so a reconnecting
-- client sees the end of the stream. Never re-run: "regenerate" starts a new attempt.
CREATE OR REPLACE FUNCTION "conversation"."reap_stale_generations"(p_now timestamptz)
RETURNS TABLE ("message_id" uuid, "user_id" uuid, "status" text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  m record;
  v_status text;
BEGIN
  FOR m IN
    SELECT x."id", x."user_id", x."content", x."last_event_seq"
      FROM "conversation"."messages" x
     WHERE x."status" IN ('pending', 'accepted', 'streaming')
       AND x."lease_expires_at" IS NOT NULL AND x."lease_expires_at" < p_now
     ORDER BY x."lease_expires_at"
     LIMIT 500
     FOR UPDATE SKIP LOCKED
  LOOP
    v_status := CASE WHEN char_length(m."content") > 0 THEN 'incomplete' ELSE 'failed' END;
    UPDATE "conversation"."messages"
       SET "status" = v_status, "error_code" = 'GENERATION_INTERRUPTED', "error_retryable" = true,
           "last_event_seq" = m."last_event_seq" + 1, "lease_expires_at" = NULL,
           "completed_at" = p_now, "version" = "version" + 1, "updated_at" = p_now
     WHERE "id" = m."id";
    INSERT INTO "conversation"."message_events" ("user_id", "message_id", "seq", "type", "payload")
    VALUES (m."user_id", m."id", m."last_event_seq" + 1, 'error', jsonb_build_object(
      'seq', m."last_event_seq" + 1, 'type', 'error', 'status', v_status,
      'code', 'GENERATION_INTERRUPTED',
      'message', 'The answer was interrupted. You can regenerate it.', 'retryable', true));
    message_id := m."id"; user_id := m."user_id"; status := v_status;
    RETURN NEXT;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION "conversation"."reap_stale_generations"(timestamptz) FROM PUBLIC;

-- Retention: expired ephemeral threads are deleted (cascade: messages, events, feedback);
-- stream events of finished messages are kept only p_event_retention.
CREATE OR REPLACE FUNCTION "conversation"."purge_expired"(p_now timestamptz, p_event_retention interval)
RETURNS TABLE ("threads_deleted" integer, "events_deleted" integer)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  DELETE FROM "conversation"."threads" WHERE "mode" = 'ephemeral' AND "expires_at" < p_now;
  GET DIAGNOSTICS threads_deleted = ROW_COUNT;
  DELETE FROM "conversation"."message_events" e
   USING "conversation"."messages" m
   WHERE e."message_id" = m."id"
     AND m."status" IN ('completed', 'incomplete', 'failed', 'canceled')
     AND m."completed_at" < p_now - p_event_retention;
  GET DIAGNOSTICS events_deleted = ROW_COUNT;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION "conversation"."purge_expired"(timestamptz, interval) FROM PUBLIC;

-- ── Account erasure covers the new tables (ADR-0020 + ADR-0021) ──────────────────────────
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
  -- Phase 02: conversations (cascade: messages, stream events, feedback) and AI usage.
  DELETE FROM "conversation"."threads" WHERE "user_id" = r.user_id;
  DELETE FROM "platform"."ai_invocations" WHERE "user_id" = r.user_id;
  DELETE FROM "platform"."usage_ledger" WHERE "user_id" = r.user_id;
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
