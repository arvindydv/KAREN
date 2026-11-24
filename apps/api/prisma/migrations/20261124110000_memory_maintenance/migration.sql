-- Phase 03 / M2b — cross-user memory maintenance (ADR-0036; arch §5.3, §8.5, §11; OD-01 decided
-- 2026-11-23: per-user-scoped SECURITY DEFINER functions, no new role). Reviewed SQL; never
-- auto-applied to production. Contract: docs/database/memory-maintenance.md.
--
-- Rules (SR-MNT-01…05):
--   * every function is SECURITY DEFINER, owned by the migration role, fixed search_path,
--     REVOKE ALL FROM PUBLIC, EXECUTE to karen_api_runtime only (infra/database/roles.sql);
--   * NO function takes a time, interval or grace parameter (H5): `now()` is the database clock and
--     the durations are the M2a constants memory.suspension_grace() / job_max_age() /
--     job_retention() — defined once (03C-05). Parameters only bound HOW MUCH one call does
--     (clamped) or WHICH users are visited (keyset cursor); none can widen WHAT is deleted;
--   * all memory tables are FORCEd, so the owner acts only through per-user scoping
--     (set_config('karen.user_id', <user>, true)) and restores the caller's scope before
--     returning; the ONLY non-owner policy is the read-only lookup on the content-free job table;
--   * lock order (H3, §5.4): the user's identity.users row is locked (FOR KEY SHARE, which
--     conflicts with ConsentService.decide()'s FOR UPDATE) before that user's memory rows. Users
--     whose row is locked right now are SKIPPED (SKIP LOCKED) and handled by the next sweep, so a
--     sweep never waits on, or deadlocks with, a consent decision;
--   * enumerating users reads identity.users, which is ENABLE-only (not FORCEd). If the D11
--     hardening track ever FORCEs identity.users, these functions must change in the same
--     migration (docs/security/data-isolation.md).
--
-- Rollback (pre-production): DROP FUNCTION memory.purge_expired(uuid, integer),
--   memory.terminate_stale_jobs(integer), memory.due_extraction_jobs(integer),
--   memory.lookup_extraction_job(uuid);
--   DROP POLICY "extraction_jobs_owner_lookup" ON memory.extraction_jobs;
-- Atomic: Prisma does not wrap migrations in a transaction (scripts/check-migrations.mjs).
BEGIN;

-- The only non-owner policy on any memory table: read-only, content-free table, bound to the
-- migration/owner role (resolved by CURRENT_USER at migration time; never the runtime role).
CREATE POLICY "extraction_jobs_owner_lookup" ON "memory"."extraction_jobs"
  AS PERMISSIVE FOR SELECT TO CURRENT_USER USING (true);

