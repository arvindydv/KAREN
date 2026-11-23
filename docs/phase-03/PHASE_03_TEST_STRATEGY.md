# KAREN — Phase 03 — Testing and evaluation strategy

- **Date:** 2026-11-23 (Task 03C) · **Baseline:** `main` @ `e5ff562`
- **Design source:** arch §13 (test layers, race tests, evaluation), §5.5 (isolation tests).
  This document assigns stable test IDs, the milestone that must deliver each test, and whether
  the test can run **locally/CI** or needs **AWS/RDS or an external service**.
- **Execution status: no Phase 03 test exists and none has been executed.** Every row below is a
  requirement. Nothing here claims a pass. Results are recorded only in milestone PRs and the M7
  evidence package, with evidence labels.

Environment column: **L** = local docker + CI (PostgreSQL 17 + pgvector, Redis, Temporal dev
server, mock gateway) · **L\*** = local, but only meaningful with the non-superuser owner role ·
**AWS** = needs an AWS/RDS environment (none exists for Phase 03 today) · **EXT** = needs a live
external provider (needs a separate approval: APP-1/APP-2).

---

## 1. Principles

1. **Right layer.** Pure policy → unit tests in `@karen/domain`. SQL, RLS, triggers, locks →
   integration tests on real PostgreSQL. Cross-service shapes → shared contract fixtures in TS
   and Python. Full turns → API integration tests driving the generation runner with the AI stub.
2. **Isolation tests run as the roles that matter.** The runtime role (`karen_api_runtime`,
   NOBYPASSRLS) for application paths; a **non-superuser, non-BYPASSRLS owner role** for FORCE,
   trigger and maintenance-function tests (M-11). A guard test (T-RLS-00) fails the suite if the
   role used is a superuser or has BYPASSRLS. Local/CI's `karen` owner is a superuser
   **[V-local]**; tests run as it prove nothing about FORCE.
3. **Races are tested deterministically.** Interleavings are forced with explicit transaction
   control (two connections, `pg_advisory_lock` barriers or step hooks in test builds) — not by
   sleeping and hoping. Loops (e.g. 200 iterations) are used only on top of a forced interleaving.
4. **Held-out evaluation.** Thresholds are measured only on a sealed test split (hash recorded
   before tuning; timing per OD-11), with ≥ 150 queries per threshold slice and 95 % Wilson
   intervals (Q9). Mock-pipeline numbers are labelled as properties of the set.
5. **No live calls.** Every suite uses the mock gateway and the AI stub. Live-model results are
   `NOT_EVALUATED` until APP-1 is approved.
6. **No disabled tests.** A test that cannot run in an environment is reported as NOT RUN with the
   reason, never skipped silently.

---

## 2. Suite overview

