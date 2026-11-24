# KAREN — Phase 03 — Security and reliability readiness checklist

- **Date:** 2026-11-23 (Task 03C) · **Baseline:** `main` @ `e5ff562`
- **Purpose:** one checklist that every Phase 03 PR, the Gate 03 review and the production
  readiness review use. Each item names the control, where it is designed (arch §), the milestone
  that implements it, the test that proves it (`PHASE_03_TEST_STRATEGY.md`), and its state.
- **State today:** every Part A item is **DESIGNED, NOT IMPLEMENTED** unless marked otherwise. No
  item is ticked, because no Phase 03 code exists. A tick requires a merged PR **and** a passing
  test or recorded evidence.
- **Part B** tracks **NEW-1** separately. It is a pre-existing defect outside Phase 03.
  **Update 2026-11-24:** reproduced and fixed locally (ADR-0037, Proposed; branch
  `phase-03/new1-force-rls-definer-lookups`); RDS verification **NOT VERIFIED** (no RDS instance).
  See B7.

Evidence labels: **[V]** verified in repository code/config · **[V-gh]** GitHub API · **[PG]**
documented PostgreSQL/Temporal behaviour · **[NV]** not verified · **[P]** proposed.

Columns: **Where** = arch section · **M** = implementing milestone · **Proof** = test IDs ·
**Env** = where it can be proven (L = local/CI, AWS = needs AWS/RDS).

---

## Part A — Phase 03 controls

### A1. Authentication and authorization boundaries

| ID         | Control                                                                                                                               | Where       | M   | Proof              | Env | State                                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------- | --- | ------------------ | --- | ----------------------------------------------------------------------------------------------------------------- |
| SR-AUTH-01 | Every `/v1/memory*` route authenticated; user id from `@CurrentPrincipal()`, never from body/query                                    | §2.2 T1     | M3  | T-API-01, T-RLS-07 | L   | [x] L — M3 `memory-api.int.test.ts` (both owner models)                                                           |
| SR-AUTH-02 | Consent enforced only where D5 requires (writes); list/get/export/delete/clear/status never require consent                           | §3.1, §3.7  | M3  | T-API-02           | L   | [x] L — M3 `memory-api.int.test.ts` (both owner models)                                                           |
| SR-AUTH-03 | Internal memory routes: `InternalAuthGuard` (HMAC, ±300 s, Redis nonce, fail closed) **[V]**, `@Public()` + `@ApiExcludeController()` | §8.3        | M5b | T-RACE-14, T-WF-05 | L   | [x] L — M5b `memory-extraction.int.test.ts` (both owner models) T-RACE-14 (replay 401, unsigned 401, unknown 404) |
| SR-AUTH-04 | Internal steps re-derive the user from the job row; worker input is the job id only                                                   | §8.4        | M5b | T-WF-01            | L   | [x] L — M5b `memory-extraction.int.test.ts` (both owner models); worker input `{jobId}` only (worker T-WF-06)     |
| SR-AUTH-05 | Write routes return 404 when the feature flag is off; read/delete/export keep working                                                 | §3.7        | M3  | T-API-08           | L   | [x] L — M3 `memory-api.int.test.ts` (both owner models)                                                           |
| SR-AUTH-06 | `@AllowDeletionPending()` on list/delete/clear/export so users in the deletion window can remove data                                 | §3.7        | M3  | T-API-09           | L   | [x] L — M3 `memory-api.int.test.ts` (both owner models)                                                           |
| SR-AUTH-07 | Residual: `INTERNAL_SERVICE_HMAC_SECRET` shared by api, ai-service, voice-agent **[V]** (ADR-0007). Endpoints re-check everything     | §8.3 (L-06) | —   | T-RACE-14          | —   | Accepted residual, listed for owner                                                                               |

### A2. Tenant/user isolation and FORCE RLS

