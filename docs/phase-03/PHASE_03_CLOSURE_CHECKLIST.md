# Phase 03 closure checklist — acceptance criteria and gates

- **Date:** 2026-11-23 (Task 03C). **Owner:** project owner. **Design:**
  `PHASE_03_MEMORY_ARCHITECTURE.md` (Revision 3) and ADR-0036 (Proposed).
- **Rule:** an item is ticked only **with an evidence link** (PR, CI run, recorded owner/legal
  decision, protection API output). A tick without evidence does not count. No item may be ticked
  on the basis of this documentation alone.
- **Current state (2026-11-23, M0):** owner decision session held; ADR-0036 **Accepted** (effective
  on merge of PR-M0-1); implementation authorised for **M0 → M1 only**; branch protection on. Gate 03 **NOT
  PASSED**. Gate 02 **NO-GO**. Production **not approved**.

---

## 1. The six states (each is separate; none implies the next)

| #   | State                     | Means                                                                       | Who records it         | Today                                       |
| --- | ------------------------- | --------------------------------------------------------------------------- | ---------------------- | ------------------------------------------- |
| S1  | Documentation complete    | The package is internally consistent and every open decision is listed      | Engineering (Task 03C) | **Reached**                                 |
| S2  | Architecture accepted     | The owner accepts the architecture **and** ADR-0036 (§2)                    | Owner                  | **Recorded**; effective on merge of PR-M0-1 |
| S3  | Implementation authorised | Entry conditions met (§3); the owner authorises Task 04 (M0 → M1)           | Owner                  | **M0 → M1 authorised** (M0 note §4)         |
| S4  | Milestones completed      | Each milestone's exit conditions met and merged into protected `main` (§4)  | Owner (merge)          | None started                                |
| S5  | Gate 03 passed            | Every Gate 03 criterion holds with evidence (§5)                            | Owner                  | No — expected **NOT PASSED** after M7       |
| S6  | Production approved       | Production-readiness review passed and written approval for enablement (§6) | Owner (+ legal)        | No                                          |

S1 does not imply S2. S2 does not authorise code (S3 does). S4 for all milestones does not pass
Gate 03 (§5 needs items outside the plan). S5 does not approve production (S6 does).

---

## 2. Architecture and ADR-0036 acceptance (S2)

The architecture and ADR are accepted together; ADR-0036 Decision text is the summary of the
architecture.

| #    | Criterion                                                                                                            | Evidence needed                      | Done                                                       |
| ---- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------- |
| A-1  | Owner reviewed Revision 3 together with the validation report, the 03B corrections and this package                  | Owner note                           | [x] M0 note §2 (acceptance recorded; review implied by it) |
| A-2  | OD-01 (maintenance design / Q4) decided                                                                              | Register entry updated               | [x] M0 note §2                                             |
| A-3  | OD-03 ("immediately" definition) acknowledged                                                                        | Register entry updated               | [x] M0 note §2                                             |
| A-4  | OD-04 (Gate 03 expected NOT PASSED; deletion-reflection test definition) acknowledged                                | Register entry updated               | [x] M0 note §2                                             |
| A-5  | OD-05 (extraction-job retention category) accepted as provisional                                                    | Register entry updated               | [x] M0 note §2                                             |
| A-6  | OD-08 (roadmap deviations) acknowledged                                                                              | Register entry updated               | [x] M0 note §2                                             |
| A-7  | OD-09 (additions outside D1–D13) accepted as provisional                                                             | Register entry updated               | [x] M0 note §2                                             |
| A-8  | Q16 (clear cancels jobs) left as adopted or overridden                                                               | Register entry updated               | [x] M0 note §2 (left as adopted)                           |
| A-9  | Legal qualifications restated unchanged (D5, D6, D9, D12) — already true in arch §15 and the ADR; the owner confirms | Owner note                           | [x] M0 note §2                                             |
| A-10 | ADR-0036 status line changed to Accepted with owner name and date; indexed in `docs/adr/README.md`                   | PR-M0-1 merged into protected `main` | [ ] on merge of PR-M0-1                                    |