-- Resolve a job id to its user and status (the worker only knows the id). Exact match only.
CREATE FUNCTION "memory"."lookup_extraction_job"(p_id uuid)
RETURNS TABLE ("user_id" uuid, "status" text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT j."user_id", j."status"::text FROM "memory"."extraction_jobs" j WHERE j."id" = p_id
$$;

-- Pending jobs whose workflow may never have started (re-kick, §8.5). Ids only; ≤ 100.
CREATE FUNCTION "memory"."due_extraction_jobs"(p_limit integer)
RETURNS TABLE ("job_id" uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT j."id" FROM "memory"."extraction_jobs" j
   WHERE j."status" = 'pending'
     AND j."next_attempt_at" <= now()
     AND j."created_at" > now() - "memory"."job_max_age"()
   ORDER BY j."next_attempt_at", j."id"
   LIMIT LEAST(GREATEST(coalesce(p_limit, 100), 1), 100)
$$;

-- H7: non-terminal jobs older than the DB-held max age become failed/abandoned_stale. Never touches
-- a terminal row (the UPDATE re-checks the status under the row lock, so concurrent sweeps and a
-- concurrent run step cannot double-terminate). Returns how many rows this call terminated.
CREATE FUNCTION "memory"."terminate_stale_jobs"(p_limit integer)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_prev text := current_setting('karen.user_id', true);
  v_limit integer := LEAST(GREATEST(coalesce(p_limit, 500), 1), 500);
  v_total integer := 0;
  v_n integer;
  j record;
BEGIN
  FOR j IN
    SELECT x."id", x."user_id" FROM "memory"."extraction_jobs" x
     WHERE x."status" IN ('pending', 'running') AND x."created_at" < now() - "memory"."job_max_age"()
     ORDER BY x."created_at", x."id"
     LIMIT v_limit
  LOOP
    PERFORM 1 FROM "identity"."users" u WHERE u."id" = j."user_id" FOR KEY SHARE SKIP LOCKED;
    CONTINUE WHEN NOT FOUND;
    PERFORM set_config('karen.user_id', j."user_id"::text, true);
    UPDATE "memory"."extraction_jobs"
       SET "status" = 'failed', "outcome_code" = 'abandoned_stale', "completed_at" = now(),
           "expires_at" = now() + "memory"."job_retention"(), "version" = "version" + 1
     WHERE "id" = j."id" AND "user_id" = j."user_id" AND "status" IN ('pending', 'running')
       AND "created_at" < now() - "memory"."job_max_age"();
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_total := v_total + v_n;
  END LOOP;
  PERFORM set_config('karen.user_id', coalesce(v_prev, ''), true);
  RETURN v_total;
END;
$$;

-- Retention purge (§11) for up to p_batch users with id > p_after (NULL = start), in id order.
-- Per user, in that user's scope: expired items (active or suspended), suspended items past the
-- grace floor, expired revisions / suggestions / access events, terminal jobs past expires_at.
-- Rows are excluded at read time anyway (`expires_at > now()`), so correctness never depends on
-- the purge having run. `next_cursor` is NULL when the user list is exhausted.
CREATE FUNCTION "memory"."purge_expired"(p_after uuid, p_batch integer)
RETURNS TABLE ("next_cursor" uuid, "users_visited" integer, "users_skipped_locked" integer,
               "items_expired" integer, "items_suspended_purged" integer,
               "revisions_deleted" integer, "suggestions_deleted" integer,
               "access_events_deleted" integer, "jobs_deleted" integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_prev text := current_setting('karen.user_id', true);
  v_batch integer := LEAST(GREATEST(coalesce(p_batch, 100), 1), 500);
  v_last uuid;
  v_n integer;
  u record;
BEGIN
  users_visited := 0; users_skipped_locked := 0; items_expired := 0; items_suspended_purged := 0;
  revisions_deleted := 0; suggestions_deleted := 0; access_events_deleted := 0; jobs_deleted := 0;
  FOR u IN
    SELECT x."id" FROM "identity"."users" x
     WHERE p_after IS NULL OR x."id" > p_after
     ORDER BY x."id"
     LIMIT v_batch
  LOOP
    v_last := u."id";
    users_visited := users_visited + 1;
    PERFORM 1 FROM "identity"."users" l WHERE l."id" = u."id" FOR KEY SHARE SKIP LOCKED;
    IF NOT FOUND THEN
      users_skipped_locked := users_skipped_locked + 1;
      CONTINUE;
    END IF;
    PERFORM set_config('karen.user_id', u."id"::text, true);

    DELETE FROM "memory"."items"
     WHERE "user_id" = u."id" AND "expires_at" IS NOT NULL AND "expires_at" <= now();
    GET DIAGNOSTICS v_n = ROW_COUNT; items_expired := items_expired + v_n;
    DELETE FROM "memory"."items"
     WHERE "user_id" = u."id" AND "status" = 'suspended'
       AND "suspended_at" < now() - "memory"."suspension_grace"();
    GET DIAGNOSTICS v_n = ROW_COUNT; items_suspended_purged := items_suspended_purged + v_n;
    DELETE FROM "memory"."item_revisions" WHERE "user_id" = u."id" AND "expires_at" <= now();
    GET DIAGNOSTICS v_n = ROW_COUNT; revisions_deleted := revisions_deleted + v_n;
    DELETE FROM "memory"."suggestions" WHERE "user_id" = u."id" AND "expires_at" <= now();
    GET DIAGNOSTICS v_n = ROW_COUNT; suggestions_deleted := suggestions_deleted + v_n;
    DELETE FROM "memory"."access_events" WHERE "user_id" = u."id" AND "expires_at" <= now();
    GET DIAGNOSTICS v_n = ROW_COUNT; access_events_deleted := access_events_deleted + v_n;
    DELETE FROM "memory"."extraction_jobs"
     WHERE "user_id" = u."id" AND "status" NOT IN ('pending', 'running')
       AND "expires_at" IS NOT NULL AND "expires_at" <= now();
    GET DIAGNOSTICS v_n = ROW_COUNT; jobs_deleted := jobs_deleted + v_n;
  END LOOP;
  PERFORM set_config('karen.user_id', coalesce(v_prev, ''), true);
  next_cursor := CASE WHEN users_visited = v_batch THEN v_last ELSE NULL END;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION "memory"."lookup_extraction_job"(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION "memory"."due_extraction_jobs"(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "memory"."terminate_stale_jobs"(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "memory"."purge_expired"(uuid, integer) FROM PUBLIC;

COMMIT;
