# KAREN — Phase 03 (Personal Memory) — Task 03 Architecture Validation

- **Date:** 2026-11-23 · **Baseline:** `main` @ `e5ff562` (working tree: untracked `docs/phase-03/`,
  `docs/adr/ADR-0036-personal-memory-architecture.md`)
- **Subject:** `docs/phase-03/PHASE_03_MEMORY_ARCHITECTURE.md` ("the architecture", section
  numbers `§n`) and `docs/adr/ADR-0036-personal-memory-architecture.md` ("the ADR").
- **Authority checked against:** `docs/phase-03/PHASE_03_OWNER_DECISIONS.md` §17 (D1–D13, OWNER
  APPROVED 2026-11-23) and its two recorded qualifications; the legal qualifications attached to
  D5, D6, D9 and D12 are preserved throughout this report.
- **Type:** validation only. This file is the only change. The architecture, the ADR, the owner
  decision register, application code, migrations, database state and GitHub settings were not
  modified. No paid or live AI-provider call was made. Nothing was committed.

Evidence labels: **[V]** verified in repository code/config in this task · **[V-local]** verified
by a read-only query against the local docker PostgreSQL 17.12 (not RDS) · **[V-gh]** verified via
read-only GitHub API · **[D]** stated in a repository document · **[PG]** documented PostgreSQL /
Temporal behaviour, not re-proven here · **[A]** assumption · **[P]** proposed (does not exist yet)
· **[NV]** not verified.

---

## 1. Executive verdict

**CONDITIONAL PASS.**

The architecture is substantially sound and faithful to D1–D13: ownership stays in `apps/api`,
the ai-service and Temporal worker stay database-less, consent suspension is atomic with the
revoke, deletion never depends on Temporal, memory text is constrained to the user's verbatim
words, and every evidence claim I sampled about the existing code is accurate. No finding
undermines the overall design or requires an owner decision to be reversed.

It is **not ready for formal owner acceptance as written.** Seven High findings must be corrected
in the architecture and ADR first. Two of them are verified defects: FTS ranking always scores
zero under the proposed tokeniser (**H2**, [V-local]), and a memory-related write can make an
already-finished chat reply fail (**H3**). The others are a design that does not fit how the repo
creates database roles (**H4**), a cross-user deletion capability in the maintenance functions
(**H5**), a job-recovery mechanism that Temporal's id policy prevents (**H7**), a tier-1
"explicit request" check that is too loose for D7 (**H1**), and user-facing copy that would break
the D6/D12 legal qualifications (**H6**). Thirteen Medium and eleven Low findings follow.

| Severity | Count | Blocks ADR acceptance                                |
| -------- | ----- | ---------------------------------------------------- |
| Critical | 0     | —                                                    |
| High     | 7     | Yes (all seven: document corrections)                |
| Medium   | 13    | 5 (M-03, M-06, M-07, M-12, M-13); rest per milestone |
| Low      | 11    | No                                                   |

---

## 2. Scope and evidence methodology

1. Read in full: the architecture (1,628 lines), the ADR (240 lines), the owner decision register
   (799 lines, incl. §17), and the repository audit §3–§18. Read `karen_phases.md` PHASE 03
   (F03-01/02/03, APIs, Gate 03).
2. Every repository claim marked **[V]** in the architecture that matters to correctness was
   re-checked against source, migrations, schema, tests, CI and role scripts (list in §3).
3. Three open technical questions (Q2, Q3, partly Q4) and one ranking assumption were probed with
   **read-only** SQL against the running local `karen-postgres-1` container
   (`BEGIN TRANSACTION READ ONLY … ROLLBACK`, `karen_test` database, no table access, no DDL/DML).
4. Branch protection was checked with a read-only GitHub API `GET`.
5. Each D1–D13 owner condition was traced to architecture sections, then the proposals were tested
   against PostgreSQL semantics (RLS, FK actions, locks, unique violations, FTS), Temporal id
   reuse semantics, and the existing NestJS/dependency-cruiser boundaries.
6. Findings are ranked by their impact on isolation, consent, data integrity and correctness.
   "Owner approval required" means a product, legal, infrastructure or decision-register call; a
   pure engineering correction does not need one.

Not done (out of scope or not possible here): running `pnpm verify`/integration suites (no code
changed); any RDS, AWS or OpenRouter check; legal review.

---

## 3. Repository facts verified

| #   | Claim in the architecture                                                                                     | Result                                                                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | `ConsentService.decide()` runs in `withUserScope` and locks `identity.users … FOR UPDATE`                     | **[V]** `apps/api/src/consent/consent.service.ts:194-197`                                                                                                                                                            |
| F2  | Revoking `AI_PROCESSING` cascades `MEMORY_STORAGE` revoke in the same transaction                             | **[V]** `consent.service.ts:265-280` (`consentDependents`, only if ACTIVE); `packages/domain/src/privacy.ts:50-57` (`MEMORY_STORAGE.dependsOn = ['AI_PROCESSING']`)                                                  |
| F3  | Grants record notice version as `policy_version`; re-confirmation can work without changing consent code      | **[V]** `applyDecision` upserts `policyVersion: notice.version` on every decision (`:491-512`); `decide()` does **not** reject a `grant` on an already-ACTIVE purpose (only `revoke`/`deny` are guarded, `:213-218`) |
| F4  | The only writer of `consent_grants.status` in app code is `applyDecision` (Prisma `upsert`); erasure DELETEs  | **[V]** grep of `apps/api/src`, migrations: one upsert; `erase_user` `DELETE` (`…conversation_phase02/migration.sql:374`). No code sets `expires_at` on grants or status `EXPIRED`                                   |
| F5  | Consent grants use scope `'*'` only                                                                           | **[V]** `applyDecision` hard-codes `scope: '*'`; `hasActiveConsent` filters `scope in ['*']`                                                                                                                         |
| F6  | `identity.current_user_id()` returns NULL when unset                                                          | **[V]** `20261120090000_user_isolation_rls/migration.sql:18-21`                                                                                                                                                      |
| F7  | `erase_user` sets `karen.user_id`, deletes threads, scrubs (not deletes) `identity.users`                     | **[V]** `…conversation_phase02/migration.sql:336-400`; signature is `erase_user(p_request_id uuid)`                                                                                                                  |
| F8  | Runtime role is NOBYPASSRLS, non-owner, gets grants only from `infra/database/roles.sql`                      | **[V]** `roles.sql:22-30,45-…`; "no default privileges" rule stated in the file                                                                                                                                      |
| F9  | DB roles are created by `roles.sql`, **not** by migrations; migrations run first                              | **[V]** no `CREATE ROLE`/`OWNER TO` in any migration; `apps/api/test/global-setup.ts:11-12` runs `migrate deploy` then `db-roles.mjs`; CI `ci.yml:71-78` migrates + diffs against `karen_shadow`                     |
| F10 | Local/CI migration owner role is a superuser                                                                  | **[V-local]** `rolsuper = t` for `karen`; `docker-compose.yml:11` `POSTGRES_USER: karen`; `apps/api/test/env.ts:3` "bypasses RLS"                                                                                    |
| F11 | `GenerationService.load()`, `run()`, `persist(..., terminal, alsoInTx)`, `finalize()` structure               | **[V]** `generation.service.ts:125-165, 167-307, 365-417, 420-519`; terminal failure is logged and the reply is left for the reaper (`:300-305`)                                                                     |
| F12 | `ai_invocations.message_id` is nullable                                                                       | **[V]** `schema.prisma:810`                                                                                                                                                                                          |
| F13 | Messages carry `reply_to_message_id`; fork copies are not marked as copies                                    | **[V]** `schema.prisma:741`; `conversation.service.ts:630-654` copies `role`, content, reply links, with fresh ids and no marker                                                                                     |
| F14 | Regenerate is allowed only on the latest answer                                                               | **[V]** `conversation.service.ts:543-545`                                                                                                                                                                            |
| F15 | `WorkflowStarter` uses `REJECT_DUPLICATE` and treats "already started" as success                             | **[V]** `apps/api/src/infrastructure/temporal/workflow-starter.ts:34-47`                                                                                                                                             |
| F16 | Worker activities: 4xx (≠408/429) → `InternalCallRejected` non-retryable; `ConfigError`; 30 s fetch timeout   | **[V]** `apps/temporal-worker/src/activities/data-rights-activities.ts:31-55`                                                                                                                                        |
| F17 | API `InternalAuthGuard`: HMAC, ±300 s, Redis `SET NX` replay rejection, fail closed                           | **[V]** `apps/api/src/common/internal-auth.guard.ts:17-66`. The same `INTERNAL_SERVICE_HMAC_SECRET` is configured in api, ai-service and voice-agent settings **[V]**                                                |
| F18 | `CONTRACT_VERSION = '2026-11-23.v4'`; request schemas `.strict()`; zod 4.6.7                                  | **[V]** `packages/ai-model-contracts/src/index.ts:14,115-153`; `package.json` pins `zod 4.6.7`                                                                                                                       |
| F19 | ai-service skips its prompt when `messages[0].role == 'system'`; `EXTRACTION` → ECONOMY + `needs_json_schema` | **[V]** `model_router/service.py:122-125`; `model_router/profiles.py:47`; no `response_format`/`json_schema` in `gateway/` other than probe metadata                                                                 |
| F20 | `chat.v4` "don't yet remember other conversations" line and safety rules                                      | **[V]** `prompts/catalog.py:57,63-66`; also "you cannot … save anything" (`:59`), which `chat.v5` must reconcile                                                                                                     |
| F21 | `UsageLimitsService.reserve(userId, key, now, amountMicro)` supports a custom amount                          | **[V]** `apps/api/src/conversation/usage-limits.service.ts:143-148`; the service lives in the **conversation** module                                                                                                |
| F22 | dependency-cruiser forbids cycles and cross-module controller imports                                         | **[V]** `apps/api/.dependency-cruiser.cjs:11-35`                                                                                                                                                                     |
| F23 | Export payload is stored in `consent.data_rights_requests.export_payload`; scrubbed only by `erase_user`      | **[V]** `data-rights.service.ts:217-246`; only `erase_user` sets it NULL (two migration versions)                                                                                                                    |
| F24 | Existing purge function takes caller-supplied `p_now` and retention interval                                  | **[V]** `conversation.purge_expired(p_now, p_event_retention)` `…conversation_phase02/migration.sql:316-333`, EXECUTE granted to runtime                                                                             |
| F25 | Public revoke route and validation error code                                                                 | **[V]** revoke is `PUT /v1/me/consents/:purpose` (`consent.controller.ts:85`); validation code is `VALIDATION_FAILED` → 400 (`api-error.ts:4`)                                                                       |
| F26 | `main` branch protection                                                                                      | **[V-gh]** `GET repos/arvindydv/karen/branches/main/protection` → 404 "Branch not protected" (unchanged since Task 02)                                                                                               |
| F27 | `array_to_tsvector` yields position-less lexemes and `ts_rank_cd` scores them 0                               | **[V-local]** `ts_rank_cd(array_to_tsvector(ARRAY['main','vegetarian','hoon']), to_tsquery('simple','vegetarian')) = 0`; `ts_rank(...) = 0.0608`; `@@` matches; positional vector gives 0.1                          |
| F28 | Devanagari under the `simple` parser                                                                          | **[V-local]** with `LC_CTYPE = en_US.utf8`: `'मेरा घर पुणे में है'` → 5 whole words; `शाकाहारी`, `हूँ` kept intact with matras/chandrabindu. RDS locale **[NV]**                                                             |
| F29 | `pg_trgm` availability                                                                                        | **[V-local]** available 1.6, not installed. RDS **[NV]**                                                                                                                                                             |
| F30 | ADR file naming and index                                                                                     | **[V]** existing ADRs are `NNNN-slug.md`; the new file is `ADR-0036-…md`; `docs/adr/README.md` index stops at 0035                                                                                                   |
| F31 | Mobile onboarding offers `MEMORY_STORAGE`; settings screens exist                                             | **[V]** `apps/mobile/app/(app)/onboarding.tsx:350`; `app/(app)/settings/{privacy,index,…}.tsx`                                                                                                                       |
| F32 | `service-boundaries.md` lists `memory` as a planned module                                                    | **[V]** `docs/architecture/service-boundaries.md:21`                                                                                                                                                                 |

