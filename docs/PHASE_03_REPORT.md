# KAREN — Phase 03 (Personal Memory) — implementation and evidence report

- **Date:** 2026-11-24 · **Baseline:** `main` @ `e647f97` (M0, M1, M2a merged).
- **Scope of this work:** NEW-1, M2b, M3, M4a, M4b, M5a, M5b, M6, M7 — authorised for
  development/test by the owner instruction of 2026-11-24 (`PHASE_03_M0_NOTE.md` §6).
- **Merge state:** eight stacked PRs, **none merged** (merging needs the owner, D13):
  #54 NEW-1 → #55 M2b → #56 M3 → #57 M4a → #58 M4b → #59 M5a → #60 M5b → #61 M6 → M7 (this PR).
- **Feature flag:** `MEMORY_FEATURE_ENABLED=false` in every environment; nothing deployed; no paid
  call; no new extension; no production migration.
- Evidence labels: **[V-local]** executed locally (docker PostgreSQL 17 / Redis / Temporal test
  server) · **[NV]** not verified.

## G. Assessment

**IMPLEMENTATION COMPLETE — awaiting approvals**, with one recorded evaluation failure: the
SENSITIVE zero-tolerance metric is 2/296 on the sealed extraction set (decision NEW-B). Every
milestone's code, tests and documentation exist; nothing is merged; RDS behaviour is NOT VERIFIED.

**Gate 03: NOT PASSED.** Unmet: G-1 Gate 02 GO (Gate 02 is NO-GO), G-5 (SENSITIVE stored = 2),
G-6 thresholds not owner-approved (Q9), G-7 live extraction not approved (APP-1), G-8 no
human-reviewed live set, G-9 no legal review. Met locally: G-2 wrong-user recall 0, G-3
deleted/suspended/expired retrieved 0, G-4 deletion-reflection 100 % (OD-04 definition).

**Production: NOT READY** (section F).

## A. Milestone completion

| Milestone                   | PR      | Status                    | Implemented                                                                                                                                                                                     | Key tests (executed, [V-local])                                                                          | Remaining blockers                            |
| --------------------------- | ------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| NEW-1 (pre-existing defect) | #54     | Code complete, not merged | Exact-id owner lookup policy; `erase_user` scoped (keeps all M2a deletes); maintenance without caller clock; **whole API suite re-run under a non-superuser owner in every `test:integration`** | Reproduced first (8 failures); after: 218/218 both owner models; catalog allow-list of definer functions | ADR-0037 acceptance; RDS verification         |
| M2b                         | #55     | Code complete             | `lookup_extraction_job`, `due_extraction_jobs`, `terminate_stale_jobs`, `purge_expired` (per-user scope, DB constants, clamps, SKIP LOCKED, scope restored)                                     | 17 tests both owner models (T-MNT-01…04, §13.2 #19, concurrency, cursor)                                 | —                                             |
| M3                          | #56     | Code complete             | `/v1/memory*` (16 routes), conversation `memory_enabled`/`memory_status`/`delete_memories`, export section, content-free idempotency, per-user limits, audit, boundaries                        | 36 tests (consent matrix, cross-user 404, races, flag-off matrix, deletion window)                       | OD-06, Q7, Q12 decided as defaults (isolated) |
| M4a                         | #57     | Code complete             | Runner `AI_PROCESSING` re-check at load + while streaming; contract v5 (TS+Python, BMP parity digests); `chat.v5`; 7 injection golden cases; outbound validation                                | 3 consent tests; contracts 26 TS / 29 Py; evals 0 FAIL                                                   | OD-03 amendment confirmation                  |
| M4b                         | #58     | Code complete             | Retrieval service (bounded owner-filtered SQL, TS scorer, per-item wire drop, `unavailable` on failure); access events behind a savepoint; post-commit `last_used_at`; eval harness             | **T-TXN-01 savepoint proof**; 11 retrieval tests; eval on sealed split                                   | Q9 approval                                   |
| M5a                         | #59     | Code complete             | `usage` module, ledger request kind (additive migration), ai-service extract endpoint (mock only; live refuses startup), `extractMemory` client                                                 | 15 Python endpoint tests (incl. T-LOG-02); client tests                                                  | Q1/Q11 for live                               |
| M5b                         | #60     | Code complete             | Job in finalize savepoint; run/abandon steps (TX-A, reserve, pre-call consent, TX-B, CAS); maintenance sweep; Temporal workflow + activities                                                    | 14 pipeline tests both owner models; worker 29; extraction safety eval                                   | NEW-B (SENSITIVE 2/296); Q10 confirm          |
| M6                          | #61     | Code complete             | Settings › Memory, detail, suggestions, restore card, chat chip + switch, activity chips, delete/revoke dialogs                                                                                 | 19 mobile tests (states, a11y walk, no durations, no logs); bundle check                                 | Q5, OD-02, LEG-1…3 for release; Q15           |
| M7                          | this PR | Evidence complete         | Reports, dashboards/alarms (Terraform, disabled), runbook, decisions/legal register, doc reconciliation                                                                                         | `pnpm infra:validate` 4/4                                                                                | Q9 thresholds; owner records Gate 03          |

