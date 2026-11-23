# KAREN — Phase 03 — Documentation readiness and closure report (Task 03C)

- **Date:** 2026-11-23 · **Baseline:** `main` @ `e5ff562` · **Branch:** `main` (working tree only)
- **Type:** documentation only. No application code, migrations, schemas, API contracts,
  dependencies, infrastructure or CI configuration were changed. Nothing was committed, pushed or
  merged. ADR-0036 was **not** accepted. Gate 03 was **not** marked passed. No owner or legal
  approval was assumed. D1–D13 were not changed.
- **Not to be confused with** `docs/PHASE_03_REPORT.md`, the end-of-phase evidence report that
  M7 will write.

---

## 1. Verdict

**Documentation package COMPLETE and internally consistent — READY FOR OWNER REVIEW. Not
approved, not authorised, not passed.**

| State (closure checklist §1) | Status                                                                                                    |
| ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| S1 Documentation complete    | **Reached** (this report), pending owner review                                                           |
| S2 Architecture/ADR accepted | **No.** ADR-0036 **Proposed**; 6 owner decisions block it (§5)                                            |
| S3 Implementation authorised | **No.** Branch protection absent (`404` **[V-gh]**, re-checked today), Q8, D1 approval, S2                |
| S4 Milestones completed      | **None started** (no Phase 03 code exists)                                                                |
| S5 Gate 03 passed            | **No.** Expected **NOT PASSED** at the end of M7 (needs Gate 02 GO, live extraction, human review, legal) |
| S6 Production approved       | **No.** Also blocked by NEW-1, backup-restore gap (OD-13), legal review                                   |

---

## 2. What was done in Task 03C

1. Read in full: architecture Revision 2, ADR-0036, Task 03B corrections, owner decision register
   §14–§17, validation report; `karen_phases.md` PHASE 03; `docs/PHASE_02_REPORT.md` §7 (Gate 02
   NO-GO **[V]**); `docs/PHASE_01_CLOSURE_CHECKLIST.md` (convention for the closure checklist);
   `docs/adr/README.md` and ADR naming.
2. Re-verified evidence used by new findings: branch protection (`gh api …/branches/main/protection`
   → 404 **[V-gh]**); NEW-1 source lines (`…consent_data_rights/migration.sql:52-61`,
   `…conversation_phase02/migration.sql:336-357` **[V]**); list of FORCEd tables and definer
   functions by `grep` **[V]**; rate-limit decorators (`apps/api/src/common/rate-limit.ts` **[V]**);
   absence of any restore runbook in `docs/runbooks/` **[V]**; RDS `backup_retention_period`
   variable (1–35 days) **[V]**; `ci.yml` job names **[V]**.
3. Checked consistency across architecture, ADR, corrections report, owner register and roadmap
   (§4); fixed contradictions the evidence clearly resolves; recorded the rest as owner decisions.
4. Wrote the missing deliverables (§3) and aligned the architecture (Revision 3) and ADR.

## 3. Deliverables

| #   | Required deliverable                        | File                                                                         | Change                  |
| --- | ------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------- |
| 1   | Final Phase 03 architecture                 | `docs/phase-03/PHASE_03_MEMORY_ARCHITECTURE.md` (Revision 3)                 | Updated                 |
| 2   | Final proposed ADR-0036                     | `docs/adr/0036-personal-memory-architecture.md` (Proposed)                   | Updated                 |
| 3   | Milestone execution plan                    | `docs/phase-03/PHASE_03_MILESTONE_PLAN.md`                                   | New                     |
| 4   | Security and reliability checklist          | `docs/phase-03/PHASE_03_SECURITY_RELIABILITY_CHECKLIST.md` (NEW-1 in Part B) | New                     |
| 5   | Testing and evaluation strategy             | `docs/phase-03/PHASE_03_TEST_STRATEGY.md`                                    | New                     |
| 6   | Consolidated owner/legal decision register  | `docs/phase-03/PHASE_03_DECISION_REGISTER.md`                                | New (supersedes 03B §3) |
| 7   | Traceability matrix                         | `docs/phase-03/PHASE_03_TRACEABILITY_MATRIX.md`                              | New                     |
| 8   | Readiness and closure report                | `docs/phase-03/PHASE_03_READINESS_REPORT.md` (this file)                     | New                     |
| —   | Acceptance criteria and gates (work item F) | `docs/phase-03/PHASE_03_CLOSURE_CHECKLIST.md`                                | New                     |
| —   | Package index                               | `docs/phase-03/README.md`                                                    | New                     |
| —   | Pointer to the live register                | `docs/phase-03/PHASE_03_TASK_03B_CORRECTIONS.md` §3 (one note added)         | Updated                 |

