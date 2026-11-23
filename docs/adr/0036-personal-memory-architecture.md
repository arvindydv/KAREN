# 0036 — Personal memory architecture (Phase 03)

- Status: **Accepted** · Accepted by: Project Owner · Date: 2026-11-23 (owner decision session,
  recorded in `docs/phase-03/PHASE_03_M0_NOTE.md` §2; OD-01, OD-03, OD-04, OD-05, OD-08 and OD-09
  accepted as proposed). Acceptance approves this design only; see "Open questions requiring
  separate approval" for what it does not approve.
- Date: 2026-11-23 · Revised: 2026-11-23 (Task 03B, Revision 2 — applies
  `docs/phase-03/PHASE_03_ARCHITECTURE_VALIDATION.md`; mapping in
  `docs/phase-03/PHASE_03_TASK_03B_CORRECTIONS.md`) · Consolidated: 2026-11-23 (Task 03C,
  Revision 3 — no decision changed; sequencing and consistency fixes only, see
  `docs/phase-03/PHASE_03_READINESS_REPORT.md` §4)
- Owner/legal register: `docs/phase-03/PHASE_03_DECISION_REGISTER.md` (live; supersedes the
  Task 03B register). Acceptance checklist: `docs/phase-03/PHASE_03_CLOSURE_CHECKLIST.md` §2.
- File: renamed from `ADR-0036-personal-memory-architecture.md` to the repository's
  `NNNN-slug.md` convention. Indexed in `docs/adr/README.md` (M0).
- Implements: owner decisions D1–D13, `docs/phase-03/PHASE_03_OWNER_DECISIONS.md` §17 (OWNER
  APPROVED 2026-11-23), including the owner's qualifications (D12 durations not legally approved;
  D6 30-day grace provisional and subject to legal review) and the legal qualifications on D5 and
  D9.
- Detailed design: `docs/phase-03/PHASE_03_MEMORY_ARCHITECTURE.md` Revision 3 (section numbers
  below refer to it)
- Related: ADR-0007 (internal service auth), ADR-0019 (consent), ADR-0020 (data-rights
  workflows), ADR-0021 (conversation data model), ADR-0022 (streaming), ADR-0023 (usage limits),
  ADR-0024 (no content in telemetry), ADR-0025 (OpenRouter), ADR-0035 (scope correction)
- Keeps in force: all of the above. Changes nothing in ADR-0001–0035.

## Context

Phase 03 of `karen_phases.md` ("Personal memory and intelligent continuity") asks KAREN to remember
what users choose to share, use it in later answers with provenance, and let users view, correct,
forget and isolate it. Gate 03 requires zero cross-user recall, edit/delete reflected in the next
response, a human-reviewed extraction set, and no restricted memory written without valid
permission.

The repository has no memory code (audit §1, §12). It does have the pieces memory must reuse:
`withUserScope` + RLS + a NOBYPASSRLS runtime role, `ConsentService` and the `MEMORY_STORAGE` /
`PERSONALIZATION` purposes, the data-rights Temporal pattern (ids-only workflows calling
HMAC-signed internal API steps), the reserve/settle usage limiter, and a single chat injection
point (`GenerationService.load()` / `finalize()`). Memory is the **first path where model output
can persist user data** (audit S7) and a new prompt-injection surface (S5), so its write path must
be a proposal validated by deterministic server code.

The owner approved thirteen decisions with conditions. The forces that shape this ADR:

- Gate 02 is NO-GO; implementation is mock-only and Gate 03 cannot pass before Gate 02 (D1).
- No embedding model is verified; FTS-first is a deliberate deviation from the roadmap's
  "FTS + vectors + fusion" (D3), and paid probes need separate approval (D4).
- Consent must stop processing immediately on revocation, and re-grant must not silently restore
  (D5, D6).
- No inferred memories; assistant messages are never a source; secrets, sensitive categories and
  minors' data are rejected (D7, D9).
- New tables use FORCE RLS while the 12 documented existing exclusions stay a separate track; the
  maintenance design must preserve tenant isolation (D11).
- Retention durations are provisional engineering defaults, not legal commitments and not
  user-facing promises (D12).
- Database roles are created by `infra/database/roles.sql` **after** migrations, and the local/CI
  migration owner is a superuser, which hides FORCE-RLS behaviour (validation H4, M-11).

## Decision