Migrations added (reviewed SQL, `BEGIN;…COMMIT;`, drift-clean against a fresh shadow DB):
`20261124100000_new1_definer_lookups`, `20261124110000_memory_maintenance`,
`20261124120000_usage_ledger_request_kind`. None applied outside local/CI.

## B. Security

| Area                                  | Result                                                                                                                                                                                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RLS / tenant isolation                | FORCE RLS on all memory tables; explicit `user_id` everywhere; cross-user 404 on every route; wrong-user recall **0** over 900 sealed queries incl. 150 adversarial [V-local]                                                   |
| Non-superuser owner                   | The **entire** API integration suite runs twice per `test:integration`: superuser owner and a `NOSUPERUSER NOBYPASSRLS` migration owner (AWS model) — 303/303 both [V-local]; RDS [NV]                                          |
| Definer functions                     | Catalog-enforced allow-list (14 functions); only non-owner policies are the read-only job lookup and the exact-id data-rights lookup                                                                                            |
| Account erasure                       | Works under a non-superuser owner after NEW-1 (was broken); all memory tables erased; other users untouched [V-local]; RDS [NV]                                                                                                 |
| Consent enforcement                   | Suspension trigger in the revoke transaction; runner re-check at load and every 5 s while streaming; extraction re-check in TX-A, immediately before the AI call, and in TX-B; races T-RACE-01/03/18 and create-vs-revoke clean |
| Deletion / resurrection               | Synchronous deletes; clear cancels in-scope jobs; CAS; T-RACE-04…10/13 clean; deletion-reflection 100 %                                                                                                                         |
| Retention                             | DB-held constants for cross-user durations (no parameter can shorten them, tested); per-row TTLs from env; purge skip-locked and idempotent                                                                                     |
| Export                                | Memory section in account export == `/v1/memory/export` (T-DR-01); idempotency records hold ids/counts only. Open: unexpired exports keep deleted text until TTL (OD-06)                                                        |
| Background jobs                       | ids-only workflow input/history; HMAC + replay guard on run/abandon; user re-derived from the job row; timeouts aligned (85 s < 90 s ≤ 90 s)                                                                                    |
| Prompt injection                      | Verbatim rule, shared character policy (TS = Python = SQL, BMP digests), delimited data block, no system message with memory; golden cases pass on mock; live NOT EVALUATED                                                     |
| Remaining vulnerabilities / residuals | SENSITIVE lexicon false negatives (2/296); shared internal HMAC secret (ADR-0007 residual); backup restore can resurrect deleted data (OD-13); unexpired exports (OD-06); no RDS verification                                   |

## C. Testing (executed)