Not modified (deliberately): `PHASE_03_OWNER_DECISIONS.md` (authority baseline),
`PHASE_03_ARCHITECTURE_VALIDATION.md`, `PHASE_03_REPOSITORY_AUDIT.md` (historical records),
`karen_phases.md` (deviations are recorded, not edited in), `docs/adr/README.md` (indexing happens
at acceptance, M0), `docs/PHASE_03_MULTIMODAL_PLAN.md` (D2 rename is an M0 action), and every
file outside `docs/phase-03/` and the ADR.

## 4. Consistency review and Task 03C findings

### 4.1 Areas checked

| Area (task brief §4A)                       | Result                                                                                                        |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| System boundaries and service ownership     | Consistent (arch §2.1 ↔ ADR 1 ↔ `service-boundaries.md` planned `memory` module **[V]**)                      |
| Database ownership, transaction boundaries  | Consistent after 03C-01/02 (savepoint proof timing, M4b → M5b)                                                |
| Creation, extraction, validation, retrieval | Consistent (arch §6–§8 ↔ ADR 7–10)                                                                            |
| Consent, revocation, deletion               | Consistent; "immediately" awaits OD-03                                                                        |
| RLS and user isolation                      | Consistent after 03C-05 (constants once); NEW-1 interaction made explicit (03C-04)                            |
| Export, restore, undo, erasure              | Consistent; export window OD-06; backup-restore gap new (03C-08)                                              |
| Temporal workflows and retries              | Consistent                                                                                                    |
| Retention and cleanup                       | Consistent; all durations provisional (D12), DB constants for cross-user bounds                               |
| AI-service contracts                        | Consistent (v5; no JSON-schema gateway work)                                                                  |
| Feature flags and rollout                   | Consistent: flag off everywhere; D13 "flag off until the gate" and ADR "separate written approval" both apply |
| Security, observability, failure handling   | Consistent; on-call routing not designed (production item)                                                    |
| Testing and evaluation                      | Consistent after 03C-03 is decided (OD-11)                                                                    |
| Milestone dependencies and gate criteria    | Consistent after 03C-01/02; Gate 03 outside-plan rows explicit                                                |
| Roadmap                                     | Deviations recorded (arch §1.4, ADR) — awaiting OD-08                                                         |

### 4.2 Findings

| ID     | Finding                                                                                                  | Resolution                                                      |
| ------ | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 03C-01 | M4b put writes behind the `finalize()` savepoint, but the savepoint was to be proven only in M5a         | **Resolved** — proof required in M4b, re-run in M5a             |
| 03C-02 | M5b's dependency on M4b (same savepoint/callback) was missing from the order line                        | **Resolved** — M4b → M5b                                        |
| 03C-03 | M-08's "seal before tuning" means before M1's tokeniser/lexicon work, not only before M4b                | **Owner decision OD-11**                                        |
| 03C-04 | M2a redefines `identity.erase_user`, the function containing the NEW-1 read                              | **Owner decision OD-12**; no-regression rule added              |
| 03C-05 | The 30-day job retention appeared as a literal in the trigger and as a constant in the purge             | **Resolved** — one `IMMUTABLE` function per constant            |
| 03C-06 | Two cross-references pointed at the wrong section (§9.4/§13.4 instead of §13.5)                          | **Resolved**                                                    |
| 03C-07 | The 03B register said OD-07 blocks M1; the architecture and validation say legal scope is a release gate | **Resolved** in the register (release gate; follow-up if wider) |
| 03C-08 | A backup/point-in-time restore would resurrect deleted or erased data; no runbook re-applies deletions   | **Owner decision OD-13** (production readiness)                 |
| 03C-09 | Rate limiting on memory routes was unspecified                                                           | **Resolved** as an M3 requirement                               |
| 03C-10 | `docs/security/data-isolation.md` Layer 3 text is stale ("no SQL creates the roles")                     | Assigned to M2a's doc updates (file outside this task's scope)  |
| 03C-11 | Branch protection still absent                                                                           | Unchanged blocker GOV-1                                         |