1. **Ownership.** A new `memory` module in `apps/api` owns a new Postgres schema `memory` and every
   memory read and write. The ai-service and the Temporal worker stay database-less. No new
   deployable. `UsageLimitsService` moves from `conversation` into its own `usage` module so that
   memory and conversation can both use it without a module cycle. (§2, §5.4)

2. **What a memory is.** A short statement the user made about themselves (or a contact), stored
   as the user's **verbatim words** (`value_text` must be a substring of a span that must be a
   substring of the source message) plus a typed label (`kind` ∈ fact/preference/context/event,
   `slot` from a closed vocabulary, `subject` self/third-party). No inferences, summaries or
   embeddings in Phase 03. One shared character policy (no control, line/paragraph-separator or
   bidi/format characters except ZWNJ/ZWJ, no `<>{}` or backtick) is enforced identically in
   domain validation, the DB CHECKs and the wire contract. (§1, §2.4, §4.2, §7.3)

3. **Data model.** Six tables — `user_settings`, `items`, `item_revisions`, `suggestions`,
   `extraction_jobs`, `access_events` — with CHECK constraints, partial unique indexes for dedupe
   and single-valued slots, and FK cascades for derived rows. Every reference to `memory.items` is
   a **composite `(id, user_id)` FK**; every reference into `conversation.*` is checked by an owner
   trigger, so no row can point at another user's data. A DB trigger guarantees every source
   message is a **user-role** message of the same user. Rejected candidates are never stored.
   Writes use `INSERT … ON CONFLICT DO NOTHING` (never catch-and-map unique violations, which
   abort the transaction). (§4)

4. **Thread switch.** `conversation.threads.memory_enabled boolean NOT NULL DEFAULT false` with
   `CHECK (mode <> 'ephemeral' OR NOT memory_enabled)`. New standard threads default to `true`
   only when the feature is on and `MEMORY_STORAGE` is eligible; existing threads stay `false`;
   forks inherit; with the feature flag off the field is ignored. Effective memory = feature ∧
   standard ∧ flag ∧ consent eligible, evaluated at every read and write step, and always shown in
   the chat header. (§3.4, §3.5)

5. **Consent.** `MEMORY_STORAGE` covers storing and using explicit, user-visible memories;
   `PERSONALIZATION` is reserved for inferred tailoring and unused in Phase 03. Grants count only
   if their `policy_version` is in an eligible allow-list (re-confirmation when the updated notice
   ships, **subject to legal review**). List, view, export, delete, clear, dismiss and undo of a
   new item never require consent; undo of a supersession writes content and does. (§3.1, §3.6)

6. **Revocation.** An `AFTER UPDATE OF status` trigger on `consent.consent_grants` (created by the
   memory migration; consent code unchanged) suspends active items, deletes pending suggestions
   and cancels pending jobs in the **same transaction** as the revoke, including cascades from
   `AI_PROCESSING`. It refuses to run outside the owner's RLS scope. **"Stop processing
   immediately"** is defined as: after the revoke commits, no new retrieval, extraction AI call or
   memory write starts for that user; an answer already streaming may finish with context loaded
   before the revoke, and an extraction call already in flight may return but its results are
   discarded (interpretation acknowledged by the owner, OD-03, 2026-11-23; the optional
   `abortLocal` abort is not adopted). The extraction run step
   re-checks consent immediately before the AI call. Suspended memories are purged after a grace
   window held as a **database constant** (provisional 30 days, **subject to legal review**).
   Re-grant never restores them: the user is shown Restore / Delete now / Decide later. **No
   purge date or duration appears in any product copy until legal approves the wording**; until
   then the copy says they are deleted "after a grace period". (§3.2, §3.2.1, §3.3, §11)

7. **Write policy.** Tier 1 (explicit remember-request) requires **all** of: a verified span; a
   trigger phrase from the deterministic lexicon **in the same clause** as the span; no negation
   scoping the trigger; the clause is not a question; not a "remind me" request; self-subject;
   "ask before saving" off; and the model's flag. The model's flag alone is never sufficient.
   Tier 2 (other self-stated facts/preferences, all third-party facts, or "ask before saving" on)
   → suggestion the user confirms. Tier 3 (inference) → never. Deterministic SECRET detectors,
   minor rules (third-party children **and** self-stated under-18 age or school grade, on the
   whole message) and SENSITIVE lexicons are authoritative; the model's sensitivity label may only
   escalate. (§7)