| ID        | Control                                                                                                                      | Where       | M        | Proof              | Env | State                                                                                                    |
| --------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------- | -------- | ------------------ | --- | -------------------------------------------------------------------------------------------------------- |
| SR-ISO-01 | Explicit `user_id = principal` in every memory query (RLS is the second layer)                                               | §5.4        | M3–M5b   | review + T-RLS-07  | L   | [~] M3: every memory query filters `user_id` (repository + Prisma `where`); retrieval/extraction pending |
| SR-ISO-02 | Composite `(id, user_id)` FKs to `memory.items`; owner trigger on every reference into `conversation.*`                      | §4.3, §4.4  | M2a      | T-RLS-02           | L   | [ ]                                                                                                      |
| SR-ISO-03 | DB trigger: every source message is a **user-role** message of the same user                                                 | §4.3, §7.1  | M2a      | T-RLS-08           | L   | [ ]                                                                                                      |
| SR-ISO-04 | Ephemeral threads cannot enable memory (CHECK)                                                                               | §3.4        | M2a      | T-RLS-06           | L   | [ ]                                                                                                      |
| SR-ISO-05 | Owner filter in the same SQL statement as `@@`; no shared index query                                                        | §6.2, §6.4  | M4b      | T-RET-02           | L   | [x] L — M4b `selectRetrievalCandidates` (owner filter in every branch) + T-RET-02                        |
| SR-ISO-06 | Adversarial wrong-user recall = 0 (near-identical memories across users)                                                     | §13.3       | M4b, M7  | T-RET-02           | L   | [x] L — M4b eval: wrong-user items sent = 0 over 900 sealed test queries (incl. 150 adversarial)         |
| SR-RLS-01 | ENABLE + FORCE on all six `memory.*` tables; owner policy `USING`/`WITH CHECK`                                               | §5.1        | M2a      | T-RLS-01, T-RLS-03 | L   | [ ]                                                                                                      |
| SR-RLS-02 | FORCE proven as a **non-superuser, non-BYPASSRLS** owner; guard test fails the suite if `rolsuper` or `rolbypassrls` is true | §5.5        | M2a      | T-RLS-05, T-RLS-00 | L   | [ ]                                                                                                      |
| SR-RLS-03 | No non-owner policy on content tables; only the read-only `TO CURRENT_USER` lookup policy on `extraction_jobs`               | §5.3        | M2b      | T-MNT-03           | L   | [x] L — M2b `memory-maintenance.int.test.ts`, both owner models                                          |
| SR-RLS-04 | FK `SET NULL`/`CASCADE` actions work under FORCE                                                                             | §5.5 item 5 | M2a      | T-RLS-05           | L   | [ ]                                                                                                      |
| SR-RLS-05 | Same behaviour on RDS with the dedicated (non-superuser) migration role                                                      | §5.3        | pre-PROD | T-AWS-01           | AWS | [ ] **[NV]**                                                                                             |

### A3. Transaction consistency and locking

| ID        | Control                                                                                                                              | Where             | M        | Proof               | Env | State                                                                                                           |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------- | -------- | ------------------- | --- | --------------------------------------------------------------------------------------------------------------- |
| SR-TXN-01 | Lock-order invariant: `identity.users` row locked before any `memory.*` row (`FOR SHARE` in writes; `FOR KEY SHARE` in `finalize()`) | §2.3 item 5, §5.4 | M3–M5b   | T-RACE-11           | L   | [~] M3 write paths lock `identity.users` FOR SHARE first (create-vs-revoke race test); finalize part is M4b/M5b |
| SR-TXN-02 | All memory writes in `finalize()` behind one savepoint; memory failure never fails a completed reply                                 | §2.3, §9.4        | M4b, M5b | T-RACE-12, T-TXN-02 | L   | [x] L — M4b `MemoryTurnService` savepoint; T-RACE-12, writeInTx rollback test                                   |
| SR-TXN-03 | Savepoint inside a Prisma interactive transaction proven before it is relied on (03C-01)                                             | §9.4              | M4b      | T-TXN-01            | L   | [x] L — M4b T-TXN-01 (savepoint inside a Prisma interactive transaction proven)                                 |
| SR-TXN-04 | No catch-and-map of unique violations; `INSERT … ON CONFLICT DO NOTHING`; single-slot rows `FOR UPDATE`                              | §4.6, §8.4        | M3, M5b  | T-API-05, T-RACE-07 | L   | [x] L — M3 `memory-api.int.test.ts` (both owner models)                                                         |
| SR-TXN-05 | `finalize()` performs no `memory.items` update; `last_used_at` post-commit, no `version`/`updated_at` bump                           | §9.4              | M4b      | T-RET-07            | L   | [x] L — M4b: finalize never updates items; post-commit last_used_at without version bump (T-RET-01)             |

### A4. Consent race conditions