No important **[V]** claim in the architecture was found false. The inaccuracies are minor
(L-01) or are proposals whose feasibility was overstated (H2, H4, H7).

---

## 4. D1–D13 traceability matrix

| #   | Owner condition (§17)                                                                                                                                  | Implemented in                   | Assessment                                                                                                                                                                                                                                                                                        | Renewed approval?                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| D1  | Mock only; Gate 03 cannot pass while Gate 02 NO-GO; no live extraction/embedding without approval                                                      | §0, §7.2, §13.4, M5, M7, ADR §15 | **Met.** One scope expansion: M5 adds gateway JSON-schema request support, which only a live path needs (M-13). Gate 03 is in practice unreachable within M0–M7 (M-07); the doc should say so plainly                                                                                             | No (correction)                           |
| D2  | Rename multimodal plan, banner, ADR-0026 link erratum                                                                                                  | M0                               | **Met (deferred to M0).** `docs/PHASE_03_MULTIMODAL_PLAN.md` still present **[V]**                                                                                                                                                                                                                | No                                        |
| D3  | FTS-first; `pg_trgm` optional after compatibility+eval; embeddings only if measured; test Devanagari/Hinglish                                          | §6.3–6.8, §13.3, M4              | **Met in intent; defective in mechanism.** F2 ranking is broken (H2). Eval design needs to be valid before FTS can be "accepted as sufficient" (M-08)                                                                                                                                             | No                                        |
| D4  | Free catalog only; paid probe needs eval set, non-prod key, verified data policy, separate approval; synthetic                                         | §6.8, M0, ADR open Q2            | **Met.**                                                                                                                                                                                                                                                                                          | No                                        |
| D5  | `MEMORY_STORAGE` = explicit memory; `PERSONALIZATION` = inferred; reconfirm grants **subject to legal review**; view/export/delete without consent     | §3.1, §3.7                       | **Met.** Re-confirmation is feasible without consent code changes (F3). Legal qualification preserved (Q5). Minor: `POST /v1/memory/{id}/undo` of a supersession is a content write without consent (L-05)                                                                                        | No                                        |
| D6  | Stop + suspend immediately; delete-now; 30-day grace **provisional/legal**; re-grant never silently restores                                           | §3.2, §3.3, §11                  | **Mostly met.** (a) The restore card shows a purge **date**, which is a user-facing promise of a provisional duration (H6). (b) In-flight generation continues with already-loaded memory: this reads "immediately" as "next step" under ADR-0019 and needs explicit owner acknowledgement (M-06) | **Yes** — H6 (legal), M-06 (owner)        |
| D7  | Tier 1 only after deterministic span verification; others confirm; no inferences; assistant never a source                                             | §7.1, §7.3, §4.3 triggers        | **Partially met.** Span verification and the assistant-source DB trigger are sound. But the tier-1 "explicit request" check is message-wide and lets negations and questions through (H1)                                                                                                         | No (stricter implementation of D7)        |
| D8  | Flag; default on only with consent and clear UI; ephemeral off by DB constraint; never overrides consent                                               | §3.4, §3.5, §4.3                 | **Met.** Existing threads stay `false` (conservative, documented)                                                                                                                                                                                                                                 | No                                        |
| D9  | Reject sensitive categories; always reject secrets, credentials, IDs, **minors' data**; third-party confirm-only; no exception flow until legal review | §7.3 V5–V11, `items_tier1_self`  | **Partially met.** Minor detection (V6) covers only third parties, not a user stating their own age (M-10). Legal qualification preserved                                                                                                                                                         | **Yes** (legal: scope of "minors' data")  |
| D10 | Temporal + job row in finalize tx; re-check consent+thread; deletion synchronous; extraction counts against limits                                     | §8, §12.3                        | **Met in intent.** Recovery of stuck jobs does not work (H7). Unique-violation handling as described aborts the transaction (M-02). `UsageLimitsService` placement creates a module cycle (M-09)                                                                                                  | No                                        |
| D11 | 12-table FORCE exclusions stay separate; S2 in P03; FORCE on new tables; maintenance preserves isolation                                               | §5, §9.1                         | **Partially met.** S2 and FORCE are in. The maintenance design does not fit the repo's role lifecycle (H4), and its parameters give the runtime role a cross-user deletion capability (H5). FORCE tests run as a superuser are meaningless (M-11)                                                 | **Yes** — H4 (AWS role creation / design) |
| D12 | Categories approved; durations provisional, not promises, **pending legal review**                                                                     | §11                              | **Met in §11, contradicted in §3.3** (H6). Extraction-job rows are a new retention category, correctly flagged for the owner                                                                                                                                                                      | **Yes** — new category; H6                |
| D13 | Protection before first merge; milestone PRs; CI checks; no force push/deletion; admins included; single-maintainer exception; flag off                | §14 M0, ADR rollout              | **Met (deferred to M0).** Protection is still absent **[V-gh]**. The single-maintainer exception wording is Q8                                                                                                                                                                                    | No                                        |