8. **Asynchronous extraction.** `finalize()` inserts a `memory.extraction_jobs` row (unique per
   source message) and the reply's access events in its existing terminal transaction **behind one
   savepoint**, so a memory failure never fails a completed reply; it does not update
   `memory.items` (`last_used_at` is updated post-commit). It then starts
   `memoryExtractionWorkflow` with id `memory-extract:<source_message_id>` and `REJECT_DUPLICATE`.
   The workflow calls a signed internal API step that re-checks job, message, thread and consent
   under an `identity.users … FOR SHARE` lock, reserves usage, re-checks consent, calls the
   ai-service, validates, and writes with a compare-and-set on the job version. An in-process
   maintenance sweep re-kicks jobs whose workflow never started and **terminates jobs older than a
   DB-held maximum age** (`failed/abandoned_stale`), because a closed workflow id can never be
   reused. `clear all` cancels all of the user's pending jobs, `clear conversation` that thread's
   jobs, `clear kind` none (documented). Lock order invariant: the user's `identity.users` row is
   locked before any memory row. (§2.3, §8, §9.4)

9. **Retrieval.** In the generation runner, after an `AI_PROCESSING` re-check inside `load()` (S2),
   a separate short transaction re-checks `MEMORY_STORAGE` and the thread flag and runs one
   owner-filtered SQL statement of **bounded per-reason branches** (FTS match over API-written
   lexemes ≤ 40, pinned ≤ 5, preferences ≤ 10, recent ≤ 5). SQL does not rank: position-less
   lexemes make `ts_rank_cd` score 0, so the lexical score is computed in TypeScript with the
   rest of the deterministic scoring, dedupe and the 12-item / 2,000-character budget. Each item is
   validated against the wire schema and dropped if invalid. Failures degrade to
   `memory_status: 'unavailable'`; chat continues. App-side multilingual tokenisation (F2) is the
   proposed default; `pg_trgm` only if compatible and justified by evaluation. Cross-script recall
   of facts and events is expected to be weak in Phase 03. (§6)

10. **Wire contract v5.** `completionRequestSchema` gains optional `memory_status` and
    `memory_context[]` (opaque refs, shared character policy, bounded length, ≤ 20 items); a new
    `/internal/v1/memory/extract` endpoint returns strict candidates. The ai-service renders memory
    as one delimited, labelled data block in `chat.v5` (JSON strings with `ensure_ascii=False`);
    memory is never sent as chat turns or as a caller-supplied system message. Gateway JSON-schema
    support is **not** built in Phase 03. (§2.4, §9.3)

11. **Isolation and maintenance.** Every `memory.*` table has ENABLE + FORCE RLS with an owner
    policy; every query also filters `user_id` explicitly. **No new database role.** Maintenance
    functions are `SECURITY DEFINER`, owned by the migration role like the existing definer
    functions, and act through **per-user scoping** (`set_config('karen.user_id', …)` per user,
    reset before return), the `erase_user` pattern. The only non-owner policy is a read-only one
    on the content-free `extraction_jobs` table for the owner role (id → user lookup). No
    maintenance function takes a time, interval or grace parameter; grace, maximum job age and job
    retention are DB constants changed only by reviewed migration, each defined **once** and
    shared by the consent trigger and the maintenance functions. FORCE, owner and maintenance
    tests run as a **non-superuser** owner role. `identity.erase_user()` gains memory deletes in a
    new migration version that keeps every existing statement unchanged; its relation to the
    pre-existing NEW-1 defect in the same function was decided as OD-12 option (b) (M2a carries the
    current body unchanged plus memory deletes; the NEW-1 fix follows and keeps them). The owner
    approved this design (Q4 / OD-01, 2026-11-23). The
    fallback — a dedicated maintainer role created idempotently by the migration — needs
    `CREATEROLE` for the migration role in AWS. (§5, §10.1)

12. **Deletion.** Synchronous SQL with FK cascades for one / by kind / by conversation / all,
    undo, erasure, and an atomic `DELETE /v1/conversations/{id}?delete_memories=true`. It never
    depends on Temporal. No memory content in Redis, logs, metrics, audit metadata or Temporal
    history. Stored data exports keep memory text until the export expires (existing
    `DATA_EXPORT_TTL_HOURS` scrub) or erasure. (§8.6, §10.3, §12)

13. **Retention.** Approved categories with provisional durations (§11); expired rows are excluded
    in SQL at read time, purge is housekeeping. None of these durations is a legal commitment or
    user-facing promise. Extraction-job rows are a **new** content-free category not covered by
    D12; the owner accepted them as provisional (OD-05, 2026-11-23).