| ID        | Control                                                                                                                           | Where      | M       | Proof                           | Env | State                                                                                                                                      |
| --------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------- | ------------------------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| SR-CON-01 | Suspension trigger fires in the revoke transaction, for explicit revokes and the `AI_PROCESSING` cascade, through the upsert path | §3.2       | M2a     | T-CON-01, T-CON-02              | L   | [ ]                                                                                                                                        |
| SR-CON-02 | Trigger refuses unscoped changes (no silent 0-row suspension)                                                                     | §3.2       | M2a     | T-CON-03                        | L   | [ ]                                                                                                                                        |
| SR-CON-03 | Re-grant never restores; restore is explicit and consent-gated                                                                    | §3.3       | M2a, M3 | T-RACE-08, T-API-06             | L   | [x] L — M3 `memory-api.int.test.ts` (both owner models)                                                                                    |
| SR-CON-04 | Run step re-checks consent in TX-A, immediately before the AI call, and in TX-B under the user lock                               | §8.4       | M5b     | T-RACE-01, T-RACE-03, T-RACE-18 | L   | [x] L — M5b `memory-extraction.int.test.ts` (both owner models) T-RACE-01 (in-flight revoke), T-RACE-18 (pre-call re-check, zero AI calls) |
| SR-CON-05 | Generation runner re-checks `AI_PROCESSING` in `load()` (S2)                                                                      | §2.3, §9.1 | M4a     | T-STR-01                        | L   | [x] L — M4a `consent-recheck.int.test.ts` (T-STR-01 + mid-reply stop)                                                                      |
| SR-CON-06 | Streaming answer after revoke finishes with context loaded before the revoke (definition pending OD-03)                           | §3.2.1     | M4b     | T-STR-02, T-STR-03              | L   | [ ] (owner acknowledgement OD-03)                                                                                                          |
| SR-CON-07 | Grants count only if `policy_version` is eligible (re-confirmation, D5)                                                           | §3.1       | M3      | T-API-03                        | L   | [ ] (notice text Q5 legal)                                                                                                                 |

### A5. Deletion guarantees, export and account erasure

| ID        | Control                                                                                                                                              | Where      | M           | Proof                | Env     | State                                                                                                                |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------- | -------------------- | ------- | -------------------------------------------------------------------------------------------------------------------- |
| SR-DEL-01 | Deletion is synchronous SQL with FK cascades; never depends on Temporal                                                                              | §8.6       | M3          | T-API-04, T-DR-02    | L       | [x] L — M3 `memory-api.int.test.ts` (both owner models)                                                              |
| SR-DEL-02 | No resurrection by delayed jobs: run step re-reads job/message/thread/consent under the user lock; `clear` cancels in-scope jobs                     | §8.4, §8.6 | M3, M5b     | T-RACE-04…06, 09, 10 | L       | [x] L — M5b `memory-extraction.int.test.ts` (both owner models) T-RACE-04/05/06/09/10                                |
| SR-DEL-03 | Atomic `delete_memories=true` on thread delete                                                                                                       | §3.6       | M3          | T-RACE-16            | L       | [x] L — M3 `memory-api.int.test.ts` (both owner models)                                                              |
| SR-DEL-04 | Deletion reflected in the next response (different-thread definition, OD-04)                                                                         | §13.3      | M4b, M7     | T-RET-04             | L       | [x] L — M4b T-RET-04 (edit + delete reflected in next turn, thread B and new thread C; stub request + access events) |
| SR-DEL-05 | Undo guards: supersession undo needs consent + version; new-item undo is a deletion                                                                  | §3.6       | M3          | T-RACE-17            | L       | [x] L — M3 `memory-api.int.test.ts` (both owner models)                                                              |
| SR-EXP-01 | Export contains every memory row with provenance and revisions; no consent required                                                                  | §10.2      | M3          | T-DR-01              | L       | [x] L — M3 `memory-api.int.test.ts` (both owner models)                                                              |
| SR-EXP-02 | Stored exports keep deleted memory text until export expiry (`DATA_EXPORT_TTL_HOURS`, 168 h **[V]**) or erasure — disclosed or invalidated per OD-06 | §10.3      | M3          | T-DR-04              | L       | [ ] (OD-06)                                                                                                          |
| SR-EXP-03 | Erasure: new `erase_user` version deletes every memory table explicitly; other users untouched; existing body unchanged (OD-12)                      | §10.1      | M2a         | T-DR-03              | L       | [ ]                                                                                                                  |
| SR-EXP-04 | Erasure and export work when the definer owner is **not** a superuser — **blocked by NEW-1** (Part B)                                                | §5.3       | NEW-1 track | T-AWS-02, T-NEW1-*   | L + AWS | [x] L (NEW-1 fix, T-NEW1-01…04; whole suite under a non-superuser owner) · [ ] AWS **[NV]**                          |