**Unapproved scope** (none is harmful, but each should be explicitly accepted with the ADR):
`memory.user_settings` + "ask before saving" (from the D7 recommendation, not the §17 condition);
restore/undo/activity endpoints; extraction-job retention category; gateway JSON-schema support in
M5 (M-13); per-user caps and the 100-jobs/day limit (provisional numbers).

**Roadmap deviations not recorded as deviations** (M-13): F03-01 per-item "disable"; per-memory
`sensitivity` and `consent purpose` fields; F03-02 retrieval audit metadata (matching confidence,
source date); "token savings" metric; KMS; "Redis memoization only for permitted content" (dropped).

---

## 5. Security and privacy findings (summary)

| Area                                | Result                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Consent checks and revocation races | **Sound.** `decide()` takes `users FOR UPDATE` (F1); TX-A/TX-B take `FOR SHARE` before re-reading the job, so the trigger's cancellation is always seen. A job inserted by `finalize()` concurrently with a revoke is either cancelled by the trigger or skipped at TX-A. Residual: the extraction AI call can start after a revoke commits (M-06) |
| In-flight generation                | Uses context loaded before the revoke (M-06, owner acknowledgement needed)                                                                                                                                                                                                                                                                         |
| Cross-user isolation                | Two layers (explicit `user_id` + FORCE RLS) are sound. Gaps: FKs don't check that the referenced row belongs to the same user (M-03); maintenance function parameters (H5)                                                                                                                                                                         |
| FORCE RLS and grants                | Grants follow the runtime-role pattern (F8). Role creation does not fit the migration→roles order (H4). Tests as a superuser owner prove nothing about FORCE (M-11)                                                                                                                                                                                |
| Maintenance role                    | H4, H5                                                                                                                                                                                                                                                                                                                                             |
| Internal API auth / replay          | Sound (F17). Residual: the HMAC secret is shared with the ai-service, which handles untrusted model output, so it could call the new `run`/`abandon` endpoints (L-06, pre-existing ADR-0007 design)                                                                                                                                                |
| Prompt injection                    | Defence in depth is good (verbatim substring, charset, delimited block, no tools). Gaps: Unicode line/paragraph separators and bidi/format characters are not banned; DB and wire charsets differ; JSON-escaping can turn Devanagari into `\uXXXX` (M-01)                                                                                          |
| SECRET / SENSITIVE / minors         | Deterministic-first, escalate-only model label: correct. Gaps: self-stated minors (M-10); evaluation validity (M-08)                                                                                                                                                                                                                               |
| Export / deletion / erasure         | Erasure plan correct (F7). Gaps: stored export payloads keep deleted memory text (M-04); "delete those too" on thread deletion can silently no-op (M-05); clear vs pending jobs is internally inconsistent (M-12)                                                                                                                                  |
| Logging / telemetry                 | Design is content-free and adds redaction keys; adequate. Python redaction backstop is not in any milestone's file list (L-09)                                                                                                                                                                                                                     |

## 6. Database and transaction findings (summary)

| Area                          | Result                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema and constraints        | Generally strong (CHECKs, partial unique indexes, ephemeral CHECK). Missing same-owner FKs (M-03); DB charset CHECK weaker than the wire schema (M-01); `extraction_jobs` lacks the `policy_version` column that §7.3 says is recorded (L-08)                                                                                                     |
| FK actions under FORCE RLS    | The claim that cascades/SET NULL bypass RLS matches PostgreSQL's RI implementation **[PG]**; prove it in M2. The BEFORE UPDATE source-owner trigger must accept `source_message_id → NULL` during the cascade (L-07)                                                                                                                              |
| Trigger security              | `SECURITY INVOKER` + fixed `search_path` + scope check is correct. The trigger raises on unscoped owner/superuser updates of MEMORY_STORAGE grants, which affects fixtures and operator runbooks (L-07). It fires through Prisma's `upsert` either way (UPDATE or `ON CONFLICT DO UPDATE` with `status` in the SET list) **[PG]**; must be tested |
| Transaction boundaries        | Terminal-transaction additions can fail a finished reply (H3). Mapping unique violations to "duplicate" needs `ON CONFLICT` or savepoints (M-02)                                                                                                                                                                                                  |
| Lock ordering                 | `decide()`: users FOR UPDATE → grants → (trigger) items/jobs. TX-B: users FOR SHARE → job → items: consistent. `finalize()` is safe today only because `message_events`/`ai_invocations` inserts take `KEY SHARE` on users before items would be touched. That is implicit; make it explicit (H3)                                                 |
| Idempotency / duplicates      | `UNIQUE(source_message_id)` + CAS on `version` is correct. Duplicate AI calls are possible on activity timeout (cost only, mock = 0)                                                                                                                                                                                                              |
| Pending-job cancellation      | Trigger and FK cascades are correct. Stuck `pending`/`running` jobs never expire and cannot be re-kicked (H7)                                                                                                                                                                                                                                     |
| Restore and conflicts         | Rules are well defined; they rely on partial unique indexes → same `ON CONFLICT` caveat (M-02)                                                                                                                                                                                                                                                    |
| Migration and rollback safety | Expand-only, `BEGIN;…COMMIT;` compatible. A `CREATE ROLE` in a migration conflicts with the shadow-DB replay and with the role order (H4). Use `ADD CONSTRAINT … NOT VALID` + `VALIDATE` for the thread CHECK if production threads ever exist (pre-production now: Low)                                                                          |

## 7. Retrieval and AI-integration findings (summary)

| Area                    | Result                                                                                                                                                                                                                                                                                                                  |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FTS-first               | Right choice under D3. F2 + `ts_rank_cd` always scores 0 (H2, [V-local])                                                                                                                                                                                                                                                |
| Hindi / Devanagari      | Locally the `simple` parser keeps Devanagari words with matras intact (F28), so F1 is viable on `en_US.utf8`. RDS locale is still unknown (Q2)                                                                                                                                                                          |
| Hinglish / cross-script | FTS cannot match across scripts. The always-include set covers only preferences and pinned items, not facts or events. "Reported, < 0.60 feeds §6.8" is honest; the owner should know cross-script fact recall is expected to be weak in P03                                                                            |
| Ranking and budgets     | Deterministic and testable. `LIMIT 60` ordered by `lexical DESC` loses lexical hits once lexical is 0 (H2). `MEMORY_CONTEXT_MAX_ITEMS` names both the wire ceiling (20) and the API budget (12) (L-01)                                                                                                                  |
| Contract v5             | Shape is good (strict, optional, opaque refs). Because the request schema is strict, one stored item that fails the item schema fails the whole chat request (M-01). `off_feature` is in the domain status but not in `MEMORY_STATUSES` (L-01). Zod 4 deprecates `z.string().date()` in favour of `z.iso.date()` (L-01) |
| Prompt rendering        | Single delimited block, data-not-instructions: good. Must reconcile the existing "you cannot … save anything" line (F20). Rendering must not use ASCII-only JSON escaping (M-01)                                                                                                                                        |
| Retrieval failure       | Fails open to `unavailable`, chat continues: correct                                                                                                                                                                                                                                                                    |
| Evaluation thresholds   | Not yet meaningful (M-08). "Edit/delete reflected in next response" is ambiguous while the same thread's history still contains the statement (M-07)                                                                                                                                                                    |

## 8. Extraction and workflow findings (summary)

| Area                            | Result                                                                                                                                                                                                            |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transactional job creation      | Correct in principle; savepoint behaviour inside Prisma interactive transactions is **[NV]** (M-02)                                                                                                               |
| IDs-only workflow input/history | Correct (`{ jobId }`, outcome codes)                                                                                                                                                                              |
| Retry behaviour                 | Matches the worker's error classes (F16). The 30 s activity HTTP timeout (F16) is shorter than the 90 s activity timeout, so a slow API step is retried while still running; CAS handles it, at duplicate AI cost |
| Cancellation / revocation       | Correct via trigger + TX-B re-check. Clear vs pending jobs is inconsistent (M-12)                                                                                                                                 |
| Deterministic validation        | V1–V12 order is right (secret detection on the whole message, escalate-only). Tier-1 trigger binding is weak (H1)                                                                                                 |
| Source-span verification        | V2/V3 verbatim checks are strong. Manual create and "confirm with edited text" bypass V2/V3 by design: label provenance accordingly                                                                               |
| Assistant-message exclusion     | DB trigger on `role = 'user'`: strong. Fork copies are user-role rows with no marker (F13); exclusion currently relies on "regenerate latest only" (F14) — add a test (L-04)                                      |
| Usage accounting                | Reserve with custom amount is supported (F21). Ledger `requests` counter would mix chat and extraction (L-10). Module placement (M-09)                                                                            |
| Recovery                        | Broken for closed workflows (H7)                                                                                                                                                                                  |

