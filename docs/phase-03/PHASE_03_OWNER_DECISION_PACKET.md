# KAREN — Phase 03 — Owner decision packet (Task 03D)

- **Date:** 2026-11-23 · **Baseline:** `main` @ `e5ff562` · **Type:** governance preparation only.
- **Purpose:** give the owner, on one page per decision, what is needed to decide the open Phase 03
  items in a single decision session. Read with `PHASE_03_DECISION_REGISTER.md` (the live register)
  and `PHASE_03_READINESS_REPORT.md`.
- **Status of everything in this packet: NOT DECIDED.** This packet does not record, imply or
  pre-fill any decision. ADR-0036 stays **Proposed**. Gate 02 stays **NO-GO**. Gate 03 stays **NOT
  PASSED**. Implementation stays **NOT AUTHORISED**. D1–D13 (`PHASE_03_OWNER_DECISIONS.md` §17) are
  unchanged. No legal approval exists for anything here.
- **IDs:** every ID (GOV-, OD-, Q-, LEG-, APP-, D-) is the one already in the register. No ID was
  renumbered, merged or retired. "Existing proposal" means the text already in the register or the
  architecture. It is quoted, not re-decided.
- **Evidence labels:** **[V]** verified in repo · **[V-gh]** verified via GitHub API in Task 03D ·
  **[D]** stated in a repo document · **[PG]** documented PostgreSQL behaviour · **[NV]** not
  verified.

Companion Task 03D documents:

| Document                                                                                     | Covers                                     |
| -------------------------------------------------------------------------------------------- | ------------------------------------------ |
| [PHASE_03_BRANCH_PROTECTION_RECOMMENDATION.md](PHASE_03_BRANCH_PROTECTION_RECOMMENDATION.md) | GOV-1: exact checks and protection payload |
| [PHASE_03_Q8_PROPOSED_WORDING.md](PHASE_03_Q8_PROPOSED_WORDING.md)                           | Q8: single-maintainer exception wording    |
| [PHASE_03_D1_APPROVAL_TEMPLATE.md](PHASE_03_D1_APPROVAL_TEMPLATE.md)                         | GOV-2: D1 written-approval template        |
| [PHASE_03_LEGAL_REVIEW_CHECKLIST.md](PHASE_03_LEGAL_REVIEW_CHECKLIST.md)                     | LEG-1…LEG-5 questions for counsel          |

---

## 0. At a glance

### 0.1 What each decision unblocks

| Group                          | Decisions                                                  | Unblocks (only when **all** in the group are recorded, plus their other prerequisites) |
| ------------------------------ | ---------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| A. ADR-0036 acceptance         | OD-01, OD-03, OD-04, OD-05, OD-08, OD-09                   | S2 (closure checklist §2, A-2…A-7); also needs A-1, A-8, A-9, A-10                     |
| B. Implementation entry        | GOV-1, Q8, GOV-2, GOV-3, GOV-6                             | S3 (closure checklist §3)                                                              |
| C. Milestone-specific          | OD-11 (M1/M4b), OD-12 (M2a), OD-06 (M3)                    | The named milestone only                                                               |
| D. Production / D11 track      | OD-10, OD-13                                               | Nothing in M0–M7; production readiness (S6)                                            |
| E. Legal (not owner-decidable) | LEG-1…LEG-5 (incl. Q5, OD-02, OD-07, parts of OD-05/06/13) | Release (REL), Gate 03, production                                                     |

### 0.2 Summary table

"Evidence strength" says whether the documents, on their own, clearly favour one option. Where it
says **trade-off**, this packet does not recommend.

| ID    | Question (short)                                         | Existing proposal (register)                              | Evidence strength                                                  | Blocks   |
| ----- | -------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------ | -------- |
| OD-01 | Maintenance design: per-user scoping or maintainer role? | Per-user scoping                                          | Strong on testability/fit; residual dependency on `identity.users` | ADR, M2b |
| OD-03 | Meaning of "stop processing immediately"                 | Acknowledge §3.2.1 definition; abort option not adopted   | Trade-off (interpretation of D6)                                   | ADR      |
| OD-04 | Gate 03 expected NOT PASSED; deletion-reflection test    | As written                                                | First half is a fact; test definition is a trade-off               | ADR      |
| OD-05 | Extraction-job rows as a new retention category          | Accept as provisional                                     | Category: needed by design. Durations: legal (LEG-4)               | ADR      |
| OD-08 | Acknowledge ten roadmap deviations                       | Accept                                                    | Each has a recorded reason; owner may reject any one               | ADR      |
| OD-09 | Accept additions outside D1–D13                          | Accept as provisional                                     | Trade-off per item                                                 | ADR      |
| OD-11 | When to seal held-out evaluation sets                    | (a) seal before M1                                        | Strong that (a) or (b) preserves independence; (c) only discloses  | M1, M4b  |
| OD-12 | NEW-1 fix vs M2a order on `identity.erase_user`          | (b) M2a first, NEW-1 later, both verified non-superuser   | Trade-off                                                          | M2a      |
| OD-06 | Invalidate unexpired exports on memory delete?           | Disclose the window in P03                                | Trade-off; disclosure copy is legal                                | M3       |
| OD-10 | Where NEW-1 is tracked and scheduled                     | Track separately in the D11 track; fix before any AWS use | "Before AWS" is strongly supported; _location_ is open (§3.4)      | PROD     |
| OD-13 | Re-applying deletions after backup restore               | Cross-cutting production item, not a P03 milestone        | Gap is verified; approach is open                                  | PROD     |

