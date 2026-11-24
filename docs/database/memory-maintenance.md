# Memory maintenance functions (Phase 03 / M2b)

Migration `apps/api/prisma/migrations/20261124110000_memory_maintenance`. Design: ADR-0036,
`docs/phase-03/PHASE_03_MEMORY_ARCHITECTURE.md` §5.3, §8.5, §11; owner decision OD-01 (2026-11-23:
per-user-scoped `SECURITY DEFINER` functions, **no new role**). Tests:
`apps/api/test/memory-maintenance.int.test.ts` (runs under the superuser owner **and** under a
non-superuser owner, `integration-nonsuper-owner`).

## Contracts

All four are `SECURITY DEFINER`, owned by the migration role, `search_path = pg_catalog, pg_temp`,
`REVOKE ALL FROM PUBLIC`, `EXECUTE` to `karen_api_runtime` only (`infra/database/roles.sql`).
None takes a time, interval or grace argument: `now()` is the database clock and durations are
the M2a constants (defined once): `memory.suspension_grace()` = 30 days, `memory.job_max_age()`
= 24 hours, `memory.job_retention()` = 30 days — **provisional** (D12; legal review LEG-2/LEG-4),
changed only by a reviewed migration.

| Function                                          | Returns                                                                                                                                                                  | Does                                                                                                                                                                                                                                                                                                                    | Bounds                   |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `memory.lookup_extraction_job(p_id uuid)`         | `(user_id, status)`, 0 or 1 row                                                                                                                                          | Exact-id resolve for the worker-initiated run/abandon steps (M5b)                                                                                                                                                                                                                                                       | one row                  |
| `memory.due_extraction_jobs(p_limit int)`         | `(job_id)`                                                                                                                                                               | `pending` jobs with `next_attempt_at <= now()` and younger than the max age (re-kick, §8.5)                                                                                                                                                                                                                             | clamped 1…100            |
| `memory.terminate_stale_jobs(p_limit int)`        | `integer` (rows terminated by this call)                                                                                                                                 | Non-terminal jobs older than the max age → `failed` / `abandoned_stale`, `completed_at = now()`, `expires_at = now() + job_retention()`, `version + 1`. The `UPDATE` re-checks status and age, so concurrent sweeps or a concurrent run step can never double-terminate                                                 | clamped 1…500 jobs       |
| `memory.purge_expired(p_after uuid, p_batch int)` | `(next_cursor, users_visited, users_skipped_locked, items_expired, items_suspended_purged, revisions_deleted, suggestions_deleted, access_events_deleted, jobs_deleted)` | For up to `p_batch` users with `id > p_after` (NULL = start), per user in that user's scope: items with `expires_at <= now()`; suspended items with `suspended_at < now() − grace`; expired revisions, suggestions, access events; terminal jobs past `expires_at`. Never a pending/running job, never an unexpired row | clamped 1…500 users/call |

`next_cursor` is NULL when the user list is exhausted; the caller loops until NULL.

## Isolation model

- Every memory table is FORCEd. The owner reaches a user's content only after
  `set_config('karen.user_id', <user>, true)`; each function **restores the caller's scope**
  before returning (tested for unscoped and scoped callers).
- The **only** non-owner policy on any memory table is `extraction_jobs_owner_lookup`:
  `FOR SELECT TO <migration role>` on the content-free job table, so the job functions can map an
  id to its user. It grants no write and is never visible to the runtime role (tested).
- Users are enumerated from `identity.users`, which is ENABLE-only. **Dependency:** if
  `identity.users` is ever FORCEd, `purge_expired` must change in the same migration.
- Threat model (arch §5.3 item 5): parameters bound only how much one call does or which users it
  visits; none can widen what is deleted (§13.2 item 19 test passes extreme arguments). A fully
  compromised runtime role can already scope itself to any user — unchanged by these functions.

## Concurrency and failure handling

- **Lock order (H3):** each user's `identity.users` row is locked `FOR KEY SHARE SKIP LOCKED` before
  that user's memory rows. `ConsentService.decide()` holds `FOR UPDATE` on that row while its
  suspension trigger runs, so a sweep never interleaves with a revoke; a busy user is **skipped**
  (`users_skipped_locked`) and handled by the next sweep — the sweep never waits or deadlocks.
- One call is one transaction. A failure rolls the batch back completely; the next sweep retries.
  All operations are idempotent (deleting already-deleted rows is a no-op; terminating a terminal
  job matches nothing).
- Correctness never depends on the purge having run: every read path excludes expired rows in SQL
  (`expires_at > now()`), and suspended rows are never retrieved.

## Operational usage

- Caller: `MemoryMaintenanceService` (M5b) on an interval behind a Redis `SET NX` lock, as the
  runtime role: `due_extraction_jobs(100)` → re-kick; `terminate_stale_jobs(500)`; then
  `purge_expired(cursor, batch)` until `next_cursor IS NULL`. Counts feed `karen_memory_*` metrics
  (no user identifiers as labels).
- Manual run (operator, non-production, as an API runtime login):
  `SELECT * FROM memory.purge_expired(NULL, 100);` and repeat with the returned cursor.
- Cost: `purge_expired` visits every user once per full sweep (keyset on `users_pkey`), with
  per-user indexed deletes (per-user active items are capped at 500). At large user counts, raise
  the interval rather than the batch; a "users with expirable rows" index is a future optimisation
  that would need its own owner-readable, content-free structure.

## Query plans (local docker PostgreSQL 17, `enable_seqscan = off` to show index choice) [V-local]

- `due_extraction_jobs` / `terminate_stale_jobs`: bitmap scan on `extraction_jobs_stale_idx`
  (partial on `status IN ('pending','running')`); the constant functions are inlined.
- User enumeration: index-only scan on `users_pkey`.
- Per-user deletes: index on `(user_id, …)` (`items_user_id_source_thread_id_idx` /
  `items_user_id_status_kind_updated_at_idx`).
- RDS plans under realistic volume: **NOT VERIFIED** (`docs/phase-03/PHASE_03_RDS_VERIFICATION.md`).

## Rollback

Pre-production only: see the migration header (drop the four functions and the lookup policy).