### A6. Temporal retries and idempotency

| ID       | Control                                                                                                                  | Where      | M   | Proof            | Env | State                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------------------------ | ---------- | --- | ---------------- | --- | -------------------------------------------------------------------------------------- |
| SR-WF-01 | Deterministic workflow id `memory-extract:<source_message_id>`, `REJECT_DUPLICATE` **[V]**                               | §8.2       | M5b | T-WF-04          | L   | [x] L — worker T-WF-05 + API deterministic id (`memory-extract:<source>`)              |
| SR-WF-02 | Job row `UNIQUE(source_message_id)`, `ON CONFLICT DO NOTHING`                                                            | §8.2       | M5b | T-WF-04          | L   | [x] L — M5b `memory-extraction.int.test.ts` (both owner models) (regenerate → one job) |
| SR-WF-03 | CAS on `job.version`: duplicate execution writes once                                                                    | §8.4, §8.5 | M5b | T-RACE-07        | L   | [x] L — M5b `memory-extraction.int.test.ts` (both owner models) T-RACE-07              |
| SR-WF-04 | Retry policy (5 attempts, non-retryable `InternalCallRejected`/`ConfigError`); abandon marks `failed` idempotently       | §8.3       | M5b | T-WF-02, T-WF-03 | L   | [x] L — worker T-WF-02/03/04 + API abandon test                                        |
| SR-WF-05 | Stale jobs terminated after the DB-held max age; re-kick never reports "recovered"                                       | §8.5       | M5b | T-RACE-13        | L   | [x] L — M5b `memory-extraction.int.test.ts` (both owner models) T-RACE-13              |
| SR-WF-06 | Activity HTTP timeout (30 s **[V]**) vs `startToCloseTimeout` 90 s aligned or duplicate-cost bound documented and tested | §8.3       | M5b | T-WF-06          | L   | [x] L — aligned: HTTP 85 s < activity 90 s ≤ API takeover 90 s (activity test + doc)   |
| SR-WF-07 | ids only in workflow input/history; no content                                                                           | §8.3       | M5b | T-LOG-01         | L   | [x] L — worker T-WF-06 (history input = `{jobId}`); outcomes are codes                 |

### A7. Maintenance functions

| ID        | Control                                                                                                    | Where | M   | Proof      | Env | State                                                           |
| --------- | ---------------------------------------------------------------------------------------------------------- | ----- | --- | ---------- | --- | --------------------------------------------------------------- |
| SR-MNT-01 | No function takes a time, interval or grace parameter; constants in the DB, changed only by migration (H5) | §5.3  | M2b | T-MNT-01   | L   | [x] L — M2b `memory-maintenance.int.test.ts`, both owner models |
| SR-MNT-02 | Each constant defined once and shared by trigger and functions (03C-05)                                    | §5.3  | M2a | T-MNT-05   | L   | [ ]                                                             |
| SR-MNT-03 | Per-user `set_config` scoping; caller scope NULL after return                                              | §5.3  | M2b | T-MNT-02   | L   | [x] L — M2b `memory-maintenance.int.test.ts`, both owner models |
| SR-MNT-04 | `REVOKE ALL FROM PUBLIC`; EXECUTE to `karen_api_runtime` only; parameters clamped                          | §5.2  | M2b | T-MNT-04   | L   | [x] L — M2b `memory-maintenance.int.test.ts`, both owner models |
| SR-MNT-05 | Purge depends on `identity.users` being non-FORCEd **[V]**; recorded in `data-isolation.md`                | §5.3  | M2b | doc review | —   | [x] `data-isolation.md` + `docs/database/memory-maintenance.md` |

### A8. AI boundary and prompt injection