---

## 1. Suggested session order

1. GOV-1 branch protection + Q8 wording (they are configured together; see the companion documents).
2. Group A (OD-01, OD-03, OD-04, OD-05, OD-08, OD-09). Also confirm A-8 (Q16 as adopted or
   overridden) and A-9 (legal qualifications restated unchanged).
3. OD-11 and OD-12 (they gate M1 and M2a, the first code milestones).
4. OD-06, OD-10, OD-13.
5. GOV-2 (D1 written approval) and GOV-6 — or a recorded decision to hold.
6. Schedule legal review (LEG-1…LEG-5) in parallel; it gates release, not implementation.

Any item can be sent back for revision instead of decided. A "send back" should be recorded with
the reason so that the register shows why it is still open.

---

## 2. ADR-0036 acceptance blockers

### 2.1 OD-01 — Cleanup / database-maintenance design (Q4, validation H4)

**Existing proposal.** All maintenance functions (`memory.lookup_extraction_job`,
`due_extraction_jobs`, `terminate_stale_jobs`, `purge_expired`) are `SECURITY DEFINER`, owned by the
migration role, and act through per-user scoping (`set_config('karen.user_id', …)` per user, reset
before return), the same pattern `identity.erase_user()` already uses **[V]**. No new database role.
The only non-owner policy is a read-only `FOR SELECT TO CURRENT_USER USING (true)` on the
content-free `memory.extraction_jobs` table. No function takes a time, interval or grace parameter;
grace (30 d), max job age (24 h) and job retention (30 d) are database constants, each defined once
(arch §5.3; ADR Decision 11).

**Alternatives (documented).**

| Option                                      | Status in docs | Key fact                                                                                                                                                                                                         |
| ------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Per-user scoping, no new role            | Proposed       | Fits the existing role lifecycle (roles created by `roles.sql` **after** migrations **[V]**)                                                                                                                     |
| B. Dedicated `karen_memory_maintainer` role | Fallback       | Created idempotently in the migration; needs `CREATEROLE` for the migration role on AWS **[NV]** — an infra approval; temporary membership for ownership transfer; shadow-DB replay behaviour must be documented |
| C. Member-less maintainer role (Revision 1) | Rejected (H4)  | `CREATE POLICY … TO <role>` fails on a fresh DB because the role does not exist yet; unguarded `CREATE ROLE` fails on the shadow DB                                                                              |
| D. Runtime role with cross-user policies    | Rejected       | Widens the request-path role                                                                                                                                                                                     |
| E. Owner-role definer without FORCE         | Rejected       | Contradicts D11 ("new memory tables must use … FORCE RLS")                                                                                                                                                       |

**Security implications.**

