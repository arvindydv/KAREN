# Runbook: personal memory (Phase 03)

Scope: the `memory` module (ADR-0036), the extraction workflow, and the memory maintenance sweep.
Memory is **off** everywhere (`MEMORY_FEATURE_ENABLED=false`); enabling it in any deployed
environment requires written approval APP-4. Nothing here involves reading memory content: logs,
metrics and audit rows are content-free by design — do not add content to diagnose.

## 1. Kill switch

Set `MEMORY_FEATURE_ENABLED=false` and redeploy the API. Effect (tested, `memory-api.int.test.ts`
flag-off matrix): no retrieval, no new extraction jobs, memory write routes 404, conversations ignore
`memory_enabled`; users can still list, export, delete and clear. Queued jobs end `skipped/feature_off`
at their next step; the maintenance sweep stops (it only runs with the flag on). Stored memories are
untouched.

## 2. Alarms (`infra/terraform/modules/monitoring/memory.tf`, enabled with `memory_alarms_enabled`)

> The alarms need the API's OpenTelemetry metrics exported to CloudWatch. That export is **not
> deployed yet**; until it is, `memory_alarms_enabled` must stay `false`.

| Alarm                       | Meaning                                                                                                             | First response                                                                                                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `memory-enqueue-failures`   | A memory write in `finalize()` rolled back to its savepoint, or a workflow start failed. Replies were NOT lost (H3) | `stage=finalize`: check API logs for `err_class` (lock timeouts, FK races). `stage=start`: Temporal reachability; due jobs are re-kicked by the sweep                                 |
| `memory-stale-terminations` | Jobs stayed non-terminal past the DB max age (24 h, `memory.job_max_age()`) and were terminated `abandoned_stale`   | Temporal worker health; activity failure rate; `abandon` path failures. Users see "Couldn't save — try again"                                                                         |
| `memory-retrieval-drops`    | A stored memory failed wire validation at retrieval (should be impossible: write-time policy)                       | Treat as a policy-mismatch bug: compare `MEMORY_POLICY_VERSION` and the charset fixture across API/ai-service versions                                                                |
| `memory-retrieval-latency`  | Retrieval p95 > 150 ms                                                                                              | DB load; plan of the candidate query (`docs/database/memory-maintenance.md`); per-user item counts (cap 500). A GIN index on `search_lexemes` is the documented next step (arch §6.3) |
| `memory-rekick-failures`    | The sweep could not call Temporal start                                                                             | Temporal connectivity; credentials                                                                                                                                                    |

## 3. Stuck or repeated extraction jobs

Jobs are content-free. As an API runtime login (never the migration role):

```sql
-- How many jobs are waiting / stale (counts only).
SELECT count(*) FROM memory.due_extraction_jobs(100);
SELECT memory.terminate_stale_jobs(500);     -- idempotent; never touches terminal rows
```

Re-running a job: the workflow id is `memory-extract:<source_message_id>` (REJECT_DUPLICATE). A
closed execution is never re-run under the same id by design; a job that failed twice surfaces to
the user as "Couldn't save — try again" rather than being retried silently (arch §8.5).

## 4. Manual consent-grant fixes (L-07)

The suspension trigger refuses unscoped status changes of a `MEMORY_STORAGE` grant (no silent 0-row
suspension). An operator fix must set the user scope in the same transaction:

```sql
BEGIN;
SELECT set_config('karen.user_id', '<user uuid>', true);
UPDATE consent.consent_grants SET status = 'REVOKED', revoked_at = now()
 WHERE user_id = '<user uuid>' AND purpose = 'MEMORY_STORAGE';
COMMIT;
```

Prefer the product path (`PUT /v1/me/consents/MEMORY_STORAGE`) which also writes the receipt.

## 5. Maintenance sweep

Runs in-process every `MEMORY_MAINTENANCE_INTERVAL_SECONDS` behind a Redis lock: re-kick, stale
termination, purge. A manual purge pass (as an API runtime login):

```sql
SELECT * FROM memory.purge_expired(NULL, 100);   -- repeat with the returned next_cursor until NULL
```

No parameter can shorten the grace floor or retention (H5; constants changed only by migration).

## 6. Account erasure and data export (NEW-1, ADR-0037)

If erasure or export fails with "no deletion request" / 404 on a non-superuser-owned database, the
`20261124100000_new1_definer_lookups` migration is missing: run `prisma migrate deploy` then
`roles.sql` (runbook `database-migrations.md` steps 8–9) and re-run the workflow step (the data-rights
workflows retry). Verify with `infra/database/verify/rds-verification.sql` (R-30…R-33).

## 7. Backup / point-in-time restore — re-applying deletions (OD-13) — DRAFT, NOT APPROVED

A restore brings back memories, suspended memories, revoked-consent states and erased accounts
deleted after the backup point. **No approach is approved yet (OD-13 open).** Engineering proposal
for the owner's decision (`docs/phase-03/PHASE_03_PENDING_DECISIONS.md`):

1. Keep restored databases isolated (no API traffic) until step 3 completes.
2. From the append-only `audit.audit_events` in the **live** (pre-restore) database or its log
   archive, list content-free deletion events after the backup point: `memory.item.deleted`,
   `memory.cleared`, `memory.suggestion.dismissed`, `memory.suspended`, `consent.decision` (revokes),
   `privacy.deletion.completed`, `conversation.deleted`.
3. Re-apply them in timestamp order in each user's scope (erasure: `identity.erase_user` for each
   completed deletion request; revokes: the scoped grant update in §4, which re-suspends memories;
   clears/deletes: the same `DELETE … WHERE user_id = … AND id = …`).
4. Only then reconnect the API. Record the drill (T-AWS-06).

Gaps that block approval: item-level deletes are audited with the item id only if the audit event
carries `subjectId` (it does for `memory.item.deleted`; `memory.cleared` records scope and counts,
not ids — a scope re-application is needed for it); audit retention must exceed the backup window.

## 8. Never

- Never enable memory in a deployed environment without APP-4.
- Never set `KAREN_FEATURE_MEMORY_EXTRACTION_LIVE=true` (it refuses startup; live extraction needs APP-1).
- Never "fix" a user's memory by editing `value_text` directly; use the API (revisions, audit).
- Never copy memory text into tickets, logs or chats.