No finding required changing an owner decision, and none changes a design decision of
Revision 2.

## 5. What remains unresolved

### 5.1 Blocks ADR-0036 acceptance (owner)

OD-01 (maintenance design / Q4) · OD-03 ("immediately") · OD-04 (Gate 03 expected NOT PASSED;
deletion-reflection test) · OD-05 (job-row retention category) · OD-08 (roadmap deviations) ·
OD-09 (additions beyond D1–D13). Q16 stays as adopted unless the owner overrides it.

### 5.2 Blocks implementation authorisation

GOV-1 branch protection (still 404) · Q8 single-maintainer exception · GOV-2 D1 written approval
· GOV-3 ADR-0036 accepted (→ §5.1) · GOV-6 owner authorises Task 04. Milestone-specific:
OD-11 (M1/M4b), OD-12 and Q6 (M2a), OD-01 (M2b), OD-06, Q7, Q12, Q14 (M3), Q9 dataset rules and
Q2 (M4b), Q10 (M5a), Q12, Q15 (M6), Q9 thresholds (M7).

### 5.3 Blocks Gate 03

Gate 02 GO (APP-6; today NO-GO) · live extraction approval (APP-1) · human-reviewed live
extraction set · Q9 thresholds on sealed test sets · every zero-tolerance metric at 0 · legal
review LEG-1…LEG-4. Three of these are outside the M0–M7 plan, so Gate 03 is expected **NOT
PASSED** at M7.

### 5.4 Blocks production readiness