---

## 9. M0–M7 milestone assessment

| M   | Verdict                     | Missing dependencies / sequencing                                                                                                                                      | Missing tests / non-objective criteria                                                                                                                                                                                               | Needs approval                                                      | Split / reorder                                                                                                                                                                                           |
| --- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0  | Sound                       | Add: High findings corrected in architecture + ADR before acceptance; ADR file renamed (L-02); Q8 decided                                                              | Acceptance should list the exact required status checks returned by the protection API, not just "returns the rules"                                                                                                                 | Owner (GitHub settings, ADR, D1 written approval, Q8)               | —                                                                                                                                                                                                         |
| M1  | Sound                       | —                                                                                                                                                                      | "Lexicon coverage in three languages" is not objective: set minimum labelled cases per category per language. Add trigger negation/question/proximity cases (H1). Confirm a coverage tool exists for "100% branch coverage" **[NV]** | Legal review of the category list is a release gate, not an M1 gate | —                                                                                                                                                                                                         |
| M2  | **Blocked as written** (H4) | Q4 role lifecycle; Q6; same-owner FKs (M-03); the Q4 decision must precede the migration                                                                               | FORCE tests need a non-superuser table-owner role (M-11); test the trigger through `ConsentService.decide()` (upsert path) and through the AI_PROCESSING cascade; test FK SET NULL under FORCE                                       | Owner/infra (role creation in AWS or alternative design)            | **Split:** M2a schema + owner RLS + triggers + `erase_user` + grants; M2b maintenance functions/role (after the Q4 decision)                                                                              |
| M3  | Sound with additions        | Decide Q7, Q12 (server-side option, M-05), Q14, Q16 (M-12) first; export-payload handling (M-04)                                                                       | Add: clear-by-conversation when the thread is already deleted; undo version guards (L-05); feature-flag-off matrix for every route                                                                                                   | Owner: Q12 default/copy                                             | —                                                                                                                                                                                                         |
| M4  | Sound with corrections      | H2 must be fixed in the design; M-01 retrieval-side filtering                                                                                                          | "Thresholds met **or** reported not sufficient" is objective only once Q9 thresholds exist and the dataset is frozen with a held-out split (M-08). p95 on local docker is not an RDS figure (L-09)                                   | Q9 before M7, not M4                                                | **Split recommended:** M4a contract v5 + `chat.v5` + S2 consent re-check (S2 is independent and owner-mandated by D11; it can land first); M4b retrieval + eval harness                                   |
| M5  | Sound with corrections      | H3, H7, M-02, M-09 resolved in design; Q10                                                                                                                             | Add: stuck-job expiry test; lock-ordering test with concurrent `decide()` + `finalize()`; replay test of the internal run endpoint; Python redaction test (L-09)                                                                     | —                                                                   | **Split recommended:** M5a ai-service extract endpoint + mock extractor + contract fixtures; M5b API job/run step + worker. **Drop** gateway JSON-schema support until live extraction is approved (M-13) |
| M6  | Sound                       | Legal copy for consent notice, refusal copy and purge-date wording (H6, Q5) gates **release**, not implementation; draft notices locally via `ALLOW_DRAFT_NOTICES` [V] | "Accessibility labels" needs a concrete check (e.g. every interactive element has `accessibilityLabel`)                                                                                                                              | Owner/legal for copy; Q12, Q15                                      | —                                                                                                                                                                                                         |
| M7  | Needs re-scoping            | Gate 03 needs Gate 02 GO, live extraction approval and a human-reviewed live set (M-07)                                                                                | Rephrase acceptance as "evidence package complete; Gate 03 status recorded (expected NOT PASSED)"                                                                                                                                    | Owner: Q9; live-run approval if Gate 03 is to be attempted          | —                                                                                                                                                                                                         |

Missing from every milestone: dashboards/alerts named in the ADR "Operational consequences"
(assign to M5 or M7); `docs/database/future-entities.md` and `pgvector.md` updates for the
embedding deferral (M2).

---

## 10. Q1–Q16 resolution classification