14. **Cost.** Extraction reserves and settles against the user's daily/monthly limits, records an
    `ai_invocations` row and a ledger entry under its own request kind; per-user job, candidate,
    message-length and attempt caps bound work. (§12.3)

15. **Rollout guard.** `MEMORY_FEATURE_ENABLED=false` in every environment; the ai-service live
    extraction switch stays off; mock gateway only. **Phase 03 as planned (M0–M7) ends with Gate
    03 recorded NOT PASSED**: Gate 03 also needs Gate 02 GO, separately approved live extraction
    and a human-reviewed live extraction set, none of which is in this plan. (§14 M7)

## Deviations from the roadmap (recorded, not silently changed)

`karen_phases.md` is not edited. The owner acknowledged these deviations with this ADR (OD-08,
2026-11-23; §1.4 of the architecture has the reasons):

1. One `items` table instead of `facts`/`preferences`/`episodes`; conflicts as suggestions; no
   `deletion_jobs`; no `embeddings` table.
2. FTS-first instead of FTS + vectors + fusion (already approved as D3).
3. No per-item "disable" state (F03-01).
4. No per-memory `sensitivity` or consent-purpose fields (F03-01): sensitive items cannot be
   stored, and every item is under `MEMORY_STORAGE`.
5. Retrieval audit stores rank and reason, not a "matching confidence"; source date lives on the
   item (F03-02).
6. No "token savings" metric (F03-02): budgets are in characters, as in the existing chat window.
7. No memory-specific KMS/column encryption; RDS storage encryption with the KMS data key applies
   as for all data.
8. No Redis memoization of memory content at all (stricter than the roadmap).
9. Gateway structured-output support moved to the live-extraction approval package.

## Considered alternatives

| Area          | Alternative                                                                  | Outcome and reason                                                                                                                  |
| ------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Storage owner | Memory in the ai-service (Python, own DB access)                             | Rejected: breaks the database-less ai-service boundary and adds a DB role and deployable concern                                    |
| Table layout  | Separate `facts`, `preferences`, `episodes` tables (roadmap)                 | Rejected for P03: identical lifecycle; one table halves RLS/deletion/retrieval surface. Revisit if kinds diverge                    |
| Memory text   | Model-normalised value ("vegetarian diet")                                   | Rejected: lets the model author text that is replayed into prompts; verbatim-substring rule instead                                 |
| Retrieval     | FTS + vectors + RRF now (roadmap F03-02)                                     | Deferred (D3): needs a paid, unverified embedding path and a new data flow; measured trigger defined (§6.8)                         |
| Retrieval     | No search, inject everything pinned                                          | Partially adopted as the bounded always-include set; insufficient alone for larger corpora                                          |
| Ranking       | `ts_rank_cd` over `array_to_tsvector` lexemes (Revision 1)                   | Rejected: always 0 for position-less lexemes (verified locally); TS-side scoring instead                                            |
| FTS           | `to_tsvector('simple', …)` only                                              | Evaluated against app-side tokens in M4b; Devanagari parsing under the RDS locale is unverified                                     |
| Revocation    | Application hook in `ConsentService`                                         | Rejected: creates a consent→memory dependency and can be bypassed by other code paths; trigger is atomic                            |
| Revocation    | Hard delete on revoke (D6 option A)                                          | Rejected by owner (D6 B); delete-now offered instead                                                                                |
| Re-grant      | Auto-restore suspended memories                                              | Rejected by owner condition (D6)                                                                                                    |
| Write policy  | Confirm everything / store all user-stated facts                             | Rejected by owner (D7 B)                                                                                                            |
| Tier 1        | Model `explicit_request` flag + trigger anywhere in the message (Revision 1) | Rejected: lets negations, questions and other clauses through; clause-bound deterministic rule instead                              |
| Async         | In-process fire-and-forget; outbox relay; BullMQ                             | Rejected (D10): lost work on crash / new infrastructure / new dependency                                                            |
| Stuck jobs    | `ALLOW_DUPLICATE_FAILED_ONLY` re-runs for this workflow type                 | Not adopted: exception to the starter's one-workflow-per-id rule; stale termination + "try again" instead                           |
| Maintenance   | Member-less `karen_memory_maintainer` role (Revision 1)                      | Not adopted as default: does not fit the migrations→`roles.sql` order, the shadow-DB replay or ownership transfer; kept as fallback |
| Maintenance   | Runtime role with cross-user policies; owner-role definer without FORCE      | Rejected: widens the request-path role or breaks D11's FORCE requirement                                                            |
| Maintenance   | Caller-supplied `p_now` / grace parameters                                   | Rejected: lets a request-path bug purge every user's restorable memories                                                            |
| Caching       | Redis cache of retrieved memories                                            | Rejected for P03: adds a deletion and isolation target with no measured need                                                        |
| Prompt        | Memory as extra `system` messages                                            | Rejected: the ai-service skips its own prompt when `messages[0]` is `system` (S6)                                                   |
| Isolation     | Backfill FORCE on 12 existing tables now                                     | Rejected by owner (D11 B): separate hardening track                                                                                 |