Gate 03 · NEW-1 fixed and verified on RDS (OD-10; checklist Part B) · backup-restore deletion
re-application (OD-13) · RDS verification (T-AWS-01/03/05, T-PERF-03) · dashboards, alerts and
on-call · legal sign-off (Q5, OD-02, OD-06, OD-07, LEG-1…LEG-5) · security review · written
approvals APP-4/APP-5 · pre-existing platform gates (Phase 00/01 closure, Phase 02 "production
launch NO-GO").

### 5.5 Legal dependencies (no legal approval exists)

LEG-1 D5 re-confirmation and notice (Q5) · LEG-2 D6 grace, delete-now default, dates/durations in
copy (OD-02) · LEG-3 D9 categories, refusal copy, minors' scope (OD-07) · LEG-4 D12 durations incl.
job rows (OD-05) · LEG-5 export-window and backup/restore disclosure (OD-06, OD-13).

### 5.6 Security and reliability blockers

| Item                                         | Severity            | Blocks                       |
| -------------------------------------------- | ------------------- | ---------------------------- |
| NEW-1 FORCE RLS vs definer data-rights reads | High for production | PROD; M2a sequencing (OD-12) |
| Backup/PITR restore resurrects deleted data  | High for production | PROD (OD-13)                 |
| Branch protection absent                     | Process control     | IMPL                         |
| On-call routing for memory alerts            | Medium              | PROD                         |
| Shared internal HMAC secret (L-06)           | Accepted residual   | —                            |
| Lexicon false negatives                      | Named residual risk | — (evaluated M7)             |

## 6. Milestone readiness

| Milestone | Ready to start?            | Waiting on                         |
| --------- | -------------------------- | ---------------------------------- |
| M0        | Ready for the owner to act | Owner: GOV-1, Q8, ADR items, GOV-2 |
| M1        | No                         | M0 exit; OD-11                     |
| M2a       | No                         | M1; ADR accepted; Q6; OD-12        |
| M2b       | No                         | M2a; OD-01                         |
| M3        | No                         | M2a; OD-06, Q7, Q12, Q14           |
| M4a       | No                         | M3                                 |
| M4b       | No                         | M4a; Q9 dataset rules; OD-11; Q2   |
| M5a       | No                         | M4a, M1; Q10                       |
| M5b       | No                         | M5a, M2b, M4b                      |
| M6        | No                         | M3, M5b; Q12, Q15 (release: legal) |
| M7        | No                         | M4b, M5b, M6; Q9 thresholds        |

## 7. What the owner must decide next (in this order)

1. **Review the package** starting with this report and `PHASE_03_DECISION_REGISTER.md`.
2. **Enable branch protection on `main`** (GOV-1) with the exact CI job names, and record the Q8
   single-maintainer exception wording.
3. **Decide the six ADR blockers** OD-01, OD-03, OD-04, OD-05, OD-08, OD-09 (or send any back for
   revision). Then record ADR-0036 as Accepted in PR-M0-1 (after protection is on).
4. **Decide OD-11** (when to seal held-out test sets) before authorising M1, and **OD-12** (NEW-1
   sequencing) before M2a.
5. **Give the D1 written approval** and authorise Task 04 (M0 → M1) — or hold.
6. **In parallel:** schedule legal review (LEG-1…LEG-5); put NEW-1 (OD-10) and the backup-restore
   gap (OD-13) on the D11/production-readiness track.

## 8. Verification performed in Task 03C

All commands were read-only or documentation formatting. No test suite, build, migration or
database command was run (no code changed; `pnpm verify` and integration suites were therefore
not run, and nothing here claims they pass).

| #   | Check (brief §7)                                  | Command                                                                                                                            | Result                                                                                                                                                                                          |
| --- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Every deliverable exists                          | `wc -l docs/phase-03/*.md docs/adr/0036-…md`                                                                                       | **Pass** — 8 required deliverables + closure checklist + index present (§3)                                                                                                                     |
| 2   | Internal links and references                     | `python3 -I <scratchpad>/check_docs.py .` (relative Markdown links; backticked repo paths; `PHASE_03_*.md` names)                  | **Pass** — 0 broken links; 0 missing package documents. Backticked paths that do not exist are all proposed future files marked **[P]** (e.g. `apps/api/src/memory`, `docs/PHASE_03_REPORT.md`) |
| 3   | ID consistency                                    | same script: every referenced `T-…`, `SR-…`, `OD-/GOV-/LEG-/APP-` id is defined                                                    | **Pass** after fixing two gaps found by the check (`T-API-01…10` and `SR-UI-01…03` were referenced but undefined; both added). 120 test ids defined; Q1–Q16 all in the register                 |
| 4   | Architecture/ADR/roadmap consistency              | manual review (§4.1)                                                                                                               | **Pass** after 03C-01, 02, 05, 06, 07, 09; 03C-03, 04, 08 recorded as owner decisions                                                                                                           |
| 5   | Owner decisions accurately represented            | manual comparison with `PHASE_03_OWNER_DECISIONS.md` §17; file not modified (prettier reported it unchanged)                       | **Pass** — D1–D13 and both owner qualifications and the D5/D9 legal qualifications restated unchanged                                                                                           |
| 6   | Every validation finding has a disposition        | traceability matrix §2–§4                                                                                                          | **Pass** — H1–H7, M-01–M-13, L-01–L-11 (31), NEW-1, NEW-2, 03C-01…11                                                                                                                            |
| 7   | No unsupported acceptance or gate-passing claim   | `grep -i -E 'status: **accepted\|gate 03 … passed\|PASSED\|legal(ly)? approved\|owner approved'` over the package, minus negations | **Pass** — remaining hits are requirements ("requires G03 passed") or negations                                                                                                                 |
| 8   | Formatting                                        | `pnpm exec prettier --write` then `--check docs/phase-03/*.md docs/adr/0036-personal-memory-architecture.md`                       | **Pass** — "All matched files use Prettier code style!"                                                                                                                                         |
| 9   | Git diff and status                               | `git status --porcelain --untracked-files=all`; `git diff --stat`                                                                  | Branch `main` @ `e5ff562`; only untracked files under `docs/phase-03/` and `docs/adr/0036-…md`; `git diff --stat` empty (no tracked file changed)                                               |
| 10  | No code, migrations, infrastructure or CI changed | `git status --porcelain -uall \| grep -v -E '^\?\? docs/(phase-03/\|adr/0036-)'`                                                   | **Pass** — none                                                                                                                                                                                 |
| 11  | Branch protection (evidence for GOV-1)            | `gh api repos/arvindydv/karen/branches/main/protection` (read-only GET)                                                            | `404 Branch not protected` **[V-gh]**                                                                                                                                                           |

Not done: no `pnpm verify`, integration, Python or contract runs (nothing to verify; no code);
no AWS/RDS or OpenRouter access; no legal review; no commit, push or merge.

_End of Task 03C. ADR-0036 remains Proposed. Implementation is not authorised. Gate 03 is not
passed. Production is not approved._