- A removes the caller-supplied clock/grace capability (a request-path bug can no longer purge every
  user's restorable memories) — this holds for A and B alike (H5 applies to both).
- Neither A nor B defends against a fully compromised runtime role, which can already set any user
  scope; this is unchanged and stated in arch §5.3 item 5.
- A introduces one owner-role read policy on a content-free table. B introduces a new role whose
  privileges must be maintained in `roles.sql` "hard guarantees".

**Reliability implications.**

- A depends on `identity.users` staying ENABLE-only (not FORCEd) **[V]**
  (`20261120090000_user_isolation_rls/migration.sql:24`). If the D11 track FORCEs it, the purge
  function must change in the same migration (recorded for `data-isolation.md` in M2b).
- B cannot be fully tested locally (local owner is a superuser **[V-local]**); its AWS behaviour is
  **[NV]**.
- Both require non-superuser-owner tests (T-RLS-04, T-MNT-01…05).

**Milestone impact.** Blocks ADR acceptance and M2b. Choosing B adds an AWS operator plan to M2b's
prerequisites and an infrastructure approval outside Phase 03.

**What approval would mean.** Option A (or B) becomes the accepted design for M2b; per-user-scoped
definer functions and the single lookup policy become part of ADR-0036 as written.

**What approval would not mean.** It does not approve any migration, any AWS role change, or any
change to the 12 existing FORCE exclusions (D11 separate track).

**Unresolved after approval.** RDS behaviour **[NV]** until T-AWS tests run; the `identity.users`
FORCE dependency remains a coupling to the D11 track.

**Evidence assessment.** The repository evidence (role lifecycle, shadow DB, local superuser
masking) is specific to option B's costs and is verified; option A has one recorded coupling. The
documents support A on testability and fit. The choice remains the owner's.

---

### 2.2 OD-03 — Definition of "stop processing immediately" (D6, validation M-06)

**Existing proposal (arch §3.2.1).**

> After the revoke transaction commits, **no new** memory retrieval, extraction AI call, or memory
> write **starts** for that user. Work that already started may finish only where it cannot store or
> newly use memory: (a) an answer that is already streaming may finish with the memory context loaded
> before the revoke (ADR-0019 "next request/step"); (b) an extraction AI call already in flight may
> return, but its results are discarded by the write step's re-check under the user-row lock.

Plus adopted narrowing: the run step re-checks consent immediately before the AI call (§8.4 step 2).
A database trigger suspends items, deletes suggestions and cancels jobs in the same transaction as
the revoke (§3.2).

**Alternatives (documented or implied by the register).**

| Option                                                             | Effect                                                                                                                                    |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| A. Acknowledge definition as written                               | Window (a) = one in-flight answer; window (b) = one in-flight extraction call whose output is discarded                                   |
| B. A + abort in-flight generations on `AI_PROCESSING` revoke       | `GenerationService.abortLocal` **[V]** reaches only runs on the **same API instance**; single-instance today, not a guarantee once scaled |
| C. Stricter reading (abort everything in flight, on all instances) | Not designed. Would need cross-instance signalling (new mechanism); not costed in any document                                            |
| D. Send back                                                       | Owner states a different reading; architecture §3.2.1 and ADR Decision 6 revised                                                          |

**Security / privacy implications.** No path in A stores memory after a revoke commits (write step
re-reads job and consent under the `identity.users` lock). Window (a) means memory loaded before the
revoke can influence the remainder of one answer. Window (b) means one user message may reach the
ai-service after revocation (mock-only in Phase 03; a live data flow only once APP-1 is approved).

**Reliability implications.** B depends on deployment topology; documenting it as a guarantee would
be inaccurate once more than one API instance runs. A is deterministic and testable (T-CON-*,
T-RACE-01/03/18).

**Milestone impact.** Blocks ADR acceptance. A: no scope change. B: small M4a/M3 addition plus a
disclosed topology limitation. C: new design work before M4a.

**What approval would mean.** "Immediately" in D6 is read as defined; tests and user copy are built
to that definition.

**What approval would not mean.** Not a legal opinion on whether the definition satisfies consent
law; LEG-1/LEG-2 may still require copy changes.

**Unresolved after approval.** Whether counsel accepts the reading (add to LEG-1 if the owner wants
it reviewed — see legal checklist §2.1 Q-1.6).

**Evidence assessment.** Trade-off between strictness and complexity. No recommendation.

---

### 2.3 OD-04 — Gate 03 status and deletion-reflection test definition (validation M-07)

Two separate acknowledgements are bundled under this ID.

**Part 1 — Gate 03 expected NOT PASSED at the end of M0–M7.**

Facts: Gate 03 needs Gate 02 GO (D1; today **NO-GO** **[V]** `docs/PHASE_02_REPORT.md` §7), an
approved live extraction run (APP-1) and a human-reviewed live extraction set, plus legal review
(closure checklist §5 rows G-1, G-7, G-8, G-9). None is inside the M0–M7 plan. This is a
consequence of D1, not a design choice; the only alternative is to add those items to the plan,
which needs separate approvals (APP-1, APP-6).

**Part 2 — Deletion-reflection test (arch §13.3).** Proposed: save a memory in thread A; confirm
retrieval in a different memory-enabled thread B; edit or delete it; the next relevant turn in B (or
new thread C) must not contain the deleted/pre-edit item in `memory_context`, proven by the request
captured at the AI stub **and** `memory.access_events`. Same-thread history is out of scope and
disclosed in the delete dialog.

| Option                                | Effect                                                                                                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A. Definition as written              | Deterministic on the mock gateway; measures memory, not model wording                                                                                              |
| B. Also cover same-thread history     | Would require deleting/redacting the source message or excluding it from history — a conversation-history change not designed in Phase 03 (§1.3 separates the two) |
| C. Measure model output (answer text) | Non-deterministic; needs live models (outside plan, APP-1)                                                                                                         |

**Security / privacy implications.** Under A a user who deletes a memory can still see the original
statement reach the model through the same thread's history. The design mitigates by disclosure,
not by mechanism, and offers `delete_memories=true` on thread deletion.

**Milestone impact.** Blocks ADR acceptance. A: T-RET-04 in M4b/M7. B: new design + scope in M3/M4b.

**What approval would mean.** M7 records Gate 03 as NOT PASSED with named blockers, which is the
expected outcome, not a failure of the plan; G-4 is measured by the stated test.

**What approval would not mean.** Not a Gate 03 pass, not a commitment to reach Gate 03 by any date,
not approval of APP-1 or Gate 02.

**Unresolved after approval.** Gate 02 path; the user-facing disclosure copy (legal, LEG-2/OD-02).

**Evidence assessment.** Part 1 is a recorded fact. Part 2 is a trade-off. No recommendation on
Part 2.

---

### 2.4 OD-05 — Extraction-job retention category

**Existing proposal.** Accept `memory.extraction_jobs` rows as a new, content-free retention
category, provisional under D12: 30 days after terminal state; deleted with the source message (FK
cascade); non-terminal rows terminated after 24 h (`failed/abandoned_stale`). Durations are DB
constants changed only by reviewed migration (arch §11, §5.3).

**What a row holds.** Ids, status, outcome code, counts, timestamps, attempt counters, policy
version — no memory or message text (arch §4.3). One field is worth the owner's attention:
`rejected_class` records the most restrictive rejection class (`secret`, `sensitive`, `minor`,
`invalid`). That is content-free but still says that a given message was classified as sensitive or
minor-related, for the retention period. Rows appear in exports (arch §10.2) and drive the
`/v1/memory/activity` chips.

**Alternatives.**

| Option                                  | Effect                                                                                                                                                                                |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Accept as provisional (as written)   | Durations stay provisional; legal review under LEG-4                                                                                                                                  |
| B. Accept category, different durations | Owner sets other provisional constants; migration text changes only                                                                                                                   |
| C. Delete job rows at terminal state    | Loses idempotency evidence (one job per source message, `REJECT_DUPLICATE` workflow id), activity chips and the stale-job audit trail; arch §8.5 relies on the row to reject re-kicks |
| D. Reject the category                  | ADR Decision 8 cannot stand as written; send back                                                                                                                                     |

**Security / reliability implications.** Content-free by design, so privacy impact is metadata only
(that a user message existed, its outcome and, if rejected, its rejection class). The 24 h max age is the bound that stops
never-started workflows from hanging forever (closed workflow ids cannot be reused). Shorter
retention reduces metadata; zero retention removes the duplicate guard.

**Milestone impact.** Blocks ADR acceptance. Constants created in M2a, used in M2b/M5b.

**What approval would mean.** The category exists and is covered by D12's "categories approved,
durations provisional" rule.

**What approval would not mean.** Not legal approval of 30 days or 24 h; not a user-facing promise.

**Unresolved after approval.** LEG-4 (durations); whether legal requires the category in notice text.

**Evidence assessment.** The documents show the category is needed for the D10 design; the
durations are explicitly provisional. Durations are a legal matter, not a recommendation here.

---

### 2.5 OD-08 — Roadmap deviations (validation M-13)

`karen_phases.md` is not edited; deviations are recorded in arch §1.4 and the ADR "Deviations"
section. The owner acknowledges them, or rejects specific ones.

| #   | Roadmap item                                                           | Phase 03 design                                                    | Recorded reason                                           | If rejected                                               |
| --- | ---------------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------- | --------------------------------------------------------- |
| 1   | Tables `facts/preferences/episodes/conflicts/deletion_jobs/embeddings` | One `items` table + `suggestions`; no `deletion_jobs`/`embeddings` | Identical lifecycle; deletion synchronous (D10); D3       | Schema redesign (M2a), triples RLS/deletion surface       |
| 2   | FTS + vectors + fusion                                                 | FTS-first                                                          | **Already approved** as D3                                | Contradicts D3                                            |
| 3   | Per-item "disable"                                                     | Not built                                                          | Avoids a third state with its own retention/restore rules | New state, retention rule and UI in M2a/M3/M6             |
| 4   | Per-memory `sensitivity` field                                         | Not stored                                                         | Sensitive items cannot be stored (D9)                     | Column with no valid non-default value until legal review |
| 5   | Per-memory consent-purpose field                                       | Not stored                                                         | Only `MEMORY_STORAGE` creates items (D5)                  | Column with one value                                     |
| 6   | Retrieval audit "matching confidence … source date"                    | Rank + reason; source date on the item                             | Deterministic equivalent; no duplicated metadata          | Extra columns in `access_events`                          |
| 7   | "Token savings" metric                                                 | Not measured; character budgets                                    | No token counter exists in the API **[V]**                | Token counting design (new)                               |
| 8   | KMS for memory content                                                 | RDS storage encryption only (as all data) **[V]**                  | Column-level encryption exists nowhere; cross-cutting     | Cross-cutting encryption ADR before M2a                   |
| 9   | Redis memoization for permitted content                                | No Redis memory content at all                                     | Stricter; removes a deletion/isolation target             | Adds a cache to every deletion path                       |
| 10  | Gateway structured output in extraction                                | Moved to the live-extraction package (APP-1)                       | Only live extraction needs it                             | M5a scope grows by work not usable until APP-1            |

**Security implications.** Deviations 8 and 9 are the security-relevant ones: 9 is stricter than the
roadmap; 8 keeps memory at the same encryption level as all other personal data (including
messages, which hold the same text).

**Milestone impact.** Blocks ADR acceptance. Rejecting 1, 3 or 8 changes M2a before it starts.

**What approval would mean.** The deviations are the accepted Phase 03 scope; the roadmap text stays
as the long-term reference.

**What approval would not mean.** Not an edit of `karen_phases.md`; not a permanent rejection of the
roadmap items (embeddings have a measured trigger, §6.8).

**Unresolved after approval.** None for M0–M7. Deviation 8 may resurface in a security review (P-7).

**Evidence assessment.** Each deviation has a recorded reason; the owner may accept all, or reject
individual rows. No overall recommendation.

---

### 2.6 OD-09 — Additions outside D1–D13

Validation §4 lists scope not covered by any owner decision. Each needs explicit acceptance so it
does not enter silently.

| Addition                                             | Origin                                                      | Purpose                                             | If rejected                                                                                      |
| ---------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `memory.user_settings` + "ask before saving"         | D7 _recommendation_, not the §17 condition                  | Lets a user force tier-1 saves through confirmation | One table fewer; tier-1 rule loses one condition; settings endpoints removed                     |
| `POST /v1/memory/restore`                            | Needed by D6 condition (re-grant must not silently restore) | The "Restore" choice on the re-grant card           | D6 card would only offer delete/decide-later — owner would need to revisit D6's "clear policy"   |
| `POST /v1/memory/{id}/undo`                          | D7 condition says "stored with Undo"                        | The Undo for tier-1 saves                           | Contradicts D7 wording; send back                                                                |
| `GET /v1/memory/activity`                            | Design                                                      | Extraction-outcome chips per thread                 | Users get no in-thread signal of what was saved/suggested; D8 "status clear in the UI" is weaker |
| `DELETE /v1/conversations/{id}?delete_memories=true` | Validation M-05                                             | Atomic "delete chat and its memories"               | Two-call client flow; partial failure leaves memories (M-05)                                     |
| Per-user caps: 500 items, 50 suggestions             | Design                                                      | Bound storage and prompt-assembly work              | Unbounded per-user growth                                                                        |
| 100 extraction jobs per user per day                 | Design (§12.3)                                              | Bound cost and abuse in addition to usage limits    | Usage limits alone bound cost                                                                    |

All numbers are provisional engineering defaults.

**Security / reliability implications.** Caps and the daily job limit are abuse and cost controls;
removing them leaves only the usage limiter. The restore and undo endpoints write content and
require consent (arch §3.7). The activity endpoint returns no new content.

**Milestone impact.** Blocks ADR acceptance. Items land in M2a (settings table), M3 (endpoints,
caps), M5b (job limit), M6 (UI).

**What approval would mean.** These become in-scope Phase 03 items with provisional numbers.

**What approval would not mean.** Not approval of the numbers as final; not legal approval of any
copy that mentions them.

**Unresolved after approval.** Final cap values (evaluated with real usage; none exists yet).

**Evidence assessment.** Undo and restore follow directly from D7 and D6 wording. The settings
table, activity endpoint and limits are design choices. Trade-off per item; no overall
recommendation.

---

## 3. Additional owner decisions

### 3.1 OD-11 — Sealing the evaluation datasets before M1 (03C-03, validation M-08)

**Issue.** M-08 requires held-out test splits authored separately from tokeniser/lexicon work and
sealed (SHA-256 recorded) before tuning. Tokeniser and lexicon work happens in **M1**. The
architecture's "fixed before M4b" therefore leaves M1 tuning un-separated from the test set.

| Option                                                       | Effect on M1                                                                                                               | Independence of M7 numbers                                        |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| (a) Seal both test splits (retrieval + extraction) before M1 | M1 prerequisite: ≥ 600 retrieval test queries (≥ 150 per threshold slice) and the extraction set authored and hashed first | Preserved (sealed before tuning)                                  |
| (b) A different author writes the test splits                | Needs a second person; none is recorded (single maintainer, §Q8 **[V-gh]**)                                                | Preserved                                                         |
| (c) Accept and disclose                                      | No new prerequisite                                                                                                        | Not independent; every M7 threshold result labelled so (register) |

**Security implication.** The zero-tolerance metrics (wrong-user recall, SECRET/SENSITIVE stored)
are pipeline properties on a set; a set tuned against is weaker evidence of lexicon coverage
(named residual risk: lexicon false negatives).

**Milestone impact.** (a) delays M1 start by dataset authoring effort (not estimated in any
document). (b) needs a reviewer who does not exist today. (c) none, but G-6 evidence quality drops.

**What approval would mean.** The chosen rule is added to Q9's dataset rules and M1/M4b
prerequisites.

**Unresolved after approval.** Q9 thresholds (before M7) and per-slice minimums remain open.

**Evidence assessment.** The evidence clearly shows (a) and (b) preserve independence and (c) does
not; it does not show the effort cost of (a). Choice depends on the owner's tolerance for delay vs
weaker evidence.

### 3.2 OD-12 — NEW-1 remediation order relative to M2a (03C-04)

**Issue.** M2a must `CREATE OR REPLACE identity.erase_user` to add memory deletes. That function's
first statement is the NEW-1 unscoped read of FORCEd `consent.data_rights_requests`
(`20261121100000_conversation_phase02/migration.sql:345-346` **[V]**).

| Option                                                                                                          | Pros                                                               | Cons                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a) NEW-1 fix lands first; M2a builds on it                                                                     | M2a erasure tests can run under a non-superuser owner meaningfully | M2a waits for the D11-track fix (option among B4 (a)–(d) not chosen); NEW-1 fix needs its own task, PR and approval                                         |
| (b) M2a carries the current body unchanged + memory deletes; NEW-1 fix follows and must keep the memory deletes | M2a is not blocked                                                 | Two migrations redefine the same function; M2a's erasure tests pass only because local owner is a superuser; regression risk managed by rule, not mechanism |