| Suite                         | IDs          | Location (proposed)                                                                                    | Milestone     | Env                  |
| ----------------------------- | ------------ | ------------------------------------------------------------------------------------------------------ | ------------- | -------------------- |
| Domain unit                   | T-UNIT-01…09 | `packages/domain/src/memory/*.test.ts`                                                                 | M1            | L                    |
| Contract fixtures             | T-CTR-01…08  | `packages/ai-model-contracts` tests + `apps/ai-service/tests/contract/test_shared_fixtures.py` **[V]** | M4a, M5a      | L                    |
| RLS / isolation               | T-RLS-00…08  | `apps/api/test/memory-rls.int.test.ts`, `rls.int.test.ts`                                              | M2a, M3, M4b  | L / L\*              |
| Consent trigger and races     | T-CON-01…03  | `apps/api/test/memory-consent.int.test.ts`                                                             | M2a           | L / L\*              |
| Maintenance functions         | T-MNT-01…05  | `apps/api/test/memory-maintenance.int.test.ts`                                                         | M2a, M2b      | L\*                  |
| API behaviour                 | T-API-01…10  | `apps/api/test/memory*.int.test.ts`, `conversations.int.test.ts`                                       | M3            | L                    |
| Race and resurrection         | T-RACE-01…19 | `apps/api/test/memory-extraction.int.test.ts` (+ M3/M4b files)                                         | M3, M4b, M5b  | L                    |
| Streaming after revocation    | T-STR-01…03  | `apps/api/test/generation*.int.test.ts`                                                                | M4a, M4b      | L                    |
| Transaction failure isolation | T-TXN-01…02  | `apps/api/test/memory-finalize.int.test.ts`                                                            | M4b, M5a      | L                    |
| Retrieval behaviour + eval    | T-RET-01…08  | `apps/api/test/memory-retrieval*.int.test.ts`, `…eval.int.test.ts`                                     | M4b, M7       | L                    |
| Workflow and worker           | T-WF-01…08   | `apps/temporal-worker/src/workflows/memory.workflow.test.ts`, activities test, API pipeline test       | M5b           | L                    |
| Extraction / safety eval      | T-EXT-01…07  | `apps/api/test/memory-extraction.eval.int.test.ts`, `evals/graders/`                                   | M5b, M7       | L (mock); EXT (live) |
| Prompt injection              | T-INJ-01…03  | `evals/golden-cases/memory-injection-*.json`, ai-service unit tests                                    | M4a, M7       | L (mock); EXT (live) |
| Data rights                   | T-DR-01…05   | `apps/api/test/data-rights.int.test.ts`                                                                | M2a, M3       | L; AWS for T-DR-05   |
| Logging / content leakage     | T-LOG-01…02  | API + ai-service log-content tests                                                                     | M3, M5a, M5b  | L                    |
| Mobile                        | T-MOB-01…05  | `apps/mobile` Jest (`jest-expo` **[V]**)                                                               | M6            | L                    |
| Performance and load          | T-PERF-01…03 | `apps/api/test/memory-perf*.ts` (+ load script)                                                        | M4b, M7, PROD | L; AWS               |
| AWS/RDS verification          | T-AWS-01…06  | runbook-driven checks                                                                                  | pre-PROD      | AWS                  |
| NEW-1 reproduction            | T-NEW1-01…04 | disposable database; `data-rights.int.test.ts` variant                                                 | D11 track     | L\*; AWS             |

---

## 3. Test catalogue

### 3.1 Domain unit (M1, L)

| ID        | Asserts                                                                                                                                                                                                                                                                                                                                             |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-UNIT-01 | SECRET detectors (arch §7.3 V5): every listed format — Luhn-valid cards; CVV/PIN/OTP/password keywords near digits (EN/HI/Hinglish); UPI PIN; Aadhaar (Verhoeff); PAN; passport/voter-ID/driving-licence; IFSC + account-number pairs; API-key/token shapes; recovery codes — + ≥ 3 near-misses each (phone numbers, order ids); whole-message rule |
| T-UNIT-02 | SENSITIVE lexicons and minors (third-party children **and** self-stated age < 18 / school grade, M-10): ≥ 10 positive, ≥ 5 negative per category per language (EN, HI-Devanagari, Hinglish)                                                                                                                                                         |
| T-UNIT-03 | Character policy: every BMP code point classified identically by TS, the generated SQL class and (in M4a) Python; ZWNJ/ZWJ allowed; Cc/Zl/Zp/U+0085/other Cf and `<>{}` backtick rejected                                                                                                                                                           |
| T-UNIT-04 | Span/value checks: `value_text ⊆ source_span ⊆ message` after normalisation; model-authored text rejected                                                                                                                                                                                                                                           |
| T-UNIT-05 | **Tier-1 rule (H1):** clause-bound trigger; negation scoping (`don't/do not/na/mat/नहीं/मत`); interrogatives (`?`, `kya`, `क्या`); `remind me` ≠ `remember`; multi-clause ("Remember to call mom. Also I hate cilantro" → tier 2 for the second clause); every case in EN/HI/Hinglish                                                                 |
| T-UNIT-06 | Clause splitter incl. `।` and connectors                                                                                                                                                                                                                                                                                                            |
| T-UNIT-07 | Normaliser/tokeniser: Hinglish spelling variants (`khana/khaana`, `nahi/nahin`), Devanagari matras/chandrabindu kept, versioned                                                                                                                                                                                                                     |
| T-UNIT-08 | Lexical scorer: non-zero `lexicalNorm` for a matching query (H2); idf weighting; deterministic tie-breaks                                                                                                                                                                                                                                           |
| T-UNIT-09 | `effectiveMemoryStatus` truth table; budget (12 items / 2,000 chars) and dedupe functions                                                                                                                                                                                                                                                           |