| Suite                                                                                                               | Result                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm verify` (format, env guard, migration gate, lint + dependency rules, typecheck, unit, build — all workspaces) | pass. Unit: api 112, domain 281, ai-model-contracts 26, api-contracts 6, observability 8, temporal-worker 29, web 104, admin 66, mobile 98, others green |
| `pnpm test:integration` — superuser owner                                                                           | 22 files, **303/303**                                                                                                                                    |
| `pnpm test:integration` — non-superuser owner                                                                       | 22 files, **303/303**                                                                                                                                    |
| `pnpm verify:py`                                                                                                    | ai-service 343 passed (1 pre-existing skip), voice-agent 61; ruff/mypy clean                                                                             |
| `pnpm contracts:check`                                                                                              | OK (OpenAPI regenerated in M3)                                                                                                                           |
| `pnpm evals` (golden, mock)                                                                                         | 32 cases, 55 PASS, 0 FAIL, 24 NOT_EVALUATED                                                                                                              |
| Retrieval eval, sealed split                                                                                        | `evals/reports/memory-retrieval.v1.md`                                                                                                                   |
| Extraction safety eval, sealed split                                                                                | `evals/reports/memory-extraction.v1.md` — one zero-tolerance failure                                                                                     |
| Mobile config + iOS/Android bundle                                                                                  | pass                                                                                                                                                     |
| `pnpm infra:validate`                                                                                               | 4 passed                                                                                                                                                 |
| Drift check vs fresh shadow DB                                                                                      | no difference                                                                                                                                            |
| **CI on GitHub** (16 required checks each)                                                                          | #54–#60: **16/16 pass** each (observed 2026-11-24); #61: 14 pass, 2 still running at the time of writing; M7 PR: see its checks                          |
| **Not executed**                                                                                                    | RDS anything; real Temporal cluster end-to-end; native device builds; live model runs; RDS performance                                                   |

### Evaluation summary (sealed test splits; Q9 thresholds not approved → reported, not accepted)

- Retrieval recall@5 / recall-in-context — EN 1.000/1.000, Hindi 1.000/1.000, Hinglish
  0.993/1.000, code-mixed 0.950/0.950, cross-script 0.167/0.333, paraphrase 0.200/0.383; F1
  baseline lower on EN/Hinglish/code-mixed → **F2 chosen**; p95 retrieval 4 ms local (500 items × 50
  users; target 150 ms; not RDS). Shared-template caveat applies (upper bound).
- Extraction (deterministic layer, adversarial extractor) — SECRET 0/170 stored, minors 0/160,
  false tier-1 0/330, third-party tier-1 0, explicit recall 1.000, SENSITIVE detection 0.993
  [0.976, 0.998], **SENSITIVE stored 2/296 (FAIL)**.
- Embeddings (§6.8): condition 1 holds for cross-script and paraphrase; conditions 2–3 need per-case
  diagnosis; no embedding work done (APP-2). Proposed future shape is unchanged (arch §6.8).

### Defects found and fixed during this work

1. NEW-1 (pre-existing, data rights broken under a non-superuser owner) — fixed (#54).
2. Tier-1 rule received the trigger-containing `source_span` → all explicit requests demoted (M1) — fixed (#60).
3. ai-service serialised absent optional keys as `null` (rejected by the TS contract) — fixed (#59).
4. Plan inconsistency: M5a's "savepoint re-run for the job insert" depends on M5b's job insert — done in M5b.

## D/E. Decisions, legal reviews, approvals

`docs/phase-03/PHASE_03_PENDING_DECISIONS.md` (each with options, implications, recommendation and
what it blocks). New since the register: NEW-A (accept ADR-0037), OD-03 amendment, NEW-B (SENSITIVE
failure). Legal LEG-1…LEG-5: all OPEN. Approvals APP-1…APP-6: all OPEN.

## F. Production readiness

| Dimension      | State                                                                                                                                                                                                                      |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Technical      | Code complete for M2b–M7 + NEW-1; not merged; flag off                                                                                                                                                                     |
| Security       | Local controls verified incl. non-superuser owner; residuals in §B; formal security review of the memory module (P-7) not done                                                                                             |
| Infrastructure | **Not verified on AWS**: no RDS instance exists (`DescribeDBInstances` → 0). Probe script + checklist ready (`PHASE_03_RDS_VERIFICATION.md`). OTel → CloudWatch metrics export not deployed, so memory alarms are disabled |
| Operational    | Runbook `docs/runbooks/memory-operations.md`; dashboards/alarms defined (disabled); OD-13 restore procedure is a draft                                                                                                     |
| Legal          | No review done (LEG-1…5 open); all memory copy is draft                                                                                                                                                                    |
| Release        | **Not ready**: Gate 03 NOT PASSED; Gate 02 NO-GO; APP-4/APP-5 not granted                                                                                                                                                  |

## Limitations (stated plainly)

- Evaluation sets are synthetic, single-author, with shared retrieval templates; Hindi/Hinglish not
  native-reviewed. Mock extraction says nothing about model quality.
- Temporal orchestration was tested on the time-skipping server; the API steps were driven via the
  signed endpoints; no full end-to-end run on a real Temporal cluster.
- The mobile UI is tested with Jest; it has not been exercised on devices.