## Security and privacy implications

- Memory adds the product's most sensitive user-authored dataset. Defences: two-layer isolation
  (explicit `user_id` + FORCE RLS), same-owner composite FKs and owner triggers, adversarial
  zero-tolerance wrong-user tests, per-table RLS tests as the runtime role and as a non-superuser
  owner.
- Model output never decides storage, ids, owner, tier or status; it can only propose spans that
  the server verifies against the user's own message. Assistant messages cannot be sources (DB
  trigger).
- Prompt injection via memory is mitigated at write time (verbatim-substring, shared character
  policy, SECRET/SENSITIVE rejection), on the wire (strict schema, per-item drop, opaque refs), in
  the prompt (one delimited data block, explicit rules) and by capability (no tools; memory cannot
  trigger saves). Residual risk: a user can type instructions into their own memory; it remains
  delimited data.
- Consent takes effect as defined in Decision 6 (owner acknowledgement pending). Extraction cannot
  store after a revoke (lock + re-check).
- Maintenance cannot be steered by request-path parameters to delete other users' restorable data.
  It does not defend against a fully compromised runtime role, which can already set any user
  scope; that is unchanged.
- The internal HMAC secret is shared by api, ai-service and voice-agent (ADR-0007); the memory
  internal endpoints re-derive and re-check everything. Recorded as residual risk.
- New outbound data flow: none in Phase 03 (mock only). When live extraction is approved, one user
  message per job goes to the ECONOMY model through OpenRouter with the existing ZDR /
  `data_collection=deny` policy.
- Logging: content-free by design; new redaction keys in TS and Python; log-content tests.
- Lexicon false negatives in production are a named residual risk; mock-pipeline zeros are
  properties of the evaluation set, not production guarantees.
- Legal: purpose texts, notice re-confirmation, the sensitive-category list and refusal copy, the
  scope of "minors' data", the 30-day grace and all retention durations — and any date or
  duration shown in product copy — remain **pending legal review**.

## Operational consequences

- New migration(s) (reviewed SQL, never auto-applied to production) and new `roles.sql` grants.
  **No new database role** under the recommended design.
- `roles.sql` must be re-run after the memory migration (existing rule).
- Changing the suspension grace, maximum job age or job retention requires a reviewed migration.
- If the separate D11 hardening track ever FORCEs `identity.users`, the memory purge function
  must change in the same migration.
- API and ai-service must deploy together for contract v5 (TS owns the version; Python mirror and
  fixtures in the same PR).
- New env vars (`MEMORY_*`, §11–§12) documented in `docs/development/environment-variables.md`.
- One more Temporal workflow type on the existing `karen-tasks` queue; one more in-process
  maintenance sweep (Redis-locked).
- Extraction consumes user AI budget once live; zero in mock.
- New dashboards/alerts on `karen_memory_*` metrics (enqueue failures, stale terminations, job
  outcomes, retrieval latency and drops, rejections), delivered in M7.

## Rollout and rollback

Rollout (each step one milestone PR, `main` protected first — D13):

1. M0 entry conditions: branch protection (verified via the protection API with the exact
   required checks), this ADR Accepted and indexed, D2 rename/erratum, free catalog inspection
   recorded.
2. M1 domain library → M2a schema/RLS/triggers/erasure → M2b maintenance functions (after the Q4
   decision) → M3 API/controls/data rights → M4a S2 + contract v5 + `chat.v5` → M4b retrieval +
   evaluation (first user of the `finalize()` savepoint, so it carries the savepoint proof test)
   → M5a extraction endpoint + mock + usage refactor → M5b job pipeline + workflow (after M4b,
   M5a and M2b) → M6 mobile → M7 evaluation evidence package. Per-milestone detail:
   `docs/phase-03/PHASE_03_MILESTONE_PLAN.md`.