**Security / reliability implications.** Under either option, erasure on a non-superuser-owned
database (AWS) fails until NEW-1 is fixed (SR-EXP-04 "FAILS by analysis today"). Nothing is
deployed in Phase 03, so the user-facing impact today is nil; it becomes a legal-obligation failure
(account erasure) on the first AWS deployment.

**Milestone impact.** (a) inserts the NEW-1 fix before M2a. (b) adds the no-regression rule to M2a
(already written in arch §10.1) and a later NEW-1 PR.

**What approval would mean.** The chosen order is written into M2a prerequisites and the NEW-1
track.

**What approval would not mean.** Not a choice of NEW-1 remediation option (Part B4); not approval
to deploy.

**Unresolved after approval.** B4 option; RDS reproduction (Part B3, **[NV]**).

**Evidence assessment.** Trade-off between schedule and verification strength. No recommendation.

### 3.3 OD-06 — Export invalidation after memory deletion (validation M-04)

**Issue.** A stored data export (`consent.data_rights_requests.export_payload`) is scrubbed at
expiry (`DATA_EXPORT_TTL_HOURS`, default 168 h **[V]**) or erasure. Deleting a memory does not scrub
an unexpired export, so the user's own export can contain deleted memory text for up to 7 days. The
same window already exists for deleted messages **[D]** (arch §10.3).