Not required for S2 (they gate later states): OD-02, OD-06, OD-07, OD-10…OD-13, Q5, Q8, Q9, Q12,
Q15, legal items, separate approvals.

---

## 3. Implementation authorisation (S3) — D1 entry conditions

| #   | Criterion                                                                                                                      | Evidence needed                                 | Done                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- | --------------------------------------------------------- |
| 1   | `main` protected (GOV-1): PR required; required checks = exact `ci.yml` job names; no force push; no deletion; admins included | Protection API output (today: 404 **[V-gh]**)   | [x] M0 note §1                                            |
| 2   | Q8 single-maintainer exception wording recorded                                                                                | Owner note                                      | [x] M0 note §3                                            |
| 3   | S2 reached (§2)                                                                                                                | §2 all ticked                                   | [ ] on merge of PR-M0-1                                   |
| 4   | D1 written approval on the first Phase 03 PR (GOV-2)                                                                           | PR comment or M0 note                           | [x] M0 note §4 (M0 → M1)                                  |
| 5   | `MEMORY_FEATURE_ENABLED=false` default in every environment; ai-service live-extraction switch off; mock gateway only          | Config in the first PR that introduces the flag | [ ] flag introduced default-off with the first runtime PR |
| 6   | D2 rename + banner + ADR-0026 erratum (GOV-4)                                                                                  | PR-M0-1                                         | [x] PR-M0-1                                               |
| 7   | D4 free catalog inspection recorded (GOV-5)                                                                                    | M0 note                                         | [x] M0 note §5                                            |
| 8   | Owner authorises Task 04 (GOV-6)                                                                                               | Owner note                                      | [x] M0 note §4 (M0 → M1 only)                             |

Per-milestone prerequisites (decisions that must exist before **that** milestone starts) are in
`PHASE_03_MILESTONE_PLAN.md` §2 and each milestone's "Prerequisites" row.

---

## 4. Milestone acceptance (S4)