| ID       | Control                                                                                 | Where       | M            | Proof               | Env | State                                                                                                                                  |
| -------- | --------------------------------------------------------------------------------------- | ----------- | ------------ | ------------------- | --- | -------------------------------------------------------------------------------------------------------------------------------------- |
| SR-AI-01 | Memory only in `memory_context`; the API never sends a `system` message                 | §2.4, §9.3  | M4a          | T-CTR-03            | L   | [x] L — M4a contract v5 fixtures (TS+Python), chat.v5 tests, golden `memory-injection-*` (mock)                                        |
| SR-AI-02 | One shared character policy (TS, Python, SQL) incl. bidi/format bans except ZWNJ/ZWJ    | §2.4        | M1, M2a, M4a | T-UNIT-03, T-CTR-02 | L   | [x] L — M4a contract v5 fixtures (TS+Python), chat.v5 tests, golden `memory-injection-*` (mock)                                        |
| SR-AI-03 | Per-item wire validation at retrieval; invalid items dropped and counted                | §2.4        | M4b          | T-RET-08            | L   | [x] L — M4b per-item `memoryContextItemSchema` parse with drop + metric                                                                |
| SR-AI-04 | Delimited data block; injection golden cases pass on the mock                           | §9.3, §13.5 | M4a          | T-INJ-01…03         | L   | [ ] (live NOT EVALUATED)                                                                                                               |
| SR-AI-05 | Verbatim-substring rule (V2/V3): the model cannot author memory text                    | §7.3        | M1, M5b      | T-UNIT-04, T-EXT-05 | L   | [x] L — M5b run step uses `validateCandidate` V2/V3 (forged-span test); extraction eval                                                |
| SR-AI-06 | Deterministic SECRET/SENSITIVE/minor detection authoritative; model label escalate-only | §7.3        | M1, M5b      | T-EXT-01…03         | L   | [x] L — M5b: deterministic layer authoritative, model label escalate-only; extraction eval (SENSITIVE 2 misses → G-5 FAIL, see report) |
| SR-AI-07 | Live extraction switch off; mock gateway only; no gateway JSON-schema work              | §1.2, §7.2  | M5a          | config test         | L   | [x] L — M5a: live switch refuses startup; mock only; no gateway JSON-schema work                                                       |

### A9. Secrets and key management

| ID        | Control                                                                                                                                  | Where | M      | Proof                      | Env | State                                           |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------ | -------------------------- | --- | ----------------------------------------------- |
| SR-SEC-01 | No new secret introduced by Phase 03; AI gateway key stays backend-only in ai-service                                                    | §2.1  | all    | `check:env-public`, review | L   | [ ]                                             |
| SR-SEC-02 | No `NEXT_PUBLIC_*`/`EXPO_PUBLIC_*` memory variables carrying secrets                                                                     | —     | M3, M6 | `pnpm check:env-public`    | L   | [ ]                                             |
| SR-SEC-03 | Memory content at rest: RDS storage encryption with KMS **[V]** (`rds-postgres/main.tf:100-101`); no column-level KMS (deviation, OD-08) | §1.4  | —      | Terraform review           | AWS | Designed (deviation acknowledged at ADR review) |

### A10. Rate limiting and abuse prevention

| ID       | Control                                                                                                                           | Where | M       | Proof              | Env | State |
| -------- | --------------------------------------------------------------------------------------------------------------------------------- | ----- | ------- | ------------------ | --- | ----- |
| SR-RL-01 | Default throttler covers all memory routes; explicit per-user limits on `clear`, `export`, `restore` (03C-09)                     | —     | M3      | T-API-10           | L   | [ ]   |
| SR-RL-02 | Per-user caps: 500 active items, 50 pending suggestions, 100 jobs/day; ≤ 5 candidates; message ≤ 4,000 chars (provisional, OD-09) | §12.3 | M3, M5b | T-API-07, T-EXT-07 | L   | [ ]   |
| SR-RL-03 | Extraction reserves and settles against the user's daily/monthly AI limits; refusal → `skipped/budget`                            | §12.3 | M5b     | T-WF-07            | L   | [ ]   |

### A11. Auditability

| ID        | Control                                                                           | Where | M       | Proof    | Env | State    |
| --------- | --------------------------------------------------------------------------------- | ----- | ------- | -------- | --- | -------- |
| SR-AUD-01 | In-transaction audit events with counts/ids/reason codes only (list in §12.2)     | §12.2 | M3, M5b | T-API-04 | L   | [ ]      |
| SR-AUD-02 | Suspension audited by `consent.decision` **[V]**; `memory.suspended` row per Q6   | §12.2 | M2a     | T-CON-01 | L   | [ ] (Q6) |
| SR-AUD-03 | `access_events` record which items were sent with which reply (ids, rank, reason) | §4.3  | M4b     | T-RET-04 | L   | [ ]      |
| SR-AUD-04 | Audit table append-only (existing rule)                                           | —     | —       | existing | L   | Existing |