| Option                                          | Effect                                                                                                                  |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| A. Disclose the window (existing proposal)      | No M3 scope change; disclosure copy is legal (LEG-5)                                                                    |
| B. Invalidate unexpired exports on delete/clear | M3 scope grows; touches the data-rights module (outside memory); inconsistent with messages unless also applied to them |
| C. Shorten `DATA_EXPORT_TTL_HOURS`              | Narrows the window for all data; affects existing data-rights behaviour; a D12/legal duration question                  |

**Security implication.** The export is accessible only to the same user (owner policy). The risk
is a deleted item persisting in a file the user already requested, not exposure to others.

**Milestone impact.** Blocks M3. B also expands M3 into `DataRightsService`, which is NEW-1-affected
code.

**Unresolved after any option.** Disclosure wording (LEG-5); consistency with message deletion.

**Evidence assessment.** Trade-off; B's interaction with NEW-1-affected code is a cost the
documents identify. No recommendation.

### 3.4 OD-10 — NEW-1 tracking location

**Issue.** NEW-1 (Part B of the security checklist) is assigned to "the D11 hardening track", but no
artefact for that track exists outside `docs/phase-03/` **[V]** (`grep` for "hardening track" and
"D11" across `docs/` and the roadmap files finds only Phase 03 documents and ADR-0036). The register
says "fix and verify before any AWS deployment".

