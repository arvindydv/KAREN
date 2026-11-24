# Phase 03 — decisions, legal reviews and approvals still needed (2026-11-24)

Prepared after implementing M2b → M7 and NEW-1 (PRs #54–#61, stacked, **none merged**). Each item
below is **OPEN** unless marked otherwise; nothing here is an owner decision until the owner records
it in `PHASE_03_DECISION_REGISTER.md`. Where the code needed a behaviour before a decision, the
behaviour is an **isolated engineering default** named in the item ("Built as"). No legal approval
exists for anything.

## A. Owner decisions

### NEW-A — Accept ADR-0037 (NEW-1 fix design) and merge order

- **Question:** Accept the exact-id, owner-only, GUC-gated lookup policy that makes data export and
  account erasure work under a non-superuser owner (PR #54)?
- **Why:** Without it, every export and erasure fails on AWS/RDS (reproduced locally: 8 failing tests).
- **Options:** (e) chosen design · (a) broad `USING (true)` owner policy · (b) split lookup table ·
  (c) drop FORCE · (d) API passes user id.
- **Security:** (e) grants the owner role exactly one row per call; runtime role unaffected (tested).
  (a)/(c) expose every export payload to definer code. **Privacy:** export payloads stay owner-only.
  **Ops:** deploy migration + `roles.sql` + API together (runbook step 9). **Cost:** none.
- **Recommendation:** accept (e); merge #54 first. **Blocks:** any AWS deployment that runs data rights.

### OD-03 amendment — mid-reply stop on `AI_PROCESSING` revocation

- **Question:** Confirm that the 2026-11-24 instruction ("stop generation if consent is revoked
  mid-reply") replaces "abort option not adopted", with a residual window ≤ `CHAT_CONSENT_RECHECK_SECONDS` (default 5 s).
- **Built as:** each runner re-checks the DB every 5 s, aborts upstream, ends `CONSENT_REQUIRED` (PR #57).
- **Security/privacy:** stricter than D6's reading; no cross-instance dependency. **Ops:** one small
  query per running reply per 5 s. **Recommendation:** confirm; keep 5 s. **Blocks:** nothing (shipped default).

### NEW-B — SENSITIVE zero-tolerance metric failed (2/296)

- **Question:** How to treat the two sealed-set misses (orientation implied by relationship context)?
- **Why:** §13.4 requires "SENSITIVE stored = 0 on this set"; Gate 03 G-5 is not met.
- **Options:** (a) new lexicon/heuristic + **new sealed v2 split** (the v1 split must not be tuned on);
  (b) rely on the escalate-only model label once live extraction is approved (not evaluated);
  (c) accept as disclosed residual risk (arch §13.4 already names it).
- **Privacy:** (c) means some implied special-category data could be stored with user confirmation
  only for tier 2, or directly for explicit tier-1 requests. **Recommendation:** (a) then (b); never (c) alone.
- **Blocks:** Gate 03 (G-5), release.

### Q1 — Live extraction model with JSON-schema output via OpenRouter

- **Why:** prerequisite for APP-1. **Status:** not investigated (needs paid/live calls or catalog
  verification; the free catalog lists `supports_json_schema` but it is unverified per model).
- **Security:** structured output reduces parsing risk; the API re-validates regardless.
  **Cost:** per-call; needs Q11. **Recommendation:** decide together with APP-1. **Blocks:** live extraction.

### Q2 — Devanagari word boundaries under the RDS locale

- **Status:** **no longer on the production path** — M4b chose F2 (app-side tokens, locale-independent)
  on evidence (`evals/reports/memory-retrieval.v1.md`). Local `en_US.utf8` keeps words whole. RDS NOT
  VERIFIED (no RDS instance; probe R-21 ready). **Recommendation:** close as "not needed", run R-21 on
  first non-production RDS for the record. **Blocks:** nothing.

### Q3 / APP-3 — `pg_trgm`

- **Status:** not needed: Hinglish recall@5 0.993 on the sealed split meets the provisional target.
  **Recommendation:** do not enable. **Blocks:** nothing.

### Q7 — Export format version

- **Built as:** additive `memory` section under `karen.data-export.v1` (readers of v1 unaffected).
- **Options:** keep v1 additive · bump to v2. **Privacy:** none either way. **Recommendation:** keep v1.
  **Blocks:** nothing (one-constant change if v2 is chosen).

### Q9 — Evaluation thresholds and dataset rules

- **Why:** M4b/M5b/M7 numbers are reported, not accepted, until approved. Provisional values:
  EN ≥ 0.90, HI ≥ 0.80, Hinglish ≥ 0.80 (both recall numbers), SENSITIVE detection ≥ 0.98, zero
  tolerances as listed. Results: retrieval slices meet all point estimates and lower bounds; SENSITIVE
  detection 0.993 point estimate (lower bound 0.976 < 0.98); SENSITIVE stored = 2 (fails).
- **Recommendation:** approve the rules as applied (held-out split, Wilson intervals, ≥ 150/slice) and
  decide whether thresholds must hold at the point estimate or the lower bound. **Blocks:** Gate 03.

### Q10 — Extraction after `failed` / `canceled` replies

- **Built as:** not enqueued (`EXTRACTION_ELIGIBLE_REPLY_STATUSES`); a later successful regenerate of
  the same message still enqueues. **Privacy:** fewer extractions. **Recommendation:** confirm.

### Q11 — `MEMORY_EXTRACTION_RESERVE_USD` for a live model

- **Built as:** 0.01 USD default (mock costs 0). Needs a priced model (Q1). **Blocks:** APP-1.

### Q12 — Memories when deleting a chat

- **Built as:** server option `delete_memories=true` (default false); mobile dialog states memories are
  kept and offers "Delete chat and its memories" as an explicit second button. Copy is draft.
- **Privacy:** default keeps user-chosen memories; risk is the user's belief — mitigated by the copy.
  **Recommendation:** keep default false with this dialog. **Blocks:** release copy (legal).

### Q15 — 12-month re-confirmation prompt

- **Built as:** not built. **Options:** keep (provisional D12 duration, legal-gated) · drop.
  **Recommendation:** drop for Phase 03; revisit with retention legal review. **Blocks:** nothing unless kept.

### Q5 — `MEMORY_STORAGE` notice text and version (EN/HI)

- **Built as:** eligibility allow-list `MEMORY_CONSENT_ELIGIBLE_POLICY_VERSIONS` (empty ⇒ nothing
  eligible; boot refuses deployed + flag on + empty). **Legal:** LEG-1. **Blocks:** any enablement.

### OD-02 — Dates/durations in product copy before legal review

- **Built as:** none shown anywhere (asserted by mobile tests). **Recommendation:** keep until LEG-2/4.

### OD-06 — Do memory deletes invalidate unexpired exports?

- **Built as:** no (bounded `DATA_EXPORT_TTL_HOURS` window, to be disclosed). **Options:** disclose ·
  also scrub `export_payload` on delete/clear (one call site). **Privacy:** scrubbing is stricter.
  **Ops:** scrubbing makes a just-downloaded export link fail. **Recommendation:** disclose now; revisit.

### OD-07 — Scope of "minors' data"

- **Built as:** V6 (third-party children, self-stated age < 18 / school grade) — 160/160 detected on
  the sealed set. No account-level rule. **Legal:** LEG-3. **Blocks:** release.

### OD-10 — NEW-1 scheduling

- **Status:** **scheduled by the 2026-11-24 instruction; implemented in PR #54** (see NEW-A).

### OD-13 — Backup restore re-application

- **Built as:** draft procedure only (`docs/runbooks/memory-operations.md` §7). **Options:** audit-log
  replay (draft) · a dedicated deletion ledger table · disclose only. **Privacy:** without it, deletions
  can reappear after a restore. **Recommendation:** dedicated append-only deletion ledger (ids only),
  drilled before production. **Blocks:** production.

## B. Legal reviews (all OPEN — no legal approval claimed)

| ID    | What needs review                                                                                 | Evidence prepared                                                                                             |
| ----- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| LEG-1 | `MEMORY_STORAGE` notice + re-confirmation of existing grants (Q5)                                 | Eligibility mechanism and env guard (M3); draft copy in `apps/mobile/src/features/memory/copy.ts`             |
| LEG-2 | 30-day grace (`memory.suspension_grace()`), delete-now default, any date/duration in copy (OD-02) | DB constant (changed only by migration); interim copy with no duration (H6); tests asserting no duration text |
| LEG-3 | Sensitive categories, refusal wording, minors' scope (OD-07)                                      | Lexicons `mp-1`; extraction evaluation report (incl. the 2 misses); refusal chip copy                         |
| LEG-4 | Every retention period incl. extraction jobs (30 d after terminal, 24 h max age) and backups      | `docs/database/memory-maintenance.md`; env defaults; maintenance tests                                        |
| LEG-5 | Export window disclosure (OD-06) and backup/restore disclosure (OD-13)                            | Export behaviour (M3), draft runbook §7                                                                       |

## C. Separate approvals (all OPEN)

| ID    | Approval                                             | State of the code                                                                                          |
| ----- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| APP-1 | Live paid extraction                                 | Impossible today: `KAREN_FEATURE_MEMORY_EXTRACTION_LIVE=true` refuses startup; no live extractor exists    |
| APP-2 | Paid embedding probe / model                         | Not built; §6.8 condition 1 holds (cross-script 0.167, paraphrase 0.200), conditions 2–3 not yet diagnosed |
| APP-3 | `pg_trgm`                                            | Not requested (not needed)                                                                                 |
| APP-4 | `MEMORY_FEATURE_ENABLED` in any deployed environment | Off everywhere; dashboards/alarms also off (`memory_alarms_enabled=false`)                                 |
| APP-5 | Production memory launch                             | Requires Gate 03                                                                                           |
| APP-6 | Gate 02 recorded GO                                  | Gate 02 is NO-GO (`docs/PHASE_02_REPORT.md` §7)                                                            |
