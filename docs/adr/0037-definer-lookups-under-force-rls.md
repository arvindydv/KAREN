# 0037 — SECURITY DEFINER lookups under FORCE RLS (NEW-1 fix)

- Status: **Proposed** (engineering, 2026-11-24). Needs owner acceptance; the implementing PR
  must not merge before it.
- Scheduling: owner instruction of 2026-11-24 ("Phase 03 complete execution mission", §4 NEW-1)
  — fix and verify NEW-1 now (register OD-10).
- Related: ADR-0020 (data-rights workflows), ADR-0036 (memory; OD-12 sequencing),
  `docs/phase-03/PHASE_03_SECURITY_RELIABILITY_CHECKLIST.md` Part B, `docs/security/data-isolation.md`.
- Migration: `apps/api/prisma/migrations/20261124100000_new1_definer_lookups/migration.sql`.

## Context

`consent.data_rights_requests` is ENABLE + FORCE RLS with an owner policy
(`user_id = identity.current_user_id()`). With FORCE, the policy also binds the **table owner**.
Two `SECURITY DEFINER` functions owned by the migration role read that table before any
`karen.user_id` scope exists:

- `consent.lookup_data_rights_request(id)` — the worker-initiated export/erasure steps only know
  the request id;
- `identity.erase_user(request_id)` — its first statement.

Locally and in CI the migration role `karen` is a **superuser**, which bypasses RLS even with FORCE,
so every test passed. On AWS the migration role is a dedicated non-superuser.

**Reproduced 2026-11-24 [V-local, non-superuser owner]:** a database migrated by a `NOSUPERUSER
NOBYPASSRLS` role (`apps/api/test/global-setup.nonsuper-owner.ts`) returns 0 rows from the unscoped
lookup (1 row when scoped) and `erase_user` raises `no deletion request`. Running the whole API
integration suite there failed exactly the 8 data-export/erasure tests (198 others passed). On
RDS: **NOT VERIFIED** (no AWS access in this task).

The catalog lists ten definer functions; only these two read a FORCEd table before scoping (the
others read ENABLE-only `identity.*`/`conversation.*` tables). This inventory is now enforced by a
test against `pg_proc`, not grep.

## Decision

1. Add **one** permissive, `FOR SELECT`, `TO CURRENT_USER` (= the migration/owner role, resolved at
   migration time) policy on `consent.data_rights_requests` that admits exactly the row whose id
   equals the **transaction-local** GUC `karen.data_rights_lookup_id`.
2. Only the two definer functions set that GUC — to the id they were called with — and clear it
   immediately after the single-row read. `erase_user` then sets the user's scope and takes the row
   lock and performs every further read/write under the ordinary owner policy (same lock order as
   before: request row, then user row). Early outcomes restore the caller's scope.
3. The runtime role is not the owner role, so the policy never applies to it, whatever GUC it sets
   (tested). Other rows — and their `export_payload` — stay unreadable even to definer code.
4. Same track (Part B B5.6): `conversation.reap_stale_generations` and `conversation.purge_expired`
   no longer accept a caller clock; the stream-event retention is clamped to ≥ 1 hour in SQL.
5. Verification is permanent: the API integration suite runs twice in `pnpm test:integration` (so in
   CI on every PR) — once as today, once against a non-superuser-owned database
   (`integration-nonsuper-owner` project). A guard test asserts which owner model each run uses.

## Options considered

| Option                                                         | Why not chosen                                                                                      |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| (a) `FOR SELECT TO CURRENT_USER USING (true)`                  | Lets every current and future definer function read every export payload unscoped                   |
| (b) Split a content-free lookup table                          | Correct, but a new table + dual writes for two reads; the chosen policy gives the same isolation    |
| (c) Drop FORCE on `data_rights_requests`                       | Widens owner access to all payloads; contradicts D11                                                |
| (d) Pass the user id from the API into a scoped call           | The worker → API contract only carries the request id; the API would still need an unscoped resolve |
| **(e) exact-id, GUC-gated, owner-only lookup policy** (chosen) | One policy, no schema change, no wider read than the single requested row                           |

## Consequences

- Data export and account erasure work under a non-superuser owner (locally proven; RDS NOT
  VERIFIED — `docs/phase-03/PHASE_03_RDS_VERIFICATION.md`).
- `erase_user` keeps the M2a body (every memory delete, OD-12); a test compares the live
  definition with the M2a migration.
- Residual: a human connected **as the migration role** could set the GUC and read one row by id.
  That role owns the table and can already `ALTER TABLE … NO FORCE ROW LEVEL SECURITY`; the policy
  grants it nothing it does not already have. The migration role must not be used interactively.
- CI integration time roughly doubles (~1 min locally per run).