3. `MEMORY_FEATURE_ENABLED=false` throughout; enabled only in local/test for suites. Enabling in
   any deployed environment, live extraction, `pg_trgm`, embeddings and production launch each need
   separate written approval.
4. Gate 03 is expected to be recorded **NOT PASSED** at the end of M7 (Decision 15).

Rollback:

- **Behaviour:** set `MEMORY_FEATURE_ENABLED=false` → no retrieval, no jobs, write routes 404;
  read/delete/export keep working so users can still remove data.
- **Contract:** v5 fields are optional; an API without memory sends v4-equivalent requests under
  the v5 version; a full revert requires reverting API and ai-service together.
- **Schema:** migrations are expand-only (new schema, a defaulted column, triggers, definer
  functions, a new `erase_user` version). Pre-production down-SQL is documented in each migration
  (drop triggers and functions, drop schema `memory`, drop column/constraint, restore the previous
  `erase_user` body). Never rolled back in production without an erasure-completeness review.
- **Data:** rolling back never resurrects deleted data; suspended data stays suspended.

## Acceptance conditions (owner)

Recorded 2026-11-23 (`docs/phase-03/PHASE_03_M0_NOTE.md` §2). The conditions were:

1. Review of Revision 3 against the validation report (H1–H7 and M-03, M-06, M-07, M-12, M-13
   applied in the documents) and the Task 03C package.
2. Acknowledgement of the "immediately" definition (M-06), the deletion-reflection test definition
   and Gate 03 expected NOT PASSED (M-07), and the roadmap deviations (M-13).
3. The Q4 maintenance design choice (per-user scoping recommended, or the fallback role with an
   AWS operator plan); Q16 as adopted.
4. Acceptance of the extraction-job retention category and of the additions not covered by
   D1–D13 (user settings / "ask before saving", restore/undo/activity endpoints, per-user caps and
   the daily job limit as provisional numbers).
5. The legal qualifications restated unchanged (D5, D6, D9, D12).

## Open questions requiring separate approval

This ADR does **not** approve any of the following:

1. **Live extraction** on a paid model (D1), including which ECONOMY model, its JSON-schema
   support, gateway structured-output work and `MEMORY_EXTRACTION_RESERVE_USD`.
2. **Embedding spend** of any amount: the paid probe (D4 conditions, proposed USD 2 ceiling),
   any embedding model, table, endpoint or registry entry.
3. **Legal policy:** retention durations, the 30-day grace window, any date or duration in
   product copy, the `MEMORY_STORAGE` notice text and re-confirmation, the sensitive-category list
   and refusal copy, the scope of "minors' data", the delete-now default.
4. **Production launch** or enabling `MEMORY_FEATURE_ENABLED` in any deployed environment.
5. **`pg_trgm`** extension enablement (needs RDS compatibility evidence and evaluation).
6. **Database role creation** in AWS, only if the owner rejects per-user-scoped maintenance.
7. **Evaluation thresholds and dataset rules** for Gate 03 (§13.3–13.4 provisional values).
8. **Changes outside Phase 03:** FORCE RLS backfill on the 12 existing tables (D11 separate track),
   the pre-existing definer-lookup-under-FORCE issue on `consent.data_rights_requests` found in
   Task 03B (NEW-1; reported, not fixed; tracked in
   `docs/phase-03/PHASE_03_SECURITY_RELIABILITY_CHECKLIST.md` Part B and a prerequisite for any
   AWS deployment), re-applying deletions after a backup restore (OD-13), the Redis raw-UUID keys (audit S3 / ADR-0020 mismatch C2),
   `PERSONALIZATION` features (F03-03), household memory (Phase 12).

Technical questions to resolve during implementation are listed in §16 of the architecture
document (Q1–Q16); owner, legal and governance decisions in
`docs/phase-03/PHASE_03_DECISION_REGISTER.md` (which supersedes `PHASE_03_TASK_03B_CORRECTIONS.md`
§3; IDs unchanged).

## Consequences

- Easier: later phases (tasks, approvals) can attach to a typed, consent-aware, deletable memory
  store with provenance; adding embeddings later is an additive table with cascade.
- Harder: verbatim-only storage limits cross-script recall until embeddings are justified; the
  closed slot vocabulary and the trigger/negation/question lexicons need curation; the consent
  trigger couples two schemas at the database level (documented here and tested); maintenance
  constants change only by migration.
- Reversal: disable the flag; drop the schema pre-production; this ADR would be superseded by a
  new ADR if the roadmap's separate tables or vector retrieval are adopted.