Facts relevant to location:

- The repository is **public** **[V-gh]**. Today the Phase 03 documents are **uncommitted** **[V]**,
  so NEW-1's details are not yet published. Committing `docs/phase-03/` publishes them. GitHub
  issues are public on this repository (`has_issues: true` **[V-gh]**).
- No AWS deployment exists that runs data-rights workflows (deploy workflow is inactive by
  `DEPLOYMENTS_ENABLED` guard **[V]** `.github/workflows/deploy.yml`), so the defect is not
  currently exploitable in a running system; it is a latent availability failure of erasure/export,
  not a data-exposure path.

| Option                                                                    | Visibility                      | Notes                                                                                        |
| ------------------------------------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------- |
| A. Keep in checklist Part B + register (status quo)                       | Public once committed           | Already complete (B1–B6); no separate owner, date or PR link                                 |
| B. New S-item in `docs/security/remediation-plan.md`                      | Public once committed           | Puts it with existing platform security items (S-01…); outside Phase 03 scope                |
| C. GitHub issue                                                           | Public                          | Trackable, linkable from PRs                                                                 |
| D. Private GitHub security advisory (draft repository advisory)           | Private to admins/collaborators | Available on public repositories per GitHub docs **[NV here]**; not used in this repo before |
| E. A new D11-track document (e.g. `docs/security/force-rls-hardening.md`) | Public once committed           | Gives the 12 exclusions + NEW-1 + `purge_expired` parameters one home                        |

