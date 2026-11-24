-- NEW-1 (PHASE_03_SECURITY_RELIABILITY_CHECKLIST.md Part B; register OD-10, scheduled by the
-- owner's Phase 03 execution instruction of 2026-11-24). Reviewed SQL; never auto-applied to
-- production.
--
-- Defect (reproduced locally on a database migrated by a NOSUPERUSER NOBYPASSRLS owner, see
-- apps/api/test/global-setup.nonsuper-owner.ts): `consent.data_rights_requests` is FORCE RLS,
-- so its owner policy also binds the table owner. `consent.lookup_data_rights_request` and the
-- first statement of `identity.erase_user` read it as the (definer) owner BEFORE any
-- `karen.user_id` scope exists -> 0 rows -> every data export and account erasure fails with
-- "Not found" / "no deletion request". Hidden locally and in CI because `karen` is a superuser.
--
-- Fix (option "a-narrow", a refinement of Part B option (a); RLS is NOT weakened for any
-- application role):
--   * one additional SELECT-only policy, TO the migration/owner role only (resolved by
--     CURRENT_USER at migration time; never the runtime role), that admits exactly ONE row: the
--     one whose id equals the transaction-local GUC `karen.data_rights_lookup_id`;
--   * only the two definer functions set that GUC, to the id they were asked for, and clear it
--     immediately after the single-row read; erase_user then sets the user's scope and takes the
--     row lock + every further read/write under the ordinary owner policy.
--   The runtime role is not a member of the owner role, so setting the GUC there grants nothing
--   (tested). The export payload of other rows stays unreadable even to definer code.
-- Also (Part B B5.6, same D11 track): the cross-user conversation maintenance functions no
-- longer take a caller-supplied clock, and the stream-event retention is clamped to >= 1 hour
-- (the CHAT_EVENT_RETENTION_HOURS minimum), so no request-path bug can widen a cross-user delete.
--
-- `identity.erase_user` keeps the M2a body (incl. every memory delete, OD-12) unchanged apart from
-- the owner resolution at its head; an integration test asserts every DELETE is still present.
--
-- Rollback (pre-production): re-run the function definitions of 20261123120000_memory_phase03
-- (erase_user) and 20261120220000_consent_data_rights (lookup), restore the two conversation
-- functions from 20261121100000_conversation_phase02 with their grants, and
--   DROP POLICY "data_rights_requests_definer_lookup" ON "consent"."data_rights_requests";
-- Atomic: Prisma does not wrap migrations in a transaction (scripts/check-migrations.mjs).
BEGIN;

CREATE POLICY "data_rights_requests_definer_lookup" ON "consent"."data_rights_requests"
  AS PERMISSIVE FOR SELECT TO CURRENT_USER
  USING ("id"::text = current_setting('karen.data_rights_lookup_id', true));

CREATE OR REPLACE FUNCTION "consent"."lookup_data_rights_request"(p_id uuid)
RETURNS TABLE ("user_id" uuid, "kind" text, "status" text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF p_id IS NULL THEN RETURN; END IF;
  PERFORM set_config('karen.data_rights_lookup_id', p_id::text, true);
  RETURN QUERY
    SELECT r."user_id", r."kind"::text, r."status"::text
      FROM "consent"."data_rights_requests" r WHERE r."id" = p_id;
  PERFORM set_config('karen.data_rights_lookup_id', '', true);
END;
$$;
REVOKE ALL ON FUNCTION "consent"."lookup_data_rights_request"(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION "identity"."erase_user"(p_request_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  r record;
  v_status text;
  v_uid uuid;
  v_prev_scope text := current_setting('karen.user_id', true);
BEGIN
  -- NEW-1: resolve the owner through the exact-id definer lookup policy, then act ONLY in that
  -- user's scope. The row lock and every check below run under the ordinary owner policy.
  PERFORM set_config('karen.data_rights_lookup_id', p_request_id::text, true);
  SELECT q."user_id" INTO v_uid FROM "consent"."data_rights_requests" q WHERE q."id" = p_request_id;
  PERFORM set_config('karen.data_rights_lookup_id', '', true);
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'erase_user: no deletion request %', p_request_id USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM set_config('karen.user_id', v_uid::text, true);
  SELECT q."id", q."user_id", q."kind", q."status", q."scheduled_for" INTO r
    FROM "consent"."data_rights_requests" q
   WHERE q."id" = p_request_id AND q."user_id" = v_uid FOR UPDATE;
  IF NOT FOUND OR r.kind <> 'deletion' THEN
    PERFORM set_config('karen.user_id', coalesce(v_prev_scope, ''), true);
    RAISE EXCEPTION 'erase_user: no deletion request %', p_request_id USING ERRCODE = 'no_data_found';
  END IF;
  -- Early outcomes restore the caller's scope (the pre-NEW-1 body set no scope on these paths).
  IF r.status = 'completed' THEN PERFORM set_config('karen.user_id', coalesce(v_prev_scope, ''), true); RETURN 'completed'; END IF;
  IF r.status = 'cancelled' THEN PERFORM set_config('karen.user_id', coalesce(v_prev_scope, ''), true); RETURN 'cancelled'; END IF;
  IF r.status <> 'scheduled' THEN
    RAISE EXCEPTION 'erase_user: request % is %', p_request_id, r.status USING ERRCODE = 'check_violation';
  END IF;
  IF r.scheduled_for > now() THEN PERFORM set_config('karen.user_id', coalesce(v_prev_scope, ''), true); RETURN 'not_due'; END IF;

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
  -- Phase 03 (ADR-0036): every memory table, explicitly (users are scrubbed, not deleted).
  DELETE FROM "memory"."access_events" WHERE "user_id" = r.user_id;
  DELETE FROM "memory"."item_revisions" WHERE "user_id" = r.user_id;
  DELETE FROM "memory"."suggestions" WHERE "user_id" = r.user_id;
  DELETE FROM "memory"."items" WHERE "user_id" = r.user_id;
  DELETE FROM "memory"."extraction_jobs" WHERE "user_id" = r.user_id;
  DELETE FROM "memory"."user_settings" WHERE "user_id" = r.user_id;
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

-- ── B5.6: no caller-supplied clock or unbounded retention on cross-user maintenance ─────────
DROP FUNCTION "conversation"."reap_stale_generations"(timestamptz);
DROP FUNCTION "conversation"."purge_expired"(timestamptz, interval);

CREATE FUNCTION "conversation"."reap_stale_generations"()
RETURNS TABLE ("message_id" uuid, "user_id" uuid, "status" text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  m record;
  v_status text;
  v_now timestamptz := now();
BEGIN
  FOR m IN
    SELECT x."id", x."user_id", x."content", x."last_event_seq"
      FROM "conversation"."messages" x
     WHERE x."status" IN ('pending', 'accepted', 'streaming')
       AND x."lease_expires_at" IS NOT NULL AND x."lease_expires_at" < v_now
     ORDER BY x."lease_expires_at"
     LIMIT 500
     FOR UPDATE SKIP LOCKED
  LOOP
    v_status := CASE WHEN char_length(m."content") > 0 THEN 'incomplete' ELSE 'failed' END;
    UPDATE "conversation"."messages"
       SET "status" = v_status, "error_code" = 'GENERATION_INTERRUPTED', "error_retryable" = true,
           "last_event_seq" = m."last_event_seq" + 1, "lease_expires_at" = NULL,
           "completed_at" = v_now, "version" = "version" + 1, "updated_at" = v_now
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
REVOKE ALL ON FUNCTION "conversation"."reap_stale_generations"() FROM PUBLIC;

-- Retention below 1 hour (the env minimum) is clamped up: a caller can shorten nothing further.
CREATE FUNCTION "conversation"."purge_expired"(p_event_retention interval)
RETURNS TABLE ("threads_deleted" integer, "events_deleted" integer)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_retention interval := GREATEST(coalesce(p_event_retention, interval '1 hour'), interval '1 hour');
BEGIN
  DELETE FROM "conversation"."threads" WHERE "mode" = 'ephemeral' AND "expires_at" < now();
  GET DIAGNOSTICS threads_deleted = ROW_COUNT;
  DELETE FROM "conversation"."message_events" e
   USING "conversation"."messages" m
   WHERE e."message_id" = m."id"
     AND m."status" IN ('completed', 'incomplete', 'failed', 'canceled')
     AND m."completed_at" < now() - v_retention;
  GET DIAGNOSTICS events_deleted = ROW_COUNT;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION "conversation"."purge_expired"(interval) FROM PUBLIC;

COMMIT;
