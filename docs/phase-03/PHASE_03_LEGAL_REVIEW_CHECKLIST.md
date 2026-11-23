# KAREN — Phase 03 — Legal review checklist (Task 03D)

- **Date:** 2026-11-23 · **Register items:** LEG-1…LEG-5; related Q5, OD-02, OD-05, OD-06, OD-07,
  OD-13.
- **Status: NO LEGAL REVIEW HAS TAKEN PLACE. NOTHING HERE IS LEGALLY APPROVED.** This is a list of
  questions and inputs for counsel. Engineering positions below are the current **proposed** design
  (`PHASE_03_MEMORY_ARCHITECTURE.md` Revision 3, ADR-0036 Proposed), not legal conclusions.
- **Jurisdiction:** KAREN is India-first (CLAUDE.md). The Phase 01 closure checklist already names
  "consent purposes and legal bases under the DPDP Act 2023 and Rules" as an open legal item (L1)
  **[D]**. Which laws apply, and whether any other jurisdiction is in scope at launch, is for counsel
  to confirm; this checklist does not assume an answer.
- **What legal review gates:** release to real users (REL), Gate 03 (G-9) and production (P-6). It
  does **not** gate M1–M5 implementation on local/CI with the feature off (register: "Legal items
  gate release, not implementation"). OD-07 may create an M1 lexicon follow-up if the scope widens.

How to use: for each section, counsel answers the numbered questions and returns the listed
deliverables. The owner records outcomes in `PHASE_03_DECISION_REGISTER.md` §5 (LEG-n status) with a
link to the written advice.

---

## 1. Background counsel needs (one page)

| Topic                    | Current design (proposed)                                                                                                                                                                                                                                                     | Source               |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| What is stored           | Short statements the **user typed** about themselves (or a contact), stored verbatim with a label; no inferences, summaries or embeddings; assistant messages never a source                                                                                                  | ADR 2, 7; D7         |
| How it is created        | Explicit "remember…" request → stored with Undo after deterministic checks; other statements → suggestion the user confirms; third-party facts always confirm-only                                                                                                            | ADR 7; D7, D9        |
| What is always rejected  | Secrets/credentials/identity numbers (card, CVV/PIN/OTP, UPI PIN, Aadhaar, PAN, passport, voter ID, driving licence, bank account + IFSC, API keys); minors' data (V6); sensitive categories (V7)                                                                             | arch §7.3 V5–V7      |
| Consent purposes         | `AI_PROCESSING` (any model processing), `MEMORY_STORAGE` (store/use explicit memories), `PERSONALIZATION` (inferred tailoring — unused in Phase 03)                                                                                                                           | arch §3.1; D5        |
| Without consent          | User can always list, view, export, delete and clear memories                                                                                                                                                                                                                 | D5 condition         |
| On revocation            | Processing stops (definition pending owner, OD-03); memories suspended; deleted after a grace period unless restored; delete-now offered; re-grant never auto-restores                                                                                                        | ADR 6; D6            |
| Data location / transfer | Postgres on AWS ap-south-1 (CLAUDE.md stack); Phase 03 sends nothing to any model provider (mock only). Live extraction later would send one user message per job to a model via OpenRouter under the existing ZDR / `data_collection=deny` policy — **not approved** (APP-1) | ADR security section |

---

## 2. Checklist

### 2.1 LEG-1 — D5 and Q5: consent and notice wording

Engineering position: `MEMORY_STORAGE` covers storing and using explicit, user-visible memories.
Existing `MEMORY_STORAGE` grants predate the feature (offered in onboarding today **[V]**), so the
design treats a grant as eligible only if its notice version is on an allow-list; older grants
trigger a re-confirmation prompt. Notice text (EN/HI) is not written; drafts run only under
`ALLOW_DRAFT_NOTICES` locally **[V]**.

| #     | Question for counsel                                                                                                                                                                                                                    | Status |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Q-1.1 | Is a fresh, specific consent required for memory, or can existing `MEMORY_STORAGE` grants be relied on after an updated notice? (Design assumes re-confirmation is required.)                                                           | [ ]    |
| Q-1.2 | Is the purpose split adequate: `MEMORY_STORAGE` for explicit memories, `PERSONALIZATION` reserved for inferred tailoring?                                                                                                               | [ ]    |
| Q-1.3 | Is the `MEMORY_STORAGE` → `AI_PROCESSING` dependency (revoking AI processing also revokes memory) acceptable and correctly explained?                                                                                                   | [ ]    |
| Q-1.4 | Required content of the memory notice in English and Hindi (what is stored, how it is used, retention, rights, withdrawal, grievance contact).                                                                                          | [ ]    |
| Q-1.5 | Does the per-thread memory switch (default on for new standard threads when consent is active, D8) need its own notice or consent wording?                                                                                              | [ ]    |
| Q-1.6 | Is the proposed reading of "stop processing immediately" (no new retrieval, extraction call or write after the revoke commits; one in-flight answer may finish) acceptable? (Owner decision OD-03 is pending; legal input is optional.) | [ ]    |

Deliverables back: approved notice text EN/HI with a version id; the eligible `policy_version`
list; re-confirmation copy.

### 2.2 LEG-2 — D6 and OD-02: deletion grace period and user-facing retention wording

Engineering position: suspended memories are purged after a grace window held as a database
constant (**30 days, provisional**, D6 owner qualification). No date or duration appears in any
product copy until legal approves; interim copy says memories are deleted "after a grace period".
The delete-now option in the revoke dialog is **default unchecked** (owner/legal call).

| #     | Question for counsel                                                                                                                                                                                                          | Status |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Q-2.1 | Is a grace period after consent withdrawal permissible at all, or must data be deleted on withdrawal? If permissible, what length?                                                                                            | [ ]    |
| Q-2.2 | Is suspension (stored, not used, user can still view/export/delete) acceptable during the grace period?                                                                                                                       | [ ]    |
| Q-2.3 | Should "also delete my memories now" default to checked or unchecked?                                                                                                                                                         | [ ]    |
| Q-2.4 | Is the interim wording "deleted automatically after a grace period" (no duration) acceptable before a duration is approved, or must a duration be stated? (OD-02)                                                             | [ ]    |
| Q-2.5 | Approved copy per surface (EN/HI): re-grant card, consent notice, refusal chips, thread-deletion dialog, delete-memory dialog, export copy, help text.                                                                        | [ ]    |
| Q-2.6 | Thread deletion keeps memories by default (Q12, owner decision pending); the dialog discloses that the original statement remains visible in its thread's history until the thread is deleted. Is that disclosure sufficient? | [ ]    |

Deliverables back: grace period decision (or "delete on withdrawal"); delete-now default; approved
copy per surface.

### 2.3 LEG-3 — D9 and OD-07: sensitive categories and minors' data

Engineering position: Phase 03 rejects (never stores) the sensitive categories in V7 — health and
medical **including allergies and medication**, religion, caste, sexual orientation, political
views, biometrics, precise financial position (salary, debts, balances). No exception flow. Minors
(V6): rejects third-party facts about children (child terms or age < 18) and any message where the
user states an age < 18 or a school grade; no account-level rule for self-declared minors is
assumed. ADR-0019 already bars children's features before legal review **[D]**. The extraction-job
row records a content-free `rejected_class` (`sensitive`, `minor`, …) for the job retention period
(see LEG-4).

| #     | Question for counsel                                                                                                                                                                                                    | Status |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Q-3.1 | Is the V7 category list complete and correctly scoped for the applicable law? Anything to add (e.g. other categories the law treats specially) or remove?                                                               | [ ]    |
| Q-3.2 | Allergies and dietary restrictions with a medical basis are rejected as health data. Is that required, or may a user explicitly ask KAREN to remember an allergy? (Product impact: a common memory request is refused.) | [ ]    |
| Q-3.3 | Approved refusal copy (EN/HI) shown when a memory is not saved for a sensitive, secret or minor reason.                                                                                                                 | [ ]    |
| Q-3.4 | Scope of "minors' data": is V6 (third-party children + self-stated age/grade, whole-message) sufficient? (OD-07)                                                                                                        | [ ]    |
| Q-3.5 | If a user self-declares as under 18, must memory (or the account) be disabled, or guardian consent obtained, rather than only rejecting that message?                                                                   | [ ]    |
| Q-3.6 | Is storing a content-free rejection class (`sensitive`/`minor`) on the job row for its retention period acceptable, or must it be omitted?                                                                              | [ ]    |
| Q-3.7 | Third-party facts about adults (e.g. "my wife's birthday is …") are confirm-only and still subject to the exclusions. Is any additional notice or basis needed for data about people who are not users?                 | [ ]    |

Deliverables back: approved category list; position on allergies; refusal copy; minors scope and
any account-level requirement.

### 2.4 LEG-4 — D12 and OD-05: retention periods

Engineering position: categories approved by the owner (D12); every duration is a provisional
engineering default, not a user-facing promise.

| Category                                                    | Provisional default                                                                                    |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Confirmed facts / preferences                               | Until the user deletes them, or revocation + grace; reconfirm prompt after 365 days unused (Q15)       |
| Unconfirmed suggestions                                     | 30 days                                                                                                |
| Short-lived task context                                    | Stated validity, else 30 days                                                                          |
| Episodic events                                             | 365 days unless pinned                                                                                 |
| Prior values after correction                               | 30 days                                                                                                |
| Access events (ids only)                                    | 90 days                                                                                                |
| Suspended after revocation                                  | 30-day grace (LEG-2)                                                                                   |
| Extraction-job rows (content-free; **new category**, OD-05) | 30 days after terminal state; deleted with the source message; non-terminal rows terminated after 24 h |
| Stored data exports with memory text                        | Until export expiry (`DATA_EXPORT_TTL_HOURS`, default 168 h **[V]**) or erasure (LEG-5)                |
| Backups                                                     | RDS schedule (production 30 days **[D]**) (LEG-5)                                                      |

| #     | Question for counsel                                                                                                           | Status |
| ----- | ------------------------------------------------------------------------------------------------------------------------------ | ------ |
| Q-4.1 | Are the durations above acceptable as policy? Which, if any, must be shortened, lengthened or stated to users?                 | [ ]    |
| Q-4.2 | "Keep until the user deletes" for confirmed facts: acceptable, or is a maximum retention / periodic re-confirmation required?  | [ ]    |
| Q-4.3 | Extraction-job rows (new category): acceptable retention for content-free processing metadata? Must they appear in the notice? | [ ]    |
| Q-4.4 | Which durations may appear in user-facing copy once approved, and in what wording?                                             | [ ]    |

Deliverables back: approved duration per category (or changes); which are user-facing.

### 2.5 LEG-5 — OD-06 and OD-13: exports and backups

Engineering position: (a) deleting a memory does not scrub an already-generated, unexpired export
of the user's own data; the export expires after 168 h by default **[V]** — the same window already
exists for deleted messages; owner decision OD-06 is open between disclosing the window and
invalidating exports. (b) Backups age out on the RDS schedule; a restore from backup would bring
back deleted memories, suspended memories, revoked consent state and erased accounts, and no
procedure re-applies deletions after a restore **[V]** (OD-13, production item).

| #     | Question for counsel                                                                                                                                                                        | Status |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Q-5.1 | Is it acceptable that a user's own unexpired export may still contain a memory they later deleted, if disclosed? Or must deletion invalidate the export? (OD-06)                            | [ ]    |
| Q-5.2 | Required disclosure wording for the export window, if disclosure is chosen.                                                                                                                 | [ ]    |
| Q-5.3 | Is a backup age-out period (production 30 days) acceptable for deleted and erased data, and what must be disclosed?                                                                         | [ ]    |
| Q-5.4 | After a backup restore, within what time must deletions, erasures and consent withdrawals be re-applied? Is a documented runbook sufficient, or is an automated mechanism required? (OD-13) | [ ]    |
| Q-5.5 | Does an erasure request need to reach backups beyond age-out (e.g. a suppression list), under the applicable law?                                                                           | [ ]    |

Deliverables back: export position and wording; backup disclosure wording; restore re-application
requirement (feeds the OD-13 design).

---

## 3. Summary for scheduling

| LEG   | Related      | Blocks                           | Owner decision that depends on the answer |
| ----- | ------------ | -------------------------------- | ----------------------------------------- |
| LEG-1 | D5, Q5       | REL                              | Q5 (notice/version list)                  |
| LEG-2 | D6, OD-02    | REL, G03                         | OD-02; Q12 copy                           |
| LEG-3 | D9, OD-07    | REL, G03 (possible M1 follow-up) | OD-07                                     |
| LEG-4 | D12, OD-05   | REL, G03                         | OD-05 durations; Q15                      |
| LEG-5 | OD-06, OD-13 | REL (PROD for OD-13)             | OD-06, OD-13                              |

_No item in this checklist is answered. No legal approval exists or is implied._