### A12. Logging, monitoring and alerting

| ID        | Control                                                                                                            | Where | M        | Proof              | Env            | State                                        |
| --------- | ------------------------------------------------------------------------------------------------------------------ | ----- | -------- | ------------------ | -------------- | -------------------------------------------- |
| SR-OBS-01 | No memory content in logs; redaction keys in TS (`REDACT_PATHS`) and Python (`core/redaction.py`)                  | §12.2 | M3, M5a  | T-LOG-01, T-LOG-02 | L              | [ ]                                          |
| SR-OBS-02 | Metrics in §12.1 with bounded labels, no user identifiers                                                          | §12.1 | M4b, M5b | review             | L              | [ ]                                          |
| SR-OBS-03 | Dashboards and alerts: enqueue failures, stale terminations > 0, job outcomes, retrieval latency/drops, rejections | §12.1 | M7       | M7 evidence        | AWS (deployed) | [ ]                                          |
| SR-OBS-04 | Alert routing/on-call for memory alerts                                                                            | —     | PROD     | runbook            | AWS            | **Not designed** — production readiness item |

### A13. Disaster recovery, backup and retention

| ID       | Control                                                                                                                                                                        | Where        | M        | Proof              | Env | State                  |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ | -------- | ------------------ | --- | ---------------------- |
| SR-DR-01 | Expired rows excluded in SQL at read time; correctness never depends on purge having run                                                                                       | §11          | M4b      | T-RET-03           | L   | [ ]                    |
| SR-DR-02 | Purge is idempotent and resumable (cursor)                                                                                                                                     | §5.3         | M2b, M5b | T-MNT-02           | L   | [ ]                    |
| SR-DR-03 | Backups age out on the RDS schedule (`backup_retention_period` variable, 1–35 days **[V]**; prod 30 days per arch **[D]**); disclosure legal-gated                             | §10.3        | —        | Terraform          | AWS | Designed               |
| SR-DR-04 | **Restore re-applies deletions.** A point-in-time restore brings back deleted/suspended memories, revoked consents and erased accounts. No runbook covers this **[V]** (OD-13) | —            | PROD     | runbook + drill    | AWS | **GAP — not designed** |
| SR-DR-05 | Postgres outage: memory retrieval fails open to `unavailable`; deletion requests fail visibly (not silently)                                                                   | §9.4         | M4b, M3  | T-RET-06, T-API-04 | L   | [ ]                    |
| SR-DR-06 | Temporal outage: jobs stay `pending`, re-kicked or stale-terminated; deletion unaffected                                                                                       | §8.5, §8.6   | M5b      | T-RACE-13          | L   | [ ]                    |
| SR-DR-07 | Redis outage: maintenance lock unavailable → sweep skips (no double run); internal replay guard fails closed **[V]**                                                           | §8.5         | M5b      | T-WF-08            | L   | [ ]                    |
| SR-DR-08 | Rollback: flag off stops retrieval/jobs; read/delete/export keep working; migrations expand-only                                                                               | ADR rollback | all      | T-API-08           | L   | [ ]                    |

### A14. Failure isolation between chat and memory

| ID       | Control                                                                                                | Where | M        | Proof               | Env | State |
| -------- | ------------------------------------------------------------------------------------------------------ | ----- | -------- | ------------------- | --- | ----- |
| SR-FI-01 | Retrieval error/timeout → `memory_status: 'unavailable'`; chat continues                               | §9.4  | M4b      | T-RET-06            | L   | [ ]   |
| SR-FI-02 | One malformed stored item cannot fail the chat request (per-item drop)                                 | §2.4  | M4b      | T-RET-08            | L   | [ ]   |
| SR-FI-03 | Memory section failure in `finalize()` → savepoint rollback; reply, `ai_invocations` and ledger commit | §9.4  | M4b, M5b | T-RACE-12, T-TXN-02 | L   | [ ]   |
| SR-FI-04 | Workflow start failure never affects chat                                                              | §8.2  | M5b      | T-WF-04             | L   | [ ]   |
| SR-FI-05 | Extraction runs off the request path (Temporal), never in the chat stream                              | §8.1  | M5b      | design              | L   | [ ]   |

### A15. Mobile client