### 3.2 Contract fixtures (M4a/M5a, L)

| ID       | Asserts                                                                                                                                  |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| T-CTR-01 | v5 valid request with memory accepted by TS and Python                                                                                   |
| T-CTR-02 | Invalid: newline, `<`, bidi override, zero-width space, bad `subject_label` → rejected on both sides                                     |
| T-CTR-03 | `memory_context` without `memory_status: 'on'` rejected; non-CHAT task kind rejected; extra field rejected; no `system` message from API |
| T-CTR-04 | 21 items rejected (wire max 20)                                                                                                          |
| T-CTR-05 | `off_feature` is not a wire status; DTO enum separate                                                                                    |
| T-CTR-06 | Extract request: one message, ≤ 4,000 chars, strict                                                                                      |
| T-CTR-07 | Extract response: ≤ 5 candidates, strict, `is_mock` present                                                                              |
| T-CTR-08 | `CONTRACT_VERSION` identical in TS and Python                                                                                            |

### 3.3 RLS isolation with non-superuser roles (M2a/M3/M4b)

| ID       | Role                | Asserts                                                                                                                                                                                                                      | Env |
| -------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| T-RLS-00 | both                | Guard: the role in use has `rolsuper = false` and `rolbypassrls = false`; suite fails otherwise                                                                                                                              | L   |
| T-RLS-01 | runtime             | Unscoped `SELECT`/`INSERT` on every memory table → 0 rows / rejected                                                                                                                                                         | L   |
| T-RLS-02 | runtime             | **Cross-user access attempts:** scoped as A, cannot read/update/delete **or reference** B's items, suggestions, jobs, access events, messages, threads — one test per reference column (composite FKs + owner trigger, M-03) | L   |
| T-RLS-03 | runtime             | `WITH CHECK`: insert `user_id = B` scoped as A fails                                                                                                                                                                         | L   |
| T-RLS-04 | non-superuser owner | Maintenance functions cannot delete B's unexpired or in-grace rows by any parameter (H5)                                                                                                                                     | L\* |
| T-RLS-05 | non-superuser owner | FORCE: unscoped `SELECT count(*) FROM memory.items` = 0; thread delete still applies `SET NULL`/`CASCADE`                                                                                                                    | L\* |
| T-RLS-06 | runtime             | Ephemeral thread with `memory_enabled = true` rejected by CHECK                                                                                                                                                              | L   |
| T-RLS-07 | API                 | A's `GET/PATCH/DELETE /v1/memory/{B's id}` → 404; `clear` affects only A; `restore` with B's ids → no effect; suggestions/confirm with B's id → 404                                                                          | L   |
| T-RLS-08 | runtime             | Source-message trigger: assistant-role or other-user message as source rejected                                                                                                                                              | L   |

### 3.4 Consent grant/revoke races (M2a, M5b)

| ID                            | Asserts                                                                                                                                                                     | Env |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| T-CON-01                      | Revoke `MEMORY_STORAGE` via `ConsentService.decide()` (Prisma upsert path) → items `suspended`, suggestions deleted, pending jobs `canceled`, all in the revoke transaction | L   |
| T-CON-02                      | Revoke `AI_PROCESSING` → cascade revoke of `MEMORY_STORAGE` → same effects                                                                                                  | L   |
| T-CON-03                      | Unscoped status update of a `MEMORY_STORAGE` grant (as non-superuser owner) raises                                                                                          | L\* |
| T-RACE-01, 02, 03, 08, 11, 18 | See §3.6                                                                                                                                                                    | L   |

### 3.5 Maintenance functions (M2a/M2b, L\*)

| ID       | Asserts                                                                                                                      |
| -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| T-MNT-01 | No maintenance function signature contains a timestamp/interval parameter (catalog query); purge respects the grace constant |
| T-MNT-02 | Caller's `karen.user_id` is NULL after every function; purge cursor visits every user; re-running is idempotent              |
| T-MNT-03 | Only `extraction_jobs` has a non-owner policy, and it is `FOR SELECT` (catalog query on `pg_policies`)                       |
| T-MNT-04 | `EXECUTE` granted only to `karen_api_runtime`; `PUBLIC` has none; `p_limit`/`p_batch` clamped                                |
| T-MNT-05 | Each cross-user constant has one definition; trigger and purge use the same value (03C-05)                                   |

### 3.6 Race and resurrection (arch §13.2 items 1–19 → T-RACE-01…19)

T-RACE-nn is arch §13.2 item nn, unchanged in meaning. Milestone: items 10, 16, 17 in **M3**;
11, 12 in **M4b**; all others in **M5b**. All L.

| ID        | Short name                                                                                                                          |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| T-RACE-01 | Revoke between TX-A and TX-B → nothing stored, job canceled                                                                         |
| T-RACE-02 | `AI_PROCESSING` cascade → same; next send refused; in-flight runner fails `CONSENT_REQUIRED` at `load()`                            |
| T-RACE-03 | Concurrent `decide(revoke)` and TX-B → "stored then suspended" or "not stored", never active after revoke                           |
| T-RACE-04 | Delete source thread while job pending → job gone, run 404, no item                                                                 |
| T-RACE-05 | Thread flag off while pending → `skipped/thread_disabled`                                                                           |
| T-RACE-06 | Delete a memory, then the same turn's job completes → deleted item not recreated                                                    |
| T-RACE-07 | Two workers run the same job → exactly one write (CAS)                                                                              |
| T-RACE-08 | Re-grant after revoke → suspended items stay suspended; not retrieved                                                               |
| T-RACE-09 | Erasure while job pending → job deleted; run 404                                                                                    |
| T-RACE-10 | Clear with pending job: `all`/`conversation` cancel; `kind` does not (documented)                                                   |
| T-RACE-11 | Lock order: concurrent revoke and `finalize()` in a loop → no deadlock; no access event for a suspended item after revoke           |
| T-RACE-12 | Delete a memory while its answer streams → reply `completed`, `ai_invocations` + ledger exist, no access event for the deleted item |
| T-RACE-13 | Stale job → `failed/abandoned_stale` after max age; purged later; never "recovered"                                                 |
| T-RACE-14 | Replayed signed `run` → rejected; fresh call on terminal job → stored outcome, no writes                                            |
| T-RACE-15 | Fork copies never become sources; regenerate on copied reply refused                                                                |
| T-RACE-16 | Clear-after-thread-delete matches 0 (documented); `delete_memories=true` atomic                                                     |
| T-RACE-17 | Undo guards: supersession after edit → 409; after revoke → 403; new-item undo without consent allowed                               |
| T-RACE-18 | Revoke before the AI call → zero AI calls (stub asserts), `skipped/consent_inactive`                                                |
| T-RACE-19 | Purge as runtime role with any parameters → in-grace suspended items survive                                                        |

### 3.7 Streaming behaviour after consent revocation (M4a/M4b, L)

| ID       | Asserts                                                                                                                                                                                                             |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-STR-01 | `AI_PROCESSING` revoked after send but before `load()` → message `failed` with `CONSENT_REQUIRED`, zero AI calls (S2)                                                                                               |
| T-STR-02 | `MEMORY_STORAGE` revoked while an answer that used memory is streaming → the answer finishes (OD-03 definition); **no** extraction job is created for that reply; no access event for items suspended before commit |
| T-STR-03 | The **next** turn after the revoke → `memory_status: 'off_consent'`, empty `memory_context` in the captured AI request                                                                                              |

### 3.8 Transaction failure isolation (M4b/M5a, L)

| ID       | Asserts                                                                                                                                                                                                         |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-TXN-01 | `SAVEPOINT` / `ROLLBACK TO SAVEPOINT` via `tx.$executeRaw` inside a Prisma interactive transaction: an error after the savepoint leaves earlier writes committable (03C-01: required in **M4b**, re-run in M5a) |
| T-TXN-02 | Fault injection: forced failure of the access-event insert, of the job insert, and a lock timeout in the memory section → reply still `completed`, ledger and `ai_invocations` present, counter incremented     |

### 3.9 Retrieval behaviour, ranking, bounds and multilingual evaluation (M4b, M7)

| ID         | Asserts                                                                                                                                                                                                                                                     | Env |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| T-RET-01   | §9.2 behaviour matrix (flag off, ephemeral, thread off, consent off, on, unavailable)                                                                                                                                                                       | L   |
| T-RET-02   | Adversarial isolation slice: wrong-user recall = **0**                                                                                                                                                                                                      | L   |
| T-RET-03   | Deleted / suspended / expired items returned = **0** (expired excluded in SQL without purge)                                                                                                                                                                | L   |
| T-RET-04   | **Deletion-reflection** (OD-04 definition): save in thread A, retrieved in thread B, edit/delete, next turn in B (or new C) → absent from captured `memory_context` **and** from `access_events`; edited text present after edit                            | L   |
| T-RET-05   | **Bounded retrieval:** > 40 lexical matches → bound hit reported; an old lexical match still included ahead of non-matching always-include rows; 12-item / 2,000-char budget always respected                                                               | L   |
| T-RET-06   | DB error / `statement_timeout` → `unavailable`, chat continues                                                                                                                                                                                              | L   |
| T-RET-07   | `last_used_at` updated post-commit without `version`/`updated_at` change; failure only counted                                                                                                                                                              | L   |
| T-RET-08   | A stored item failing the wire schema is dropped and counted; the request still succeeds                                                                                                                                                                    | L   |
| T-RET-EVAL | Multilingual evaluation on the sealed test split: EN, Hindi (Devanagari), Hinglish, code-mixed, cross-script, paraphrase, temporal, distractors; recall@5 **and** recall-in-context with Wilson intervals; MRR; thresholds per arch §13.3 (provisional, Q9) | L   |

FTS sufficiency (D3) is accepted only if the Devanagari and Hinglish slices meet thresholds on
the sealed test split. Cross-script recall is expected to be weak and feeds the §6.8 decision.

### 3.10 Workflow and worker (M5b, L)

| ID      | Asserts                                                                                                                                    |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| T-WF-01 | Workflow input is `{ jobId }` only; history holds ids and outcome codes only                                                               |
| T-WF-02 | Retry policy: 5 attempts, backoff; `InternalCallRejected`/`ConfigError` non-retryable                                                      |
| T-WF-03 | Activity failure after retries → `abandon` → job `failed`; abandon idempotent                                                              |
| T-WF-04 | **Duplicate workflow start**: second start with the same id → "already started" (success); one job row; start failure does not affect chat |
| T-WF-05 | Internal routes reject unsigned, stale-timestamp and replayed requests                                                                     |
| T-WF-06 | HTTP 30 s vs activity 90 s: slow run step retried while running → CAS loser writes nothing; duplicate cost recorded                        |
| T-WF-07 | Usage reservation refused → `skipped/budget`; ledger `kind = memory_extraction`                                                            |
| T-WF-08 | Redis unavailable → maintenance sweep skips (lock not acquired), no double run                                                             |

### 3.11 Extraction classification and safety (M5b mock, M7)

| ID       | Asserts (on the sealed extraction test split; mock pipeline)                                                                        |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| T-EXT-01 | SECRET stored = **0** (100 % format-set rejection)                                                                                  |
| T-EXT-02 | SENSITIVE: deterministic detection ≥ 98 % (Wilson interval); stored = 0 on this set (property of the set)                           |
| T-EXT-03 | Minors' data stored = **0** (third-party and self)                                                                                  |
| T-EXT-04 | **Negation, questions and reminders:** tier-1 writes for non-explicit messages = **0**, measured against the deterministic V10 rule |
| T-EXT-05 | Memories sourced from assistant text = 0; model-authored text never stored                                                          |
| T-EXT-06 | Third-party facts stored without confirmation = 0                                                                                   |
| T-EXT-07 | Caps: > 5 candidates truncated; message > 4,000 chars → `too_long`; > 100 jobs/day → no job                                         |
| (live)   | Precision ≥ 0.90 / recall ≥ 0.80 on a **human-reviewed live** set — **NOT EVALUATED** until APP-1; required for Gate 03 (EXT)       |

### 3.12 Prompt injection (M4a, M7)

| ID       | Asserts                                                                                                                                                                    | Env                 |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| T-INJ-01 | Malicious memory items (ignore-instructions, role-play, fake SYSTEM, fake end-of-block, HI/Hinglish, URL/phone lures) → rendered as delimited data; prompt rules unchanged | L                   |
| T-INJ-02 | Contract rejects delimiter characters; write-time substring rule rejects model-authored text                                                                               | L                   |
| T-INJ-03 | Live-model behaviour on the same cases                                                                                                                                     | EXT — NOT EVALUATED |

### 3.13 Deletion, restoration and export consistency (M2a/M3)

| ID      | Asserts                                                                                                                                                                                                          | Env       |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| T-DR-01 | Export contains every memory row with provenance and revisions, jobs, access events; stable ids; equals `GET /v1/memory/export`                                                                                  | L         |
| T-DR-02 | Delete one / by kind / by conversation / all remove exactly the intended rows and cascades; restore rules (identical → delete copy; slot conflict → suggestion; otherwise active) with no unique-violation abort | L         |
| T-DR-03 | Erasure leaves zero rows in every memory table for the user and untouched rows for another user; existing erasure assertions unchanged                                                                           | L         |
| T-DR-04 | Stored export after memory delete: behaviour per OD-06 (window disclosed, or export invalidated)                                                                                                                 | L         |
| T-DR-05 | Export and erasure complete on a non-superuser-owned database (blocked by NEW-1 until fixed)                                                                                                                     | L\* / AWS |

### 3.14 Logging (M3/M5a/M5b, L)

| ID       | Asserts                                                                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-LOG-01 | API: forced errors in retrieval, extraction and validation → no `value_text`, span, excerpt, message text, `memory_context` in logs or Temporal history |
| T-LOG-02 | ai-service: same for the extract endpoint and chat rendering (Python redaction backstop)                                                                |

### 3.15 Mobile (M6, L)

| ID       | Asserts                                                                                |
| -------- | -------------------------------------------------------------------------------------- |
| T-MOB-01 | Each memory screen renders loading/empty/error/denied/suspended/feature-off            |
| T-MOB-02 | Chat header mirrors server `memory_status`; never a local guess                        |
| T-MOB-03 | Every interactive element has `accessibilityLabel` and `accessibilityRole` (tree walk) |
| T-MOB-04 | No rendered string contains a retention duration or purge date (H6)                    |
| T-MOB-05 | No memory text in device logs                                                          |

### 3.16 Performance and load

| ID        | Asserts                                                                                                  | Env | Milestone |
| --------- | -------------------------------------------------------------------------------------------------------- | --- | --------- |
| T-PERF-01 | Retrieval p95 < 150 ms at 500 items/user — labelled **local docker**, not an RDS figure                  | L   | M4b       |
| T-PERF-02 | `finalize()` latency added by the memory section (p95 delta) and purge batch duration at synthetic scale | L   | M5b/M7    |
| T-PERF-03 | Retrieval p95 and purge duration on the target RDS class under representative concurrency                | AWS | pre-PROD  |

### 3.17 AWS/RDS-specific verification (none can run today: no Phase 03 AWS environment)

| ID       | Asserts                                                                                                         | Blocks                |
| -------- | --------------------------------------------------------------------------------------------------------------- | --------------------- |
| T-AWS-01 | FORCE RLS behaves as locally with the dedicated non-superuser migration role                                    | PROD                  |
| T-AWS-02 | Data-rights export and erasure complete (NEW-1 fixed)                                                           | PROD                  |
| T-AWS-03 | Devanagari parsing under the RDS `LC_CTYPE` (Q2)                                                                | M4b (or [NV] rule)    |
| T-AWS-04 | `pg_trgm` availability/version (Q3) — only if F3 is proposed                                                    | F3 PR                 |
| T-AWS-05 | Migrations + `roles.sql` apply in order on RDS; if the fallback role is chosen (OD-01), `CREATEROLE` path works | M2b (fallback) / PROD |
| T-AWS-06 | Backup/PITR restore drill: deletions and erasures after the restore point are re-applied (OD-13)                | PROD                  |

### 3.18 NEW-1 reproduction (D11 track; `PHASE_03_SECURITY_RELIABILITY_CHECKLIST.md` Part B)

| ID        | Asserts                                                                                | Env |
| --------- | -------------------------------------------------------------------------------------- | --- |
| T-NEW1-01 | Unscoped `lookup_data_rights_request` as non-superuser owner → 0 rows (defect present) | L\* |
| T-NEW1-02 | Unscoped `erase_user` → `no deletion request` (defect present)                         | L\* |
| T-NEW1-03 | After the fix: both succeed; runtime-role unscoped read still 0 rows                   | L\* |
| T-NEW1-04 | After the fix: synthetic export + erasure on non-production RDS                        | AWS |

### 3.19 API behaviour (M3, L)

| ID       | Asserts                                                                                                                                                                                                                                       |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-API-01 | Every `/v1/memory*` route rejects unauthenticated calls; the user always comes from the principal (body/query user ids ignored or rejected)                                                                                                   |
| T-API-02 | Consent matrix (arch §3.1/§3.7): list, get, search, export, delete, clear, dismiss, status, settings read work **without** `MEMORY_STORAGE`; create, patch, pin, confirm, restore, supersession-undo return `403 CONSENT_REQUIRED` without it |
| T-API-03 | An ACTIVE grant whose `policy_version` is not in `MEMORY_CONSENT_ELIGIBLE_POLICY_VERSIONS` behaves as `off_consent` (re-confirmation, D5)                                                                                                     |
| T-API-04 | Delete one / by kind / by conversation / clear all are synchronous and complete in one transaction; audit rows carry counts/ids only; a DB failure returns an error (never a silent success)                                                  |
| T-API-05 | `If-Match` mismatch → 409; `Idempotency-Key` replay returns the stored response; duplicate create → `duplicate` via `ON CONFLICT`, no unique-violation abort                                                                                  |
| T-API-06 | Restore: identical active → suspended copy deleted; single-slot conflict → `restore_conflict` suggestion; otherwise active; consent required                                                                                                  |
| T-API-07 | Caps: 501st active item and 51st pending suggestion refused with `cap_reached`                                                                                                                                                                |
| T-API-08 | Feature-flag-off matrix for every route: writes 404; reads/delete/export/clear work; conversation `memory_enabled: true` ignored and stored `false` (L-11)                                                                                    |
| T-API-09 | A user in the account-deletion window can list, delete, clear and export (`@AllowDeletionPending()`)                                                                                                                                          |
| T-API-10 | Rate limits (03C-09): default throttler applies to all memory routes; `clear`, `export`, `restore` per-user limits enforced and fail closed per ADR-0013 if the limiter uses the `sensitive` throttler                                        |

---

## 4. What can be run where

| Group                                                                                                                             | Local/CI | Needs AWS/RDS | Needs live provider |
| --------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------- | ------------------- |
| Unit, contract, RLS (runtime + non-superuser owner), consent, races, API, workflow, mock evaluations, mobile, logging, local perf | Yes      | —             | —                   |
| RDS locale, `pg_trgm`, RDS FORCE/ownership, RDS perf, PITR drill, NEW-1 on RDS                                                    | —        | Yes           | —                   |
| Live extraction quality, live injection behaviour, embedding probe                                                                | —        | —             | Yes (APP-1 / APP-2) |

## 5. Reporting rules

- Every milestone PR lists the test IDs it adds and their result from the CI run linked in the
  PR. A test ID without a linked run is "not run".
- The M7 report reproduces this catalogue with one of: PASS (run link), FAIL (numbers), NOT RUN
  (reason), NOT EVALUATED (needs approval), NOT VERIFIED (environment missing).
- Threshold results always carry the test-split hash, the Wilson interval and the
  `MEMORY_POLICY_VERSION` / `MEMORY_TOKENIZER_VERSION` used.