Full criteria are in `PHASE_03_MILESTONE_PLAN.md` (rows "Acceptance criteria" and "Exit
conditions"). Summary for ticking:

| Milestone | Exit evidence                                                                                                                                      | Done |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| M0        | Protection API output; ADR Accepted + indexed; D1, D2, D4 records                                                                                  | [ ]  |
| M1        | Merged PR; T-UNIT-01…09 green in CI; policy/tokeniser versions recorded; OD-11 honoured                                                            | [ ]  |
| M2a       | Merged PR; T-RLS-00…08, T-CON-01…03, T-DR-03, T-MNT-05 green (owner-role tests as non-superuser); drift clean; OD-12 honoured; NEW-1 not regressed | [ ]  |
| M2b       | Merged PR; T-RLS-04, T-MNT-01…04 green as non-superuser owner                                                                                      | [ ]  |
| M3        | Merged PR(s); T-API-01…10, T-RACE-10/16/17, T-DR-01/02/04 green; OpenAPI regenerated; env vars documented                                          | [ ]  |
| M4a       | Merged PR(s); T-CTR-01…05, T-STR-01, T-INJ-01/02 green in TS and Python                                                                            | [ ]  |
| M4b       | Merged PR(s); T-TXN-01, T-RET-01…08, T-RACE-11/12, T-STR-02/03 green; T-RET-EVAL report on the sealed split (or "FTS not yet sufficient")          | [ ]  |
| M5a       | Merged PR(s); usage tests unchanged and green; T-CTR-06…08, T-TXN-01 re-run, T-LOG-02 green; no dependency cycle                                   | [ ]  |
| M5b       | Merged PR(s); T-RACE-01…09/13/14/15/18/19, T-WF-01…08, T-EXT-01…07 (mock), T-LOG-01 green                                                          | [ ]  |
| M6        | Merged PR(s); T-MOB-01…05 green; release still blocked on legal                                                                                    | [ ]  |
| M7        | Evidence package and `docs/PHASE_03_REPORT.md` merged; dashboards/alerts delivered; Gate 03 status recorded                                        | [ ]  |

---

## 5. Gate 03 (S5)

Gate 03 (`karen_phases.md` PHASE 03) passes only when **every** row holds. Rows marked
"outside plan" cannot be met within M0–M7, so the expected status at M7 is **NOT PASSED**
(OD-04).

| #    | Criterion                                                                                                                                                                           | Evidence                              | Within M0–M7?         | Done |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | --------------------- | ---- |
| G-1  | Gate 02 recorded GO (D1; APP-6)                                                                                                                                                     | Phase 02 gate record                  | **No** (outside plan) | [ ]  |
| G-2  | Zero cross-user recall on the adversarial isolation suite                                                                                                                           | T-RET-02, T-RLS-02/07                 | Yes                   | [ ]  |
| G-3  | Deleted/suspended/expired items retrieved = 0                                                                                                                                       | T-RET-03                              | Yes                   | [ ]  |
| G-4  | Edit/delete reflected in the next response (definition OD-04) = 100 %                                                                                                               | T-RET-04                              | Yes                   | [ ]  |
| G-5  | No restricted memory written without valid permission: SECRET/SENSITIVE/minor stored = 0; false tier-1 = 0; assistant-sourced = 0; third-party unconfirmed = 0; consent races clean | T-EXT-01…06, T-CON-*, T-RACE-01/03/18 | Yes (mock)            | [ ]  |
| G-6  | Retrieval thresholds (Q9) met on the sealed test split with per-slice minimums and Wilson intervals                                                                                 | T-RET-EVAL report                     | Yes (if Q9 approved)  | [ ]  |
| G-7  | Live extraction approved (APP-1), run within an approved spend cap                                                                                                                  | Owner approval + run record           | **No** (outside plan) | [ ]  |
| G-8  | **Human-reviewed** live extraction set passes the approved precision/recall                                                                                                         | Review record + report                | **No** (outside plan) | [ ]  |
| G-9  | Legal review complete for D5, D6, D9, D12 incl. any duration shown in copy (LEG-1…LEG-4)                                                                                            | Legal sign-off                        | **No** (outside plan) | [ ]  |
| G-10 | Q1, Q5, Q11 resolved for any live or user-facing enablement                                                                                                                         | Register                              | Partly                | [ ]  |

---

## 6. Production-readiness review (S6)

Production approval is a separate written decision after Gate 03. Minimum criteria:

| #   | Criterion                                                                                                                                            | Evidence                            | Done |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ---- |
| P-1 | Gate 03 passed (§5)                                                                                                                                  | §5 all ticked                       | [ ]  |
| P-2 | NEW-1 fixed and verified (checklist Part B, T-NEW1-03/04, T-AWS-02)                                                                                  | PR + RDS evidence                   | [ ]  |
| P-3 | RDS verification: T-AWS-01, T-AWS-03, T-AWS-05, T-PERF-03                                                                                            | Recorded runs                       | [ ]  |
| P-4 | Backup/restore deletion re-application approach and runbook (OD-13), drilled (T-AWS-06)                                                              | Runbook + drill record              | [ ]  |
| P-5 | Dashboards, alerts and on-call routing for `karen_memory_*` (SR-OBS-03/04); memory runbook                                                           | Monitoring config + runbook         | [ ]  |
| P-6 | Legal: notice text and version (Q5), copy incl. durations (OD-02), refusal copy, minors scope (OD-07), export/backup disclosure (OD-06, OD-13)       | Legal sign-off                      | [ ]  |
| P-7 | Security review of the memory module and internal endpoints (threat model updated in `docs/security/threat-model.md`)                                | Review record, high findings closed | [ ]  |
| P-8 | Written approval to enable `MEMORY_FEATURE_ENABLED` per environment (APP-4) and for production launch (APP-5)                                        | Owner approval                      | [ ]  |
| P-9 | Pre-existing platform gates that production depends on (Phase 00/01 closure items, `docs/PHASE_02_REPORT.md` §7 "Production launch: NO-GO") resolved | Their own checklists                | [ ]  |