| ID       | Control                                                                                       | Where      | M   | Proof    | Env | State |
| -------- | --------------------------------------------------------------------------------------------- | ---------- | --- | -------- | --- | ----- |
| SR-UI-01 | Consent, flag and memory status come from the server only; the app never decides them locally | §2.1, §3.5 | M6  | T-MOB-02 | L   | [ ]   |
| SR-UI-02 | No memory text in device logs; no caching of memory content beyond the screen's query cache   | §2.1       | M6  | T-MOB-05 | L   | [ ]   |
| SR-UI-03 | No retention duration or purge date rendered anywhere until legal approval (H6, OD-02)        | §3.3, §11  | M6  | T-MOB-04 | L   | [ ]   |

---

## Part B — NEW-1: FORCE RLS blocks unscoped definer reads of `consent.data_rights_requests`

Tracked **separately** from Phase 03 (register OD-10; sequencing with M2a is OD-12). **Not fixed
in Task 03C.** Severity: **High for production** (data-rights export and account erasure — a
legal obligation — would fail on a non-superuser-owned database), **none locally** (hidden).

### B1. Statement

`consent.data_rights_requests` is `ENABLE` + `FORCE` RLS with an owner policy
(`20261120220000_consent_data_rights/migration.sql:52-56` **[V]**). Two `SECURITY DEFINER`
functions owned by the migration role read it **before** any `karen.user_id` scope is set:

1. `consent.lookup_data_rights_request(p_id)` (`…consent_data_rights/migration.sql:59-61` **[V]**),
   used by worker-initiated internal calls that only know the request id.
2. `identity.erase_user(p_request_id)` — first statement
   `SELECT … FROM consent.data_rights_requests q WHERE q.id = p_request_id FOR UPDATE`
   (`20261121100000_conversation_phase02/migration.sql:345-346` **[V]**); scope is set only
   afterwards (`:357`).

With FORCE, the table owner is subject to the policy **[PG]**; with no scope,
`identity.current_user_id()` is NULL and the policy matches no row. Expected effect on a
non-superuser owner: lookup returns nothing (internal step → not found), `erase_user` raises
`no deletion request`. Locally and in CI the owner `karen` is a superuser **[V-local]**, and
superusers bypass RLS even with FORCE **[PG]**, so every existing test passes.

Related (same D11 track): `conversation.purge_expired(p_now, p_event_retention)` takes a
caller-supplied clock and retention (validation F24; same pattern as Phase 03 H5).

### B2. Investigation requirements (read-only; future task)

1. Enumerate every `SECURITY DEFINER` function in the migrations and, for each, every FORCEd table
   it reads or writes **before** it sets `karen.user_id`. Task 03C did a first pass by `grep`
   **[V]**: the FORCEd tables are `consent.{consent_grants, legal_acceptances, consent_receipts,
data_rights_requests}`, `platform.{idempotency_records, ai_invocations, usage_ledger}`,
   `identity.{onboarding_progress, user_preferences, saved_places}`, `conversation.feedback`; the
   only unscoped definer reads of a FORCEd table found are the two in B1. `reap_stale_generations`
   and `purge_expired` touch only non-FORCEd conversation tables. The investigation must confirm
   this with a database query, not only `grep`.
2. Confirm the AWS ownership model: which role owns objects on RDS (`roles.sql` says a dedicated
   migration role, "NOT the RDS master user" **[V]**), and whether it has `BYPASSRLS` (it must
   not). RDS's `rds_superuser` is not a PostgreSQL superuser **[PG, NV for this account]**.
3. List all callers of both functions (data-rights service, workflow activities) and the
   user-visible failure mode for each.

### B3. Reproduction requirements

Local (no repository change needed to reproduce; run in a **disposable** database):

1. Create `karen_owner_probe NOSUPERUSER NOBYPASSRLS LOGIN`. Pre-create required extensions as a
   superuser (as RDS would via `rds_superuser`). Run `prisma migrate deploy` **as the probe role**
   on an empty database, then `infra/database/roles.sql` as the probe role.
2. As the probe role, with `karen.user_id` unset, insert a synthetic export request for a
   synthetic user (scoped insert), then call `consent.lookup_data_rights_request(<id>)` unscoped.
   **Expected (hypothesis):** 0 rows. Then the same call after
   `set_config('karen.user_id', <user>, true)`: 1 row. That difference is the defect.
3. Call `identity.erase_user(<deletion request id>)` unscoped. **Expected:** exception
   `erase_user: no deletion request`.
4. Run `apps/api/test/data-rights.int.test.ts` against that database. **Expected:** export and
   deletion flows fail at the lookup step.