Options are not exclusive (e.g. D for the details, A/B/E for a non-detailed pointer).

**Milestone impact.** None on M0–M7. Gates production (P-2).

**What approval would mean.** NEW-1 has a named home, owner and target ("before any AWS
deployment that runs data-rights workflows").

**Unresolved after approval.** Remediation option (B4); RDS verification; whether committing
detailed findings to a public repo is acceptable (owner call — affects all Phase 03 security
documents, not only NEW-1).

**Evidence assessment.** "Fix before AWS" is strongly supported. The location is an owner
preference with a disclosure trade-off. No recommendation on location.

### 3.5 OD-13 — Backup restoration and deletion reconciliation (03C-08)

**Issue.** A backup or point-in-time restore brings back deleted memories, suspended memories past
their grace, revoked consent state and erased accounts. No runbook re-applies deletions
(`docs/runbooks/` has none **[V]**). RDS `backup_retention_period` is a variable (1–35 days) **[V]**;
production 30 days per architecture **[D]**. Pre-existing for all user data; memory makes it more
visible.

| Approach (examples; none designed)                                                                             | Trade-off                                                                                                |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| A. Deletion/erasure ledger (content-free ids + timestamps) replayed after restore                              | Needs a durable, separately backed-up ledger that itself has a retention rule; replay must be idempotent |
| B. Runbook-only: after restore, re-run erasures from `data_rights_requests` and consent revocations from audit | Depends on those records surviving the restore window; manual; does not cover single-memory deletes      |
| C. Disclose only ("deleted data may persist in backups for up to N days")                                      | No mechanism; restore still resurrects; disclosure is legal (LEG-5)                                      |

**Security / privacy implication.** High for production: deletion guarantees (D6, D10, data rights)
hold only until the first restore. Not a Phase 03 M0–M7 risk (nothing deployed).

**Milestone impact.** None on M0–M7 (register: production-readiness item). P-4 needs approach,
runbook and a drill (T-AWS-06).

**What approval would mean.** Choosing a track and owner for the gap; not choosing the mechanism
yet unless the owner wishes.

**Unresolved after approval.** Mechanism design, legal disclosure (LEG-5), drill.

**Evidence assessment.** The gap is verified; the approach is open. No recommendation.

---

## 4. Items preserved unchanged

This packet does not change any of the following; they stay as in the register.

### 4.1 Governance

| ID    | Item                                  | Blocks    | Status                                          | Prepared in 03D                  |
| ----- | ------------------------------------- | --------- | ----------------------------------------------- | -------------------------------- |
| GOV-1 | Branch protection on `main`           | IMPL (M0) | **OPEN** (404 re-checked 2026-11-23 **[V-gh]**) | Branch protection recommendation |
| GOV-2 | D1 written approval                   | IMPL      | **OPEN**                                        | D1 approval template             |
| GOV-3 | Accept ADR-0036                       | IMPL, M2a | **OPEN**                                        | — (needs §2 decisions)           |
| GOV-4 | D2 rename + banner + ADR-0026 erratum | M0        | **OPEN**                                        | —                                |
| GOV-5 | D4 free catalog inspection note       | M0, M7    | **OPEN**                                        | —                                |
| GOV-6 | Authorise Task 04 (M0 → M1)           | IMPL      | **OPEN**                                        | —                                |

### 4.2 Owner decisions not covered above

| ID    | Item                                             | Blocks | Decision-maker  | Status   |
| ----- | ------------------------------------------------ | ------ | --------------- | -------- |
| OD-02 | Dates/durations in product copy; interim wording | REL    | Owner + legal   | **OPEN** |
| OD-07 | Scope of "minors' data"                          | REL    | Legal (+ owner) | **OPEN** |

### 4.3 Q-series (register §3–§4, unchanged)

| ID  | Item                                                     | Blocks (unchanged)                                                      | Status                             |
| --- | -------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------- |
| Q1  | Live models honouring JSON-schema output via OpenRouter  | Live extraction approval package (APP-1)                                | **OPEN** **[NV]**                  |
| Q2  | Devanagari word boundaries under the RDS `LC_CTYPE`      | M4b (F1 vs F2)                                                          | **OPEN**                           |
| Q3  | `pg_trgm` on target RDS PG17                             | F3 PR only (APP-3)                                                      | **OPEN**                           |
| Q4  | Maintenance design                                       | ADR, M2b                                                                | **OPEN** (= OD-01)                 |
| Q5  | `MEMORY_STORAGE` notice text, version, eligible versions | REL                                                                     | **OPEN** (legal)                   |
| Q6  | Suspension audit row: trigger or API                     | M2a                                                                     | **OPEN**                           |
| Q7  | Export format: additive `memory` under v1 or bump to v2  | M3                                                                      | **OPEN**                           |
| Q8  | Single-maintainer exception wording                      | IMPL (M0)                                                               | **OPEN** — wording proposed in 03D |
| Q9  | Thresholds and dataset validity rules                    | Dataset rules before M4b (before M1 if OD-11 (a)); thresholds before M7 | **OPEN**                           |
| Q10 | Enqueue extraction for `failed`/`canceled` replies       | M5a                                                                     | **OPEN**                           |
| Q11 | `MEMORY_EXTRACTION_RESERVE_USD` for a live model         | APP-1                                                                   | **OPEN**                           |
| Q12 | Thread deletion keeps memories by default; copy; option  | M3 (server), M6 (default, copy)                                         | **OPEN**                           |
| Q13 | "Yes, remember that" about an earlier turn               | —                                                                       | DOCUMENTED LIMITATION              |
| Q14 | `PERSONALIZATION` revocation has no memory effect        | M3 (confirm)                                                            | DOCUMENTED LIMITATION              |
| Q15 | 12-month reconfirm prompt                                | M6                                                                      | **OPEN**                           |
| Q16 | `clear` cancels in-scope pending jobs                    | — (A-8 at ADR review)                                                   | ADOPTED-ENG                        |

### 4.4 Legal and separate approvals

LEG-1…LEG-5 and APP-1…APP-6 are unchanged; see the register §5–§6 and
`PHASE_03_LEGAL_REVIEW_CHECKLIST.md`.

---

## 5. Recording form (blank — for the owner)

The owner records decisions in `PHASE_03_DECISION_REGISTER.md` (Status column and a dated note), in
the same form as `PHASE_03_OWNER_DECISIONS.md` §17. This form is a convenience; it is intentionally
empty. A filled-in copy of this table is not itself a decision until the owner records it in the
register.

| ID    | Option chosen / "acknowledged" / "sent back" | Owner conditions | Owner | Date |
| ----- | -------------------------------------------- | ---------------- | ----- | ---- |
| OD-01 |                                              |                  |       |      |
| OD-03 |                                              |                  |       |      |
| OD-04 |                                              |                  |       |      |
| OD-05 |                                              |                  |       |      |
| OD-08 |                                              |                  |       |      |
| OD-09 |                                              |                  |       |      |
| OD-11 |                                              |                  |       |      |
| OD-12 |                                              |                  |       |      |
| OD-06 |                                              |                  |       |      |
| OD-10 |                                              |                  |       |      |
| OD-13 |                                              |                  |       |      |
| Q16   | (A-8: as adopted / overridden)               |                  |       |      |

_End of packet. Nothing in this document is decided, approved or authorised._