| Q   | Topic                                     | Classification                                                                                             | Evidence / note                                                                                                                                   |
| --- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Live JSON-schema support                  | **Blocks release / production enablement** (live extraction approval)                                      | Gateway has no `response_format` [V]; not needed for mock                                                                                         |
| Q2  | Devanagari parsing under RDS `LC_CTYPE`   | **Blocks M4** (FTS choice). Partly answered: works locally on `en_US.utf8` [V-local]; RDS [NV]             | F28                                                                                                                                               |
| Q3  | `pg_trgm` on RDS PG17                     | **Can remain a documented limitation** unless F2/F1 fail the Hinglish slice; then **blocks the F3 PR**     | Available locally 1.6, not installed [V-local]                                                                                                    |
| Q4  | Maintainer role creation in AWS           | **Blocks ADR acceptance** (the ADR must commit to a design that fits the repo's role lifecycle) **and M2** | F9, F10, H4. Wider than stated: it is a role-_lifecycle_ issue, not only a privilege issue                                                        |
| Q5  | Notice text, version, eligible versions   | **Blocks release** (M6 shipping to any user); not implementation                                           | D5 legal qualification                                                                                                                            |
| Q6  | Suspension audit row from trigger         | **Blocks M2**                                                                                              | Runtime role has `INSERT` on `audit.audit_events` [V], so the trigger can write it                                                                |
| Q7  | Export format v1 additive vs v2           | **Blocks M3**                                                                                              | —                                                                                                                                                 |
| Q8  | Single-maintainer exception wording       | **Blocks M0** (and therefore all implementation)                                                           | D13                                                                                                                                               |
| Q9  | Provisional thresholds                    | **Blocks Gate 03 / M7 acceptance**; dataset rules (M-08) should be fixed before M4                         | —                                                                                                                                                 |
| Q10 | Extraction for failed/canceled replies    | **Blocks M5**                                                                                              | Note: regenerate of a failed reply finalizes a new reply to the same user message, so a later success still enqueues (one job per source message) |
| Q11 | `MEMORY_EXTRACTION_RESERVE_USD` for live  | **Blocks release** (live approval)                                                                         | —                                                                                                                                                 |
| Q12 | Thread deletion keeps memories by default | **Blocks M3** (the server-side option, M-05) **and M6** (copy/default)                                     | —                                                                                                                                                 |
| Q13 | Context-dependent "yes, remember that"    | **Can remain a documented limitation**                                                                     | Must appear in user-facing help so the failure is not silent                                                                                      |
| Q14 | `PERSONALIZATION` revocation effect       | **Can remain a documented limitation** (none in P03, consistent with D5)                                   | —                                                                                                                                                 |
| Q15 | 12-month reconfirm prompt                 | **Blocks M6** only (UI); D12 approval leaves it open                                                       | —                                                                                                                                                 |
| Q16 | `clear` cancels pending jobs              | **Blocks ADR acceptance** (deletion semantics; the document contradicts itself, M-12)                      | §8.6 already says "→ canceled"                                                                                                                    |

---

## 11. Findings (ranked)

### High

**H1 — Tier-1 explicitness check is message-wide and does not handle negation or questions**

- **Where:** §7.3 V10; ADR Decision 7; D7.
- **Evidence:** V10 promotes a candidate to tier 1 when `explicit_request` (model-asserted) ∧ a
  trigger phrase "occurs in the message". The trigger is not bound to the candidate's span or
  clause, and is not negation- or question-aware. "Remember to call mom. Also I hate cilantro"; "you
  don't need to remember this, but I'm in Delhi"; "do you remember I'm vegetarian?" all contain a
  trigger. The model flag is the only other guard, and §15 principle 1 says model output is never
  authority.
- **Why it matters:** D7 allows auto-store only for explicit requests verified by the server. The
  zero-tolerance metric "tier-1 writes for non-explicit messages = 0" (§13.4) would rest on the
  model.
- **Resolution:** Make the deterministic rule self-sufficient. Tier 1 only if (a) the trigger
  phrase and `source_span` are in the same sentence/clause (deterministic sentence split for
  EN/HI/Hinglish incl. `।`), (b) no negation token from a versioned list scopes the trigger
  ("don't/do not/na/mat/नहीं/मत"), (c) the clause is not interrogative (`?`, `kya`, `क्या` question
  patterns), (d) `remind me` ≠ `remember`. Otherwise tier 2. Add these cases to the M1 unit tests
  and the §13.4 set.
- **Owner approval:** No.

**H2 — Proposed F2 ranking always scores zero; lexical hits can be dropped by `LIMIT 60`**

- **Where:** §6.3 (F2 `array_to_tsvector`), §6.4 SQL (`ts_rank_cd`), §6.5.
- **Evidence:** [V-local] `ts_rank_cd(array_to_tsvector(ARRAY['main','vegetarian','hoon']),
to_tsquery('simple','vegetarian'))` = **0**; `ts_rank` = 0.0608; a positional `to_tsvector` gives 0.1.
  `array_to_tsvector` produces position-less lexemes, which `ts_rank_cd` ignores **[PG]**.
- **Why it matters:** With `lexical = 0` for every row, the candidate query orders by
  `pinned DESC, updated_at DESC`. When a user has more than 60 pinned/preference/recent/lexical
  candidates, older lexical matches are cut, which directly lowers recall@5. `lexicalNorm` in §6.5
  is always 0, so the M4 evaluation would measure a different algorithm than designed.
- **Resolution:** Either (a) write positional vectors (e.g. build `'tok':1 'tok2':2 …` and cast to
  `tsvector`, or `to_tsvector('simple', joined_tokens)` after app-side normalisation), or (b) use
  `ts_rank`, or (c) compute the lexical score in TypeScript from the tokens (the scorer is already in
  TS), using SQL only for the owner-filtered `@@` match. Order the candidate SQL so every `@@` match
  is kept before non-matching always-include rows. Add a unit/integration test asserting a non-zero
  lexical score.
- **Owner approval:** No.

**H3 — Memory writes inside the terminal transaction can fail a completed reply**

- **Where:** §2.3 item 4, §9.1 `finalize()` row, §9.4; `generation.service.ts:300-305, 420-519` [V].
- **Evidence:** `finalize()` commits the terminal event, `ai_invocations` and the usage ledger in
  one transaction; any error there is logged as "Terminal write failed" and the reply is left for the
  reaper (F11). The design adds `memory.access_events` inserts (FK `item_id NOT NULL → items`) and
  `last_used_at` updates to this transaction. Only `enqueueInTx` has a savepoint. If the user deletes
  a memory while the answer streams (exactly the Gate 03 "delete reflected" scenario), the FK insert
  fails and the completed reply and its ledger entry are lost. `last_used_at` updates also take row
  locks on `items`; deadlock freedom against `decide()` then depends on `message_events` and
  `ai_invocations` having already taken `KEY SHARE` on `identity.users` — true today, but implicit.
- **Why it matters:** A memory problem must never break chat completion (§9.4's own principle). It
  also creates a lock-order dependency nobody would notice in review.
- **Resolution:** In the terminal transaction, write access events with
  `INSERT … SELECT … FROM memory.items WHERE id = ANY($ids) AND user_id = $u AND status = 'active'`
  (deleted items are skipped). Put access events and the job insert behind one savepoint. **Drop**
  `last_used_at` writes from `finalize()`: derive "last used" from `access_events`, or update it in
  a separate post-commit transaction that first takes `identity.users FOR SHARE`. State the lock
  order as an invariant ("users lock first, then memory rows") and test concurrent
  `decide(revoke)` + `finalize()`.
- **Owner approval:** No.

**H4 — Maintainer-role design does not fit the repository's role lifecycle**

- **Where:** §5.2, §5.3, Q4, M2; ADR Decision 11 and Operational consequences.
- **Evidence:** Roles are created only by `infra/database/roles.sql`, which an operator runs
  **after** `prisma migrate deploy` (F9). A migration containing `CREATE POLICY … TO
karen_memory_maintainer` fails on a fresh database unless the migration itself creates the role.
  Roles are cluster-global, and CI replays migrations into `karen_shadow` in the same cluster
  (`ci.yml:75-78`), so an unguarded `CREATE ROLE` fails on the second database. `ALTER FUNCTION …
OWNER TO` needs the migration role to be able to `SET ROLE` to the maintainer **[PG, PG16+]**,
  which contradicts "no members". Locally the owner is a superuser (F10), so every one of these
  problems is hidden until AWS.
- **Why it matters:** M2 cannot be implemented as specified. A green local/CI run would not predict
  the AWS outcome.
- **Resolution:** Decide in the ADR before acceptance. Recommended: **avoid a new role**. Make the
  purge function loop over affected `user_id`s and `set_config('karen.user_id', uid, true)` per user
  (the D11 "per-user scoping in the function" option, already the `erase_user` pattern, F7), so only
  the owner policy is used and FORCE stays intact. If a role is kept: create it idempotently
  (`DO $$ IF NOT EXISTS … $$`) in the migration, document the shadow-DB behaviour, grant temporary
  membership for the ownership transfer, revoke it in the same migration, add the role to
  `roles.sql`'s "hard guarantees", and test in CI with a **non-superuser** owner.
- **Owner approval:** **Yes** (infra: role creation in AWS, or approval of the per-user-scope
  alternative).

**H5 — Caller-controlled `p_now` / `p_suspension_grace` let the runtime role purge every user's suspended memories**

- **Where:** §5.2 (`GRANT EXECUTE … purge_expired(timestamptz, interval) TO karen_api_runtime`),
  §5.3 functions and policies.
- **Evidence:** The maintainer policy exposes **all** suspended items of all users
  (`status = 'suspended'`); the grace window is applied only inside the function, from
  caller-supplied parameters. A runtime-role caller (bug or injection on the request path) passing
  `p_suspension_grace = '0'` hard-deletes every user's suspended memories inside their grace window,
  which D6 promises can be restored. The existing `conversation.purge_expired` has the same
  parameter pattern (F24), so the precedent is not a safeguard.
- **Why it matters:** D11: "Maintenance access must preserve tenant isolation". This is a
  cross-user, irreversible deletion capability on the request-path role.
- **Resolution:** Functions take no time or interval parameters. Use `now()` and a grace floor kept
  in the database (constant in the function body, or a `memory.config` row writable only by the
  owner). Or clamp: `p_now <= now()` and `p_suspension_grace >= floor`. Put the grace predicate in
  the policy itself (`status = 'suspended' AND suspended_at < now() - interval '<floor>'`). Add a
  test: calling with grace 0 deletes nothing within the floor. Raise the same issue for
  `conversation.purge_expired` in the separate D11 hardening track.
- **Owner approval:** No.

**H6 — The restore card shows a purge date: a user-facing promise of a provisional duration**

- **Where:** §3.3 ("they will be deleted on DD/MM/YYYY"; "The policy is stated in the consent
  notice and the card"), `GET /v1/memory/status` `suspended_purge_on`; versus §11 header ("must not
  appear in product copy as guarantees until legal review"), D6 and D12 qualifications.
- **Evidence:** The two sections contradict each other. D6 also requires "a clear, user-visible
  policy" for re-grant, so the date cannot just be removed.
- **Why it matters:** The owner's qualifications say the 30-day grace and all durations are not
  legally approved and not user-facing promises.
- **Resolution:** State in §3.3 and M6 that purge-date copy (and every duration in the notice,
  refusal and thread-deletion copy) is **legal-gated**. Until legal approval, the card says the
  memories "will be deleted automatically after a grace period unless you restore them", without a
  date or duration, and the API field stays internal or is marked provisional. Add "legal approval
  of duration copy" to the release conditions (§15 below).
- **Owner approval:** **Yes** (owner + legal: wording and whether any date may be shown before
  legal review).

**H7 — Stuck extraction jobs cannot be recovered and never expire**

- **Where:** §8.3, §8.5 step 1, §4.3 `extraction_jobs` (`expires_at` set only when terminal).
- **Evidence:** `WorkflowStarter` uses `REJECT_DUPLICATE` (F15): a workflow id can never be reused
  while the closed execution is retained **[PG/Temporal]**. If the workflow failed (for example
  `abandon` also failed, or a worker bug), the job stays `pending`/`running`. The sweep's re-kick is
  then rejected as "already started" and logged as success, every interval, forever. The claim
  "jobs stuck running … are moved back to pending by the run step's attempt check" requires a run
  step that never happens. Non-terminal rows have no `expires_at`, so the purge never removes them.
- **Why it matters:** Silent permanent backlog, misleading "success" logs, and chips stuck on
  "pending" (M6 risk).
- **Resolution:** The sweep terminates jobs it cannot restart: any non-terminal job older than a
  bound (e.g. `created_at < now() − MEMORY_JOB_MAX_AGE`) is set `failed/abandoned_stale` through the
  maintenance function (content-free rows), with a metric. Re-kick only jobs with no recorded start
  (add `workflow_started_at`), or use `ALLOW_DUPLICATE_FAILED_ONLY` for this workflow type (a
  documented exception to the starter's policy). Add an integration test with `ManualWorkflowStarter`.
- **Owner approval:** No.

### Medium

**M-01 — One malformed memory can fail every chat turn; charset rules differ across layers**

- **Where:** §2.4 schemas, §4.3 CHECKs, §9.3 rendering.
- **Evidence:** `completionRequestSchema` is `.strict()` (F18) and the context item schema is strict
  with regexes. The DB CHECK on `value_text` bans only `\r\n\t<>`{}`; the wire regex also bans other
C0 controls. `subject_label`: wire `^[\p{L}\p{M} ]{1,40}$`, extraction `max(40)` only, DB no
charset check, so "Mr. Rao" or "sister's" can be stored and then fail the v5 request. Neither
layer bans U+2028/U+2029/U+0085 (line separators), bidi overrides or zero-width (`Cf`) characters,
which can break the "one line" property in the rendered block. Python `json.dumps`defaults to`ensure_ascii=True`, which renders Devanagari as `\uXXXX` (quality loss for Hindi users) **[PG-like
  library behaviour; not tested here]**.
- **Why it matters:** One bad row persistently breaks chat for that user (`VALIDATION_ERROR` every
  turn), and the injection defences have holes at the Unicode level.
- **Resolution:** One shared character policy in `@karen/domain` used by API validation, a matching
  DB CHECK (or trigger), and the contract: ban `\p{Cc}`, `\p{Cf}`, `\p{Zl}`, `\p{Zp}` plus the
  delimiter set, and apply the same rule to `subject_label`. Retrieval validates each item against
  the wire schema and **drops** (and counts) failures instead of sending them. Render with
  `ensure_ascii=False` after the character policy has run.
- **Owner approval:** No.

**M-02 — "Unique violation mapped to duplicate" aborts the transaction in PostgreSQL**

- **Where:** §4.6 last paragraph, §8.4 step 5, §8.2 savepoint, §3.3 restore.
- **Evidence:** In PostgreSQL a unique violation puts the transaction in an aborted state; nothing
  else can run until a rollback to a savepoint **[PG]**. As written, one duplicate candidate would
  roll back the whole TX-B (other candidates and the job completion). Savepoints inside Prisma
  interactive transactions are **[NV]**.
- **Resolution:** Use `INSERT … ON CONFLICT (user_id, kind, slot, value_key) WHERE status = 'active'
DO NOTHING RETURNING id` (partial-index inference) for items and suggestions, and treat "no row
  returned" as duplicate. For single-slot supersession, lock the existing row (`FOR UPDATE`) before
  deciding. Prove `SAVEPOINT`/`ROLLBACK TO SAVEPOINT` via `tx.$executeRaw` in an M5 integration test
  before relying on it in `finalize()`.
- **Owner approval:** No.

**M-03 — Cross-table ownership is claimed but not enforced**

- **Where:** §4.4 ("checked by triggers … item owner of a revision/access event via FK + same
  `user_id`"), §4.3 DDL.
- **Evidence:** The DDL has single-column FKs: `item_revisions.item_id`, `access_events.item_id`,
  `access_events.reply_message_id`, `suggestions.conflicts_with_item_id`, `extraction_jobs.thread_id`
  and `reply_message_id`. FK checks bypass RLS **[PG]**, so a row scoped to user A can reference user
  B's item or message; no trigger in the DDL checks `user_id` equality (only `source_message_id` has
  one).
- **Resolution:** Add `UNIQUE (id, user_id)` on `memory.items` and use composite FKs
  `(item_id, user_id) → items(id, user_id)`. Extend the owner trigger to `thread_id` /
  `reply_message_id` (and check that the job's source message belongs to `thread_id`). Add §5.5
  tests for each reference. Correct §4.4.
- **Owner approval:** No. **Blocks ADR acceptance** (the ADR states the isolation guarantee).

**M-04 — Stored data exports keep deleted memory text**

- **Where:** §10.2–10.3; `data-rights.service.ts:217-246` [V].
- **Evidence:** `collect()` output is stored in `consent.data_rights_requests.export_payload` until
  erasure; expiry stops serving it but does not scrub it (F23). After this change the payload holds
  memory text. Deleting a memory (or clearing all) leaves its text in any stored export. The §10.3
  checklist omits this copy. The same gap already exists for messages.
- **Resolution:** Add the row to §10.3. Either scrub `export_payload` at expiry (maintenance) and
  document the window, or have memory delete/clear also invalidate unexpired exports. Disclose it in
  copy (legal-gated).
- **Owner approval:** No (legal for the copy).

**M-05 — "Delete those too" on thread deletion can silently do nothing**

- **Where:** §3.6 thread deletion, §8.6, Q12.
- **Evidence:** `items.source_thread_id … ON DELETE SET NULL`. If the app deletes the thread first
  and then calls `clear {scope:'conversation'}`, the items no longer reference the thread and
  nothing is deleted. Two client calls give no ordering guarantee across retries.
- **Resolution:** Server-side atomic option: `DELETE /v1/conversations/{id}?delete_memories=true`
  (or a memory-owned endpoint the conversation service calls in the same transaction) that clears
  items with that `source_thread_id` before the thread delete. Add a test.
- **Owner approval:** Yes, together with Q12 (default and copy).

**M-06 — Two places where processing continues after a revoke commits**

- **Where:** §3.2 "Generation in flight" row; §8.4 steps 1→3; D6 "Stop processing immediately".
- **Evidence:** (a) An answer already streaming keeps using memory loaded before the revoke (per
  ADR-0019 "next request/step" **[D]**). (b) After TX-A commits, the extraction AI call can start
  after the user revoked; only the write is blocked. Neither is unsafe for storage, but both are a
  reading of "immediately".
- **Resolution:** Record the interpretation explicitly in the ADR ("immediately" = no new
  retrieval, extraction call or write starts after the revoke commits; an answer already streaming
  may finish). Optionally re-check consent (`hasActiveConsent`) immediately before the AI call in
  step 3, and abort in-flight generations whose user revoked `AI_PROCESSING` (`abortLocal`, [V],
  single-instance only).
- **Owner approval:** **Yes** (owner acknowledges the interpretation under D6). **Blocks ADR
  acceptance.**

**M-07 — Gate 03 is not reachable within M0–M7, and one Gate 03 criterion is ambiguous**

- **Where:** §13.3, §13.4, M7; `karen_phases.md` Gate 03 [V]; D1.
- **Evidence:** Gate 03 requires a "human-reviewed memory extraction set" passing a quality
  threshold. §13.4 marks live precision/recall NOT EVALUATED until live extraction is approved, and
  D1 bars Gate 03 while Gate 02 is NO-GO. "Edit/delete reflected in the next response" is not
  defined. The same thread's history still contains "remember I'm vegetarian", so the model can
  repeat it after the memory is deleted (§1.3 separates memory from history, but the gate test does
  not).
- **Resolution:** State in §14 M7 and the ADR that Phase 03 as planned ends with Gate 03 **NOT
  PASSED (blocked on Gate 02, live extraction approval, human review)**. Define the
  deletion-reflection test: next response in a **different** thread, with retrieval logs
  (`access_events`) proving the item was not sent; same-thread history is out of scope and
  disclosed in the UI.
- **Owner approval:** **Yes** (definition of the gate test). **Blocks ADR acceptance.**

**M-08 — Evaluation thresholds are not yet meaningful**

- **Where:** §13.3, §13.4, Q9.
- **Evidence:** Datasets, lexicons and normaliser will be written by the same people, from the same
  examples, and evaluated on the mock pipeline. "SENSITIVE stored = 0" and "≥ 98 % detection by
  lexicon alone" cannot both be measured on the mock unless the mock labels sensitivity (then it is
  measuring itself). Recall@5 is reported while 12 items are sent. There are no per-slice minimum
  counts or confidence intervals. "≥ 40 users × 20–60 memories, ≥ 400 queries" spread over 8+
  slices leaves some slices at ~50 queries, where 0.80 ± ~0.11 (95 % CI) cannot tell pass from fail.
- **Resolution:** Freeze a **held-out** test split, authored separately from the lexicon/tokeniser
  work and versioned before tuning. Set minimum queries per slice (e.g. ≥ 150 for every
  threshold-bearing slice) and report Wilson intervals. Report recall@5 **and** "recall within the
  sent context". On the mock, report the deterministic-layer detection rate only, and mark "stored =
  0" as a property of the pipeline on that set, not a production guarantee. Name the residual risk
  (lexicon false negatives in production).
- **Owner approval:** Yes (part of Q9).

**M-09 — Usage accounting creates a module cycle**

- **Where:** §5.4 dependency rules, §8.4 steps 2/6, §12.3; F21, F22.
- **Evidence:** `UsageLimitsService` lives in `src/conversation/`. Memory must import it; the
  conversation module must import memory's retrieval/job services. File-level depcruise may pass,
  but the NestJS module graph becomes circular (`forwardRef`), against the "no cycles" intent.
- **Resolution:** Move usage limits to their own module (e.g. `src/usage/`, listed in
  `service-boundaries.md`) in an M5 preparatory refactor, or have the conversation module provide
  an interface token that memory consumes. Update §5.4 and the M5 file list.
- **Owner approval:** No.

**M-10 — Minors' data: only third-party children are detected**

- **Where:** §7.3 V6; D9 ("always reject … minors' data"); ADR-0019 (no children's features before
  legal review) **[D]**.
- **Evidence:** V6 triggers only for `subject = 'third_party'`. A user stating "I'm 15" or "class
  9 mein hoon" is not covered, and nothing in the design consults account-level age (none exists
  [A]).
- **Resolution:** Extend V6 to self-subject age/school-grade statements under 18 (reject and do not
  store). Raise with legal whether a self-declared minor account must disable memory entirely.
- **Owner approval:** **Yes** (legal: scope of "minors' data").

**M-11 — FORCE-RLS tests would run as a superuser and prove nothing**

- **Where:** §5.5 item 5 and item 6, §13.1, M2 acceptance.
- **Evidence:** The local/CI owner `karen` is a superuser (F10); superusers bypass RLS even with
  FORCE **[PG]**. "As the owner role without scope, `SELECT count(*) FROM memory.items` returns 0"
  fails or must be skipped; the Q4 privilege question cannot be exercised either.
- **Resolution:** In integration setup, create a non-superuser, non-BYPASSRLS role that owns the
  memory objects (or `SET ROLE` to one in the test) and run items 5–6 and the maintainer tests as
  that role. Alternatively test FORCE via a `SECURITY DEFINER` probe owned by a non-superuser.
- **Owner approval:** No.

**M-12 — Clear vs pending extraction jobs is contradictory**

- **Where:** §8.6 ("pending jobs of that scope → `canceled`"), §8.4 last paragraph and Q16 (open,
  "recommended yes"), §13.2 item 10 ("if Q16 approved").
- **Evidence:** The document asserts and questions the same behaviour. "Pending jobs of that scope"
  is undefined for `scope = kind` (a job's kind is unknown before extraction).
- **Resolution:** Adopt Q16 = yes in the ADR. `clear all` cancels all of the user's pending/running
  jobs; `clear conversation` cancels that thread's jobs; `clear kind` cancels none (document). The
  run step's TX-B already respects cancellation.
- **Owner approval:** No (engineering default), but it **blocks ADR acceptance** because it is a
  deletion guarantee.

**M-13 — Unrecorded roadmap deviations and one D1 scope expansion**

- **Where:** §4.1 deviations list, ADR "Considered alternatives", M5 scope; `karen_phases.md`
  PHASE 03 [V].
- **Evidence:** Not recorded as deviations: per-item "disable" (F03-01); per-memory `sensitivity`
  and `consent purpose` fields (F03-01); retrieval audit metadata "matching confidence … source
  date" (F03-02; `access_events` stores rank and reason only); "token savings" metric (F03-02); KMS
  and "Redis memoization only for permitted content" (Tech line). M5 builds gateway JSON-schema
  support that only live extraction (not approved, D1) would use.
- **Resolution:** Add each to §4.1 / the ADR as an explicit deviation with a reason (most are
  "not needed while verbatim-only and sensitive-rejecting"). Move gateway JSON-schema work to the
  live-extraction approval package.
- **Owner approval:** **Yes** (roadmap deviations, as D3 was). **Blocks ADR acceptance.**

### Low

| ID   | Where                              | Evidence                                                                                                                                                                                                                                                                                                                                                                          | Resolution                                                                                                                                         | Owner? |
| ---- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| L-01 | §2.4, §3.2, §3.4, §6.6, §7.4       | Revoke route is `PUT /v1/me/consents/:purpose` (F25), not `POST /v1/consent/...revoke`; validation error is `VALIDATION_FAILED`/400, not `422 VALIDATION_ERROR`; request id `memx_<job>` vs `memx_<job>_<attempt>`; `MEMORY_CONTEXT_MAX_ITEMS` names both 20 and 12; `off_feature` missing from `MEMORY_STATUSES` (or from the DTO enum); `z.string().date()` deprecated in zod 4 | Correct references; rename the env var `MEMORY_CONTEXT_BUDGET_ITEMS`; separate wire and DTO status enums; use `z.iso.date()`                       | No     |
| L-02 | `docs/adr/ADR-0036-…md`            | Convention is `NNNN-slug.md`; README index not updated (F30)                                                                                                                                                                                                                                                                                                                      | Rename to `docs/adr/0036-personal-memory-architecture.md` and index it at acceptance (M0)                                                          | No     |
| L-03 | §3.2 "Consent expiry by time", §11 | No code sets grant `expires_at` or `EXPIRED` (F4); the maintainer policy cannot update active items, so "suspension … via maintenance" is not implementable as designed                                                                                                                                                                                                           | State that time-based expiry is unused today; eligibility (`expires_at > now()`) already stops use; drop the maintenance-suspension claim          | No     |
| L-04 | §7.1, §8.2                         | Fork copies are user-role rows with no marker (F13); exclusion relies on "regenerate latest only" (F14)                                                                                                                                                                                                                                                                           | Add an integration test (fork, then attempt regenerate on a copied reply → no job); consider `copied_from_message_id` later                        | No     |
| L-05 | §3.6 undo, §3.7                    | Undo of a supersession writes old text back without consent and with no version guard; undo has "no time limit" but revisions expire at 30 days                                                                                                                                                                                                                                   | Undo of supersession requires eligible consent and `item.version` equal to the version the save produced; after revision expiry undo → delete only | No     |
| L-06 | T6, §8.3                           | `INTERNAL_SERVICE_HMAC_SECRET` is shared by api, ai-service and voice-agent (F17); the ai-service could call memory `run`/`abandon`                                                                                                                                                                                                                                               | Record as residual under ADR-0007; long-term per-caller keys. Endpoints already re-check everything                                                | No     |
| L-07 | §3.2 trigger, §4.3 notes           | Trigger raises on unscoped owner/superuser updates of MEMORY_STORAGE grants (fixtures, manual operator fixes); BEFORE UPDATE owner trigger fires during FK `SET NULL`                                                                                                                                                                                                             | Runbook note; tests set scope; owner trigger: `IF NEW.source_message_id IS NULL THEN RETURN NEW` and `UPDATE OF source_message_id`                 | No     |
| L-08 | §7.3, §4.3                         | `MEMORY_POLICY_VERSION` "recorded on the job outcome" but no column; activity → item mapping relies on `source_message_id`, which becomes NULL after thread deletion                                                                                                                                                                                                              | Add `policy_version` to `extraction_jobs`; document activity semantics after thread deletion                                                       | No     |
| L-09 | §6.7, §12.2, M3/M5 file lists      | p95 measured on local docker is not an RDS figure; Python redaction backstop and dashboards are in no milestone                                                                                                                                                                                                                                                                   | Label p95 "local"; add `core/redaction.py` to M5 and dashboards/alerts to M7                                                                       | No     |
| L-10 | §12.3                              | `recordInLedger` increments `requests` (F21); extraction would inflate chat request counts                                                                                                                                                                                                                                                                                        | Count extraction separately (or document the combined meaning)                                                                                     | No     |
| L-11 | §3.4                               | Behaviour of create/patch with `memory_enabled: true` while the feature flag is off is unspecified                                                                                                                                                                                                                                                                                | Specify: ignored → `false` (or `404` consistent with write routes)                                                                                 | No     |

---

## 12. Exact recommended corrections (by file and section)

`docs/phase-03/PHASE_03_MEMORY_ARCHITECTURE.md`:

1. **§6.3, §6.4, §6.5** — replace `array_to_tsvector` + `ts_rank_cd` with a positional vector, `ts_rank`
   or TS-side scoring; make candidate ordering keep every `@@` match (H2).
2. **§7.3 V10** — clause-bound, negation- and question-aware trigger rule; list the new test cases
   (H1).
3. **§2.3 item 4, §9.1, §9.4** — access events via `INSERT … SELECT` of active owned items under the
   enqueue savepoint; remove `last_used_at` from `finalize()`; state the lock-order invariant (H3).
4. **§5.2, §5.3, Q4** — choose per-user-scoped purge (recommended) or a lifecycle-safe role; remove
   time/grace parameters or clamp them; put the grace floor into the policy (H4, H5).
5. **§3.3, §3.6, §10.3 copy references, M6** — purge-date and duration copy legal-gated; interim
   wording without dates (H6).
6. **§8.5, §4.3 `extraction_jobs`** — stale-job termination, `workflow_started_at`, bounded age;
   correct the "moved back to pending" sentence (H7).
7. **§2.4, §4.3, §9.3** — shared character policy (`Cc`, `Cf`, `Zl`, `Zp` + delimiters) for
   `value_text` and `subject_label` in domain, DB and contract; retrieval drops invalid items;
   render with `ensure_ascii=False` (M-01).
8. **§4.6, §8.4 step 5, §3.3** — `ON CONFLICT … WHERE status='active' DO NOTHING`; savepoint
   behaviour marked [NV] until proven (M-02).
9. **§4.3, §4.4, §5.5** — `UNIQUE (id, user_id)` on items, composite FKs, extended owner trigger,
   matching tests (M-03).
10. **§10.3** — add stored export payloads as a derived copy and the chosen handling (M-04).
11. **§3.6, §8.6, Q12** — server-side atomic "delete memories with this conversation" (M-05).
12. **§3.2** — explicit definition of "immediately"; optional pre-call consent re-check (M-06).
13. **§13.3, §14 M7** — Gate 03 expected NOT PASSED within M0–M7; deletion-reflection test defined
    across threads (M-07).
14. **§13.3, §13.4** — held-out split, per-slice minimums, intervals, recall-in-context, mock
    reporting rules (M-08).
15. **§5.4, §8.4, M5** — usage module extraction (M-09).
16. **§7.3 V6** — self-subject minor statements (M-10, legal).
17. **§5.5, §13.1, M2** — non-superuser owner role for FORCE/maintainer tests (M-11).
18. **§8.4, §8.6, Q16, §13.2 item 10** — adopt clear-cancels-jobs, with per-scope rules (M-12).
19. **§4.1, M5** — record roadmap deviations; move gateway JSON-schema work out of M5 (M-13).
20. **§3.4, §3.2, §2.4, §6.6, §7.4** — reference fixes (L-01), expiry wording (L-03), undo rules
    (L-05), flag-off behaviour (L-11), `policy_version` column (L-08).
21. **§14** — split M2 (a/b), M4 (a/b, S2 first), M5 (a/b); add tests listed in §9 of this report.

`docs/adr/ADR-0036-personal-memory-architecture.md`:

22. Decision 9 (ranking mechanism), Decision 11 (maintenance design per H4/H5, composite FKs per
    M-03), Decision 6 ("immediately" definition, M-06; legal-gated purge copy, H6), Decision 8
    (stale-job handling, H7; clear cancels jobs, M-12), new "Deviations from roadmap" list (M-13),
    Rollout (Gate 03 not reachable in Phase 03 as planned, M-07). Rename the file (L-02).

`docs/phase-03/PHASE_03_OWNER_DECISIONS.md`: **no change required.** No owner decision has to be
reversed. The approvals requested below are new, narrower items, to be recorded in an addendum to
§17 or in the ADR acceptance note.

---

## 13. Acceptance conditions for ADR-0036

ADR-0036 should move to Accepted only when all of the following hold:

1. H1–H7 corrected in the architecture and ADR (documentation; no code needed).
2. M-03, M-06, M-07, M-12 and M-13 corrected; M-06, M-07 and M-13 explicitly acknowledged by the
   owner.
3. Q4 resolved as a **design choice** (per-user-scoped purge, or a lifecycle-safe role with an
   operator plan), and Q16 adopted.
4. The new retention category (extraction-job rows, 30 days) and the unapproved additions listed in
   §4 (user settings, restore/undo/activity endpoints, caps) explicitly accepted by the owner.
5. The legal qualifications are restated unchanged: D5 notice re-confirmation subject to legal
   review; D6 grace period provisional; D9 category list and refusal copy pending legal review, no
   exception flow; D12 durations provisional and not user-facing promises.
6. File renamed to `docs/adr/0036-personal-memory-architecture.md` and indexed.

## 14. Conditions before implementation (D1 entry conditions + this review)

1. `main` protection enabled as approved in D13 (PR required, required CI checks, no force push,
   no deletion, administrators included) and verified via the protection API; today it returns 404
   [V-gh]. Q8 wording recorded.
2. ADR-0036 Accepted (§13 above) **before the first migration merges** (D1). M1 (pure domain code)
   may start once protection exists and the owner gives the D1 written approval on the first Phase 03
   PR.
3. `MEMORY_FEATURE_ENABLED=false` default in every environment; ai-service live-extraction switch
   off; mock gateway only.
4. Before **M2**: the Q4 design decision and, if a role is used, the operator plan for AWS; Q6.
5. Before **M3**: Q7, Q12 (server option), Q14, Q16.
6. Before **M4**: the evaluation dataset rules of M-08 fixed (held-out split frozen); Q2 checked on
   the target RDS configuration or recorded as [NV] with the F1/F2 decision rule.
7. Before **M5**: Q10; usage module placement (M-09).

## 15. Conditions before Gate 03

Gate 03 must not be declared passed until **all** of these hold. None holds today.

1. Gate 02 recorded GO (D1).
2. Q9 thresholds approved by the owner, measured on the frozen held-out sets with per-slice minimums.
3. Zero-tolerance results at 0 on the adversarial isolation suite (wrong-user recall),
   deleted/suspended/expired retrieval, assistant-sourced memories, false tier-1 writes, and
   third-party writes without confirmation.
4. Deletion-reflection test (as defined under M-07) at 100 %.
5. Live extraction approved separately (D1), run within an approved spend cap, and a
   **human-reviewed** extraction set passing the approved precision/recall threshold (roadmap Gate
   03).
6. Legal review complete for D5 (notice and re-confirmation), D6 (grace window, delete-now
   default), D9 (category list, minors scope, refusal copy) and D12 (durations and any duration
   shown in product copy, H6).
7. Q1, Q5 and Q11 resolved for any live or user-facing enablement. Production enablement of
   `MEMORY_FEATURE_ENABLED` needs its own written approval.

---

## 16. Final recommendation to the project owner

- **Verdict: CONDITIONAL PASS.** The design implements your thirteen decisions faithfully in
  structure, and the claims I checked against the code hold. It is **not yet ready for your formal
  acceptance**: seven High findings need document corrections first. Two are confirmed defects
  (FTS ranking scores zero under the proposed tokeniser; memory writes can make a finished chat
  reply fail). Five are design gaps (the maintenance role does not fit how we create roles; the
  maintenance functions let the API role delete any user's suspended memories; stuck jobs can never
  recover; the "explicit request" check is too loose for D7; the restore card would show a purge
  date that legal has not approved).
- **Decisions needed from you** (none reverses D1–D13): the maintenance design or AWS role
  creation (H4/Q4); purge-date and duration copy stays legal-gated (H6); how to read "stop
  immediately" for an answer already streaming (M-06); the Gate 03 deletion test definition and
  your acknowledgement that Gate 03 cannot pass within this plan (M-07); the recorded roadmap
  deviations (M-13); the extraction-job retention category; legal scope of "minors' data" (M-10);
  Q8, Q12 and later Q9.
- **Next task: Task 03B — Architecture revision.** Apply the corrections in §12 to the architecture
  and ADR-0036 (documentation only; no code, migrations or dependencies), then return both for your
  formal review together with this report. In parallel, as owner actions: enable branch protection
  on `main` (D13) and schedule the legal review of D5/D6/D9/D12.

_End of validation. ADR-0036 remains Proposed. Gate 03 is not passed. Nothing here claims
production readiness._