AWS (non-production only, synthetic data, owner approval for access): repeat step 2–3 on a
non-production RDS instance migrated by the dedicated migration role. Result recorded as
**[V-aws]** or the reason it could not run.

### B4. Remediation options (to be chosen in the D11 track; none adopted here)

| Option                                                                                                                                  | Trade-off                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| (a) Read-only `FOR SELECT TO CURRENT_USER USING (true)` lookup policy on `data_rights_requests`, as Phase 03 does for `extraction_jobs` | The table holds `export_payload` (user content); a broad owner read policy is weaker than for a content-free table |
| (b) Split a content-free lookup table (`id → user_id, kind, status`) with the lookup policy; keep the payload table owner-only          | Migration + code change; cleanest isolation                                                                        |
| (c) Drop FORCE on `data_rights_requests` and document it as a D11 exclusion like the conversation tables                                | Simplest; widens owner access to payloads; contradicts D11's direction                                             |
| (d) Pass the user id from the API (which knows it from the request row) into a scoped call instead of an unscoped definer lookup        | Changes the worker → API contract; the API must still resolve the id safely                                        |

Whatever is chosen must keep the Phase 03 memory deletes in `erase_user` (OD-12).

### B5. Verification requirements (definition of fixed)

1. An integration-test configuration in which the migration/definer owner is a
   **non-superuser, non-BYPASSRLS** role, with a guard test asserting both flags.
2. `data-rights.int.test.ts` (export, deletion, erasure zero-rows incl. memory tables) passes under
   that configuration.
3. A negative test: unscoped `SELECT` on `consent.data_rights_requests` as the runtime role still
   returns 0 rows (isolation not weakened).
4. CI runs the non-superuser-owner variant on every PR touching migrations.
5. On a non-production RDS instance: one synthetic export and one synthetic erasure complete
   **[V-aws]**.
6. `conversation.purge_expired` parameters removed or clamped like Phase 03 H5, with a test.

### B6. Dependency on Phase 03

- Not a prerequisite for M0–M7 on local/CI (all mock, feature off).
- **A prerequisite for any AWS deployment** that runs data-rights workflows, and therefore for
  production readiness (register PROD row).
- Interacts with M2a (OD-12): both redefine `identity.erase_user`.
- Phase 03's own maintenance design does not copy the pattern (arch §5.3 item 3).

### B7. Status (2026-11-24)

| Step                              | Result                                                                                                                                                                                                                                         |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B2.1 inventory                    | Done from the catalog (`pg_proc.prosecdef`): 10 definer functions; only `lookup_data_rights_request` and the first read of `erase_user` touch a FORCEd table unscoped. Enforced by `definer-owner.int.test.ts` (allow-list)                    |
| B2.2 AWS ownership model          | Documented in `docs/runbooks/database-migrations.md` step 8; RDS **[NV]** (no instance)                                                                                                                                                        |
| B3.1–B3.4 reproduction            | **Reproduced [V-local]** on a database migrated by `NOSUPERUSER NOBYPASSRLS` `karen_owner_nonsuper`: unscoped lookup 0 rows (scoped 1), `erase_user` → `no deletion request`; whole suite → exactly 8 data-export/erasure failures, 198 passes |
| B4 option                         | **(e)** exact-id, GUC-gated, owner-only `FOR SELECT` policy (a narrowed (a)); ADR-0037 **Proposed**                                                                                                                                            |
| B5.1 non-superuser config + guard | `integration-nonsuper-owner` project + T-NEW1-00 guard                                                                                                                                                                                         |
| B5.2 data-rights suite            | 218/218 pass under the non-superuser owner and under the superuser owner                                                                                                                                                                       |
| B5.3 negative test                | T-NEW1-02: runtime role unscoped (even setting the GUC) → 0 rows                                                                                                                                                                               |
| B5.4 CI                           | `pnpm test:integration` runs both projects (CI Integration job)                                                                                                                                                                                |
| B5.5 RDS                          | **NOT VERIFIED** — script ready: `infra/database/verify/rds-verification.sql`, checklist `PHASE_03_RDS_VERIFICATION.md`                                                                                                                        |
| B5.6 maintenance clock            | `reap_stale_generations()` / `purge_expired(interval)` — no caller clock; retention clamped ≥ 1 h (T-NEW1-04)                                                                                                                                  |
| OD-12                             | `erase_user` keeps every M2a delete incl. all six memory tables (T-NEW1-03, compared with the live definition)                                                                                                                                 |
