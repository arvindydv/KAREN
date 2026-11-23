# KAREN — Phase 03 (Personal Memory) — Task 02: Owner Decisions

- **Date:** 2026-11-23 · **Baseline:** `main` @ `e5ff562`
- **Type:** decision preparation only. This file and `PHASE_03_REPOSITORY_AUDIT.md` are the only
  additions under `docs/phase-03/`. No code, migrations, ADRs, roadmap documents or dependencies
  were changed. No paid calls were made, nothing was deployed, nothing was committed.
- **Status of every recommendation below: PROPOSED — NOT APPROVED.** Nothing in this document is
  an owner decision until the owner records it (§17).
- **Inputs read:** `docs/phase-03/PHASE_03_REPOSITORY_AUDIT.md`, `docs/PHASE_02_REPORT.md`,
  `docs/PHASE_02_PROPOSAL.md`, `docs/PHASE_03_MULTIMODAL_PLAN.md`, `karen_phases.md` (PHASE 03,
  status lines), `karen_architecture.md` §5, `docs/product/instinct-reference-blueprint.md` §15,
  ADR-0019, 0020, 0021, 0025, 0026, 0028, 0035, `docs/security/data-isolation.md`,
  `docs/database/{pgvector,future-entities}.md`, `packages/domain/src/privacy.ts`, the RLS
  migrations, `infra/database/roles.sql`, `infra/terraform/**/variables.tf`, and the GitHub API.

Evidence labels are the same as in the audit: **[V]** verified in code/config/API in this task,
**[D]** stated in a repo document, **[A]** assumption, **[R]** recommendation, **[NV]** not
verified.

---

## 0. Decision summary

| #   | Decision                                  | Recommended option (PROPOSED)                                                                                                                        | Blocks                    |
| --- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| D1  | Proceed while Gate 02 is NO-GO?           | Planning **GO** now; implementation **GO on written approval**, mock-only, with explicit entry conditions; Gate 03 cannot pass before Gate 02        | Task 03 (design)          |
| D2  | Conflicting `PHASE_03_MULTIMODAL_PLAN.md` | `karen_phases.md` is authoritative; rename the file to a non-phase name and fix the one ADR-0026 link (errata)                                       | Nothing (hygiene)         |
| D3  | FTS-only vs embeddings                    | Ship **FTS (+ optional pg_trgm) first**, schema ready for embeddings, flag off; add embeddings only if measured recall misses the threshold          | Data model, ADR-0036      |
| D4  | Paid embedding probe                      | **Not yet.** Free catalog read first; paid probe only after a synthetic memory eval set exists; hard cap **USD 2** on a non-prod key                 | D3 escalation path        |
| D5  | Consent for storage vs use                | **`MEMORY_STORAGE` covers store + use of user-visible memories**; `PERSONALIZATION` reserved for inferred ranking/suggestions (F03-03)               | Retrieval, extraction, UI |
| D6  | Behaviour on consent revocation           | **Stop immediately + suspend**, offer "delete now"; auto-purge suspended memories after a grace window (proposed 30 days, legal review)              | Data model, workflows     |
| D7  | Must extracted memory be confirmed?       | **Tiered**: explicit "remember…" with verified source span → stored with Undo; other stated preferences → confirm; inferences → not extracted in P03 | Extraction, UI            |
| D8  | Per-conversation `memory_enabled`         | Add flag; default **on** for `standard` threads when consent is active, **always off** for `ephemeral` (DB CHECK); one flag governs read and write   | Contract, migration, UI   |
| D9  | Sensitive data                            | **Reject** secrets/credentials/IDs always; **reject** special categories in P03 (no special flow yet); third-party facts confirm-only                | Extraction, legal         |
| D10 | Async mechanism                           | **Temporal** (data-rights pattern) + a durable job row written in `finalize`; deletion is synchronous SQL, never dependent on Temporal               | Worker, API               |
| D11 | FORCE RLS gaps                            | **Separate track**, not Phase 03 (the gaps are intentional, see §12). Memory tables get FORCE. Include the consent re-check in the runner            | Migrations                |
| D12 | Retention                                 | Per-type defaults table (§13), all **pending legal review**; user-deleted = hard delete; backups age out (prod 30 d)                                 | Data model, legal         |
| D13 | Branch strategy and protection            | `main` is **verified unprotected** — enable protection first; milestone-sized PRs from `phase-03/<milestone>` branches, feature-flagged              | First Phase 03 merge      |

---

## 1. D1 — May Phase 03 proceed while Phase 02 Gate 02 is NO-GO?

**Question.** Gate 02 is recorded NO-GO. May Phase 03 planning, design and implementation start?

**Current state and evidence.**

- `docs/PHASE_02_REPORT.md` §7: Gate 02 **NO-GO** pending live gateway, SP-3 Hindi/Hinglish
  baseline and SP-2 device run. **[D]**
- ADR-0028 (2026-11-22) records SP-1 passing live for "all 8 registry models"; the live registry
  now holds **9** entries, all `verified_at: 2026-11-22`
  (`apps/ai-service/config/model-registry.live.json`). **[V]** So the "live gateway" part of Gate 02
  is partly met; SP-3 and SP-2 remain open. **[D]** The Phase 02 report §7 was not updated after
  ADR-0028. **[V]**
- No earlier gate has passed either: Gate 00 **NOT PASSED** (`karen_phases.md:180`), Gate 01
  **NOT PASSED**, closure NO-GO (`karen_phases.md:249`). **[V]**
- Precedent: Phase 02 implementation started while Phase 01 closure was NO-GO, on written owner
  approval plus entry conditions (`instinct-reference-blueprint.md` "Governance status to
  preserve"; `PHASE_02_REPORT.md` §6 E1). **[V]**
- Blueprint §15 Stage 0: "This roadmap is for planning. It does not grant permission to start
  implementation… Gate: Written approval and all required entry conditions satisfied." **[V]**
- ADR-0035 directs next work to "explicit memory, goals, Responsibility Engine…". **[V]**

**Options.**

| Option | Description                                                                                    |
| ------ | ---------------------------------------------------------------------------------------------- |
| A      | Block Phase 03 until Gate 02 passes                                                            |
| B      | Planning and design GO; implementation GO on written approval with entry conditions, mock-only |
| C      | Full GO including live AI calls for extraction                                                 |

**Security and privacy implications.** Phase 03 is the first feature that persists model-derived
user data (audit S7). Doing it on the mock gateway carries no external data-flow risk. The open
Gate 02 items (Hindi quality, device streaming) do not weaken isolation or consent controls. Live
extraction quality (whether an ECONOMY model extracts correctly in Hindi/Hinglish) is unknown
**[NV]** and is the main reason extraction must be mock-tested and gated.

**Engineering implications.** Option A idles the team on external items (devices, a Hindi
baseline that needs live spend). Option B matches the precedent and lets the data model, consent,
deletion and isolation work, which does not depend on model quality, proceed. Memory evals reuse
the SP-3 grader infrastructure, so finishing SP-3 also helps Gate 03.

**Recommendation: Option B.**

**Why.** The open Gate 02 items are about live model quality and devices; the riskiest Phase 03
work (schema, RLS, consent, deletion, contracts) is independent of them. The repository has
consistently progressed with gates open under written approval, and that is the documented
governance mechanism.

**Requires explicit owner approval.**

1. Written approval to start Phase 03 implementation (record on the first Phase 03 PR, as E1 was
   for Phase 02).
2. Entry conditions to adopt: D13 branch protection enabled; ADR-0036 accepted before the first
   migration merges; memory feature flag default **off** in every environment.
3. Agreement that **Gate 03 cannot be declared passed while Gate 02 is NO-GO**, and that any live
   extraction/embedding run needs its own spend approval (D4).

---

## 2. D2 — Conflicting `docs/PHASE_03_MULTIMODAL_PLAN.md`

**Question.** Which document defines Phase 03, and what happens to the multimodal plan?

**Current state and evidence.**

- `karen_phases.md:316` defines PHASE 03 as **Personal memory and intelligent continuity**. **[V]**
- `docs/PHASE_03_MULTIMODAL_PLAN.md` is titled "Multimodal assistant — architecture and
  implementation plan"; its body uses internal "Phases 1–5" and never calls itself roadmap Phase
  03 — **only the filename does**. **[V]** Its header already says "voice parts superseded by
  ADR-0035 … image input and task routing remain". **[V]**
- ADR-0026 links to it (`docs/adr/0026-task-routing-and-voice.md:5`). **[V]** It is the only
  inbound reference found. **[V]**
- The task-02 brief forbids modifying roadmap documents and ADRs in this task; nothing was
  changed.

**Options.**

| Option | Description                                                                                                                           |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| A      | Leave as is                                                                                                                           |
| B      | Add a banner "Not roadmap Phase 03; see `karen_phases.md`" (no rename)                                                                |
| C      | Rename to a non-phase name (e.g. `docs/plans/MULTIMODAL_ROUTING_PLAN.md`), add the banner, fix the ADR-0026 link as a recorded errata |
| D      | Move to an archive folder                                                                                                             |

**Security and privacy implications.** None directly. Indirectly, a stale plan describing audio
endpoints and `AUDIO_RETENTION` could mislead a future contributor or agent into re-adding voice
scope (the drift ADR-0035 corrected).

**Engineering implications.** The filename collides with the new `docs/phase-03/` folder and will
confuse search and agents. Option C touches one line in an accepted ADR (a link, not a decision);
`docs/adr/` conventions should allow link errata, but that is the owner's call.

**Recommendation: Option C** (fallback: B if the owner prefers not to touch any ADR).

**Why.** The routing and image-input parts are still in force (ADR-0035 "Keeps in force"), so
archiving (D) is wrong; the problem is the name, so a banner alone (B) leaves the collision.

**Requires explicit owner approval.** Confirm `karen_phases.md` as the authoritative Phase 03
definition; authorise the rename and the ADR-0026 link errata (or choose B).

---

## 3. D3 — FTS-only retrieval or embeddings?

**Question.** Should the first Phase 03 release retrieve memories with PostgreSQL full-text
search only, or introduce embeddings and vector search?

**Current state and evidence.**

- pgvector 0.8.7 is installed; no vector columns; helper `vector.ts` is unused. **[V]**
- `pg_trgm` is **not** enabled: the only `CREATE EXTENSION` in migrations is `vector`
  (`20261119173616_foundation/migration.sql:4`). **[V]** (The audit listed this as [NV].)
- No FTS exists anywhere; conversation search is `ILIKE`
  (`conversation.service.ts:126-128`). **[V]**
- No embedding model, no embeddings gateway method, EMBEDDING tier refused by the router,
  `KAREN_FEATURE_EMBEDDING_ENABLED=false` (`core/settings.py:85,98`, `router.py:183-189`). **[V]**
- Roadmap F03-02 asks for "Postgres full-text + vector similarity and rank fusion"; architecture
  §5 asks for "FTS/BM25 and vectors → reciprocal rank fusion". **[D]** FTS-only for the first
  release is therefore a **deviation from the roadmap** that needs approval and an ADR.
- PostgreSQL ships no Hindi stemmer; the `simple` configuration tokenises without stemming.
  Behaviour on Devanagari and Hinglish text has not been tested here. **[NV]**

**Options.**

| Option | Description                                                                                                                                                    |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A      | FTS + vectors + fusion from day one                                                                                                                            |
| B      | FTS (`simple` config) + optional `pg_trgm` + structured filters (type, recency, pinned); embeddings schema and pipeline designed but flag-off; measured switch |
| C      | No search: inject a bounded "always include" set (pinned and confirmed preferences) only                                                                       |

**Security and privacy implications.**

- Embeddings send memory text to a **third-party embedding provider** through OpenRouter: a new
  data flow whose ZDR/data-collection behaviour for embeddings is **[NV]**. B and C keep memory
  text inside PostgreSQL (and the chat model call, which already happens).
- Embeddings are derived personal data: they add a deletion target (S9), a re-embedding
  migration path, and a cross-model comparability risk (F03-02). B defers that surface until it
  is shown to be needed.
- Isolation is the same in all options if the `user_id` filter is in the same SQL statement as
  the search (`docs/security/data-isolation.md`).

**Engineering implications.**

- Per-user corpora will be small (tens to hundreds of items) **[A]**; at that size FTS plus
  type/recency ranking, and even "inject all pinned preferences", may meet recall needs. This is
  an assumption to be measured, not a fact.
- A adds an ai-service endpoint, a gateway method, a registry entry, a paid probe (D4), a
  Temporal embedding workflow and query-time latency (an ai-service round trip inside
  `GenerationService.load()` before the first token).
- B keeps the design honest by building the eval (recall@k, wrong-person recall) first and
  switching on embeddings only if FTS misses the threshold. `pg_trgm` needs a migration
  (`CREATE EXTENSION pg_trgm`); its availability on the target RDS version is **[NV]**.
- C is simplest but cannot scale to episodic memories and fails F03-02.

**Recommendation: Option B**, combined with C's bounded always-include set for pinned/confirmed
preferences.

**Why.** It delivers Gate 03 behaviour (edit/delete reflected in the next response, zero
cross-user recall) without a new external data flow, defers a paid dependency until evidence
exists, and keeps the roadmap's fusion design as a measured upgrade rather than an assumption.

**Requires explicit owner approval.** The roadmap deviation (FTS-first); the recall@k threshold
that would trigger embeddings (proposed: decide after the synthetic set exists, Task 03); whether
`pg_trgm` may be enabled.

---

## 4. D4 — Paid embedding-model probe

**Question.** Is a paid probe of embedding models justified now, and under what cap?

**Current state and evidence.**

- ADR-0025 §7 and ADR-0028: `verified_at` is set only by a paid probe; SP-1 cost ≈ USD 0.02. **[D]**
- `gateway/probe.py` probes chat completions only; catalog-only mode is free and keyless
  (`probe.py:17,363,432`). An embeddings probe requires new code. **[V]**
- Whether OpenRouter serves embeddings, which models, dimensions, prices, Hindi/Hinglish quality
  and ZDR support: **all [NV]**. This document does not state any model ID or price.
- E5 (`PHASE_02_REPORT.md` §6) required a non-production key with a hard credit limit. **[D]**

**Options.**

| Option | Description                                                                                          |
| ------ | ---------------------------------------------------------------------------------------------------- |
| A      | Run a paid probe now                                                                                 |
| B      | Free catalog read now (no key, no cost); paid probe only if D3 measurement shows FTS is insufficient |
| C      | Never on OpenRouter; evaluate a self-hosted embedding model (new infrastructure)                     |

**Security and privacy implications.** A probe must use **synthetic text only** (no user data,
`packages/test-fixtures` style). The probe must confirm the data policy (`data_collection=deny`,
`zdr=true`) is honoured for embedding requests, or embeddings must be rejected for real user
data. C keeps data in-house but adds a deployable (CLAUDE.md principle 4) and is not justified by
evidence.

**Engineering implications.** B costs nothing and answers "is there anything to probe?". A paid
probe without a memory eval set can verify only that the endpoint works, not that it helps
retrieval, so it would likely need repeating.

**Recommendation: Option B.** When a paid probe is needed, it runs under these limits:

- **Non-production OpenRouter key** with an OpenRouter-side **hard credit limit of USD 2** and a
  low-balance alert; plus a probe-side refusal above the cap (same pattern as SP-1).
- At most 3 candidate models, at most 500 synthetic texts (EN/HI/Hinglish) per model.
- Records per model: dimensions, reported cost, latency, data-policy acceptance, recall@k on the
  synthetic set. Results go into an ADR-0028-style record; `verified_at` is set only on pass.

**Why.** The cap is proposed as a ceiling large enough to compare a few models on a few hundred
short texts, based on SP-1 costing cents; the actual per-token embedding prices are **[NV]** and
must be read from the catalog before the run.

**Requires explicit owner approval.** The free catalog read (outbound call to OpenRouter's public
catalog); later, the paid probe itself, the cap amount, and the key/credit setup.

---

## 5. D5 — Consent for memory storage vs personalised use

**Question.** Is `MEMORY_STORAGE` enough to both store memories and use them in answers, or is
`PERSONALIZATION` also required for use?

**Current state and evidence.**

- Catalog (`packages/domain/src/privacy.ts`) **[V]**:
  - `MEMORY_STORAGE` — "Remember things about me": "save facts and preferences you share **so it
    can use them later**. You can view and delete them." Available; depends on `AI_PROCESSING`.
  - `PERSONALIZATION` — "Personalised suggestions": "Use your preferences and history with KAREN
    to tailor answers and suggestions." Available; depends on `AI_PROCESSING`.
  - Revoking a purpose revokes its dependents (ADR-0019 §3): revoking `AI_PROCESSING` revokes
    both. **[V]**
- Mobile onboarding already offers `MEMORY_STORAGE` and `PROACTIVE_SUGGESTIONS`, **not**
  `PERSONALIZATION` (`apps/mobile/app/(app)/onboarding.tsx:350`). **[V]** So `MEMORY_STORAGE`
  can be granted today even though no memory feature exists; such grants are bound to the notice
  version current at the time (`consent.service.ts:455-480`). **[V]**
- Phase 02 rule: read and delete never require consent (`PHASE_02_REPORT.md` §4). **[D]**
- Legal bases are pending review for every purpose. **[D]**

**Options.**

| Option | Description                                                                                                                                        |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| A      | `MEMORY_STORAGE` alone covers storing and using memories                                                                                           |
| B      | `MEMORY_STORAGE` to store; `PERSONALIZATION` additionally required to use them in answers                                                          |
| C      | A for explicit, user-visible memories; `PERSONALIZATION` required for inferred preferences, ranking weights and "history"-based tailoring (F03-03) |

**Security and privacy implications.**

- B produces a confusing state ("stored but never used") and a user who granted only the
  onboarding toggle would see memory silently not work. The existing `MEMORY_STORAGE` text
  already promises use.
- C maps purposes to what the user reads: "remember what I tell you" vs "tailor things from my
  history". Inference-based personalisation is the higher-risk activity and gets its own consent.
- In every option: retrieval re-checks consent at read time (S2) inside the scoped transaction;
  list/view/edit/delete/export endpoints never require consent, so a user can always see and
  remove their data.
- Existing grants predate the feature. Whether they remain valid once the memory notice text
  changes is a legal question **[NV]**. Because nothing is deployed and only test accounts exist
  **[D]**, re-prompting costs little.

**Engineering implications.** A/C need one consent check on the retrieval path; B needs two and
an onboarding change. C defers the `PERSONALIZATION` check until F03-03 features exist.

**Recommendation: Option C.**

**Why.** It honours the existing user-facing text, keeps the onboarding toggle meaningful, and
reserves the separate purpose for the riskier inferred personalisation.

**Requires explicit owner approval.** Purpose mapping (C); updated catalog descriptions and notice
text (legal review); whether pre-existing `MEMORY_STORAGE` grants must be re-confirmed when the
memory notice version ships (recommended: yes, via an in-app prompt).

---

## 6. D6 — Behaviour when memory consent is revoked

**Question.** What happens to stored memories, derived data and pending jobs when
`MEMORY_STORAGE` (or `AI_PROCESSING`, which cascades) is revoked?

**Current state and evidence.**

- ADR-0019: "Withdrawal takes effect for the next request/step; long-running workflows must
  re-check consent before each step." **[D]**
- Phase 02 behaviour on `AI_PROCESSING` revoke: history stays readable, sending is blocked (E2E
  in `PHASE_02_REPORT.md` §2). **[D]**
- No memory data exists yet. **[V]** DPDP obligations on withdrawal (cease processing, erase) are
  pending legal review **[NV]**.

**Options.**

| Option | Description                                                                                                         |
| ------ | ------------------------------------------------------------------------------------------------------------------- |
| A      | Hard-delete all memories and derived data immediately on revoke                                                     |
| B      | Stop all processing immediately; suspend memories (readable/deletable by the user only); purge after a grace window |
| C      | Suspend indefinitely until re-grant                                                                                 |

**Security and privacy implications.**

- All options must **immediately** stop extraction, retrieval and embedding, and make pending
  jobs no-op (each job re-checks consent at its step, per ADR-0019).
- A is maximally protective but irreversible on an accidental toggle.
- C retains personal data with no active purpose, which is hard to justify **[A]**.
- B limits retention to a bounded window and gives the user an explicit "delete now" choice at
  the moment of revocation.

**Engineering implications.** B needs a `suspended_at` (or status) on memory rows, a purge step
(a Temporal timer or the existing maintenance interval calling a definer function), and UI copy.
A is simpler in data but needs the same fan-out. Revocation must not depend on Temporal for
correctness: suspension is a single SQL update in the consent-revoke transaction **[R]**.

**Recommendation: Option B**, with the revoke dialog offering "Also delete my memories now", and
a proposed **30-day** grace window, after which suspended memories and derived rows are hard
deleted. Re-granting within the window restores them.

**Why.** Balances reversibility against retention minimisation; every processing path stops at
once, which is the property that matters for consent.

**Requires explicit owner approval.** B vs A; the grace window length (legal review); the default
state of the "delete now" checkbox (recommended: unchecked, with clear copy — owner/legal call).

---

## 7. D7 — Does every extracted memory require user confirmation?

**Question.** May some memories be stored without a confirm step, as F03-01 allows "per UI
choice"?

**Current state and evidence.**

- F03-01: candidate queue → Pydantic extraction → dedupe/conflict → policy/consent → "confirm or
  store as user-stated per UI choice". **[D]** Provenance strings: "saved because you told KAREN
  on [date]" or "inferred — needs confirmation". **[D]**
- Architecture §5: "Memory writes should be asynchronous proposals validated against user
  controls; avoid saving every conversation by default." **[D]**
- No model output persists user data today (audit S7). **[V]**

**Options.**

| Option | Description                                                                                                                                                                                                     |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A      | Every memory requires confirmation                                                                                                                                                                              |
| B      | Tiered: (1) explicit "remember…" requests whose source span is verified → stored with an Undo chip; (2) other user-stated preferences → suggestions to confirm; (3) inferred traits → not extracted in Phase 03 |
| C      | Store all user-stated facts automatically; confirm only inferences                                                                                                                                              |

**Security and privacy implications.**

- The model decides what is "explicit"; that decision is a **proposal**. A deterministic server
  check makes it trustworthy: the extraction must return the verbatim source span and the source
  message id; the API verifies that the message belongs to the user, is a **user-role** message in
  a memory-enabled thread, and contains the span. **Assistant messages are never a memory
  source**, which closes the path where the model writes its own claims into memory. **[R]**
- C risks false-memory persistence (a Gate 03 metric) and conflicts with "avoid saving every
  conversation by default".
- A is safest but adds friction to the core "remember this" journey.

**Engineering implications.** B needs a suggestions table and UI (already planned:
`memory.suggestions`, `/v1/memory/suggestions`), the span check, and dedupe on
`(user_id, source_message_id, normalized_value)` to absorb the known duplicate-first-message
defect (audit §13). The Undo chip needs the in-chat event; the chat stream can carry it after
`complete` or via polling **[R]**.

**Recommendation: Option B.** Plus a user setting "Ask before saving anything" (default **off**
for tier 1; tier 2 always asks).

**Why.** It makes the explicit request fast while keeping every non-explicit write behind the
user; the span check turns "the model says the user said it" into something the server can
verify.

**Requires explicit owner approval.** The three tiers; whether tier 1 auto-stores (vs A); the
setting default.

---

## 8. D8 — Per-conversation `memory_enabled`

**Question.** Should threads carry a memory flag beyond `standard | ephemeral`, and what is its
default?

**Current state and evidence.**

- `conversation.threads.mode` = `standard | ephemeral`, ephemeral with `expires_at` (24 h,
  ADR-0021 §6). **[V]**
- F02-04/F03-01 call for "explicitly memory-enabled" conversations. **[D]**
- Proposed principle: ephemeral conversations never create or retrieve durable memories.

**Options.**

| Option | Description                                                                                       |
| ------ | ------------------------------------------------------------------------------------------------- |
| A      | No flag: standard = memory (when consent active), ephemeral = none                                |
| B      | Flag; default **on** for standard threads when consent is active; user can turn it off per thread |
| C      | Flag; default **off**; user opts in per thread                                                    |
| D      | Two flags: "use memory here" and "save from here"                                                 |

**Security and privacy implications.**

- Ephemeral must be forced off **in the database** (`CHECK (mode <> 'ephemeral' OR NOT
memory_enabled)`), not only in code. **[R]**
- The flag never overrides consent: effective = flag ∧ consent active ∧ mode standard, evaluated at
  each read and at each write step.
- C is the most conservative reading of "explicitly memory-enabled" but makes the feature
  invisible in practice. With D7's tiering, B does not mean "save every conversation"; it means
  the explicit "remember…" path works by default.

**Engineering implications.** B/C/D need a migration, a contract field on thread create/update
(`If-Match`), mobile UI, and fork semantics (proposed: a fork inherits the flag). D doubles the
state space and UI for little demonstrated benefit.

**Recommendation: Option B**, a single flag governing both read and write; forks inherit;
ephemeral forced off by CHECK constraint.

**Why.** One switch is understandable; ephemeral mode already provides "no trace". A split
read/write switch (D) can be added later if users ask.

**Requires explicit owner approval.** Adding the column and contract field; default on vs off
(B vs C) — this is a product and privacy-posture call and the main tension with architecture §5
"avoid saving every conversation by default".

---

## 9. D9 — Sensitive-data exclusion and explicit-consent exceptions

**Question.** Which categories are rejected outright, which (if any) get a special explicit flow,
and how is that enforced?

**Current state and evidence.**

- F03-01: do not silently store "highly sensitive inferences, secrets, financial credentials,
  health conditions or family facts; reject or require special explicit flow". F03-03 mentions
  "allergies only with appropriate explicit consent". **[D]**
- `DATA_CLASSES` includes `SENSITIVE` and `SECRET`; `NEVER_LOG_CLASSES` = both
  (`privacy.ts:3-22`). **[V]**
- `REDACT_PATHS` already names OTP, UPI PIN, card and CVV fields for logs. **[V]**
- No consent purpose for special categories exists. **[V]**

**Options.**

| Option | Description                                                                                                                                       |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| A      | Reject all sensitive categories in Phase 03; no special flow                                                                                      |
| B      | Reject secrets always; build a special explicit flow (new purpose, separate confirm) for selected categories (e.g. dietary allergies) in Phase 03 |
| C      | Store everything the user explicitly asks to store                                                                                                |

**Proposed category list (for approval).**

| Class                        | Examples                                                                                                                                          | Proposed P03 handling                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| **SECRET** — always reject   | passwords, OTPs, PINs incl. UPI PIN, card numbers, CVV, bank account numbers, Aadhaar/PAN/passport numbers, API keys, recovery codes              | Reject even on explicit request; tell the user why; never store the attempt |
| **SENSITIVE** — reject (P03) | health and medical conditions (incl. allergies), religion, caste, sexual orientation, political views, biometric data, precise financial position | Reject in P03; candidate for a later special flow after legal review        |
| **Third-party facts**        | facts about named family members, friends, colleagues                                                                                             | Confirm-only (tier 2), never tier 1, and never SENSITIVE facts about others |
| **Children**                 | data about minors                                                                                                                                 | Reject (ADR-0019: no children's features before legal review)               |

**Security and privacy implications.**

- Enforcement must be **server-side and deterministic first**: pattern detectors in the API
  (card/Aadhaar/PAN/account-number formats, OTP-like codes) are authoritative for SECRET. The
  model's sensitivity label is advisory and may only **escalate** restriction, never lower it.
  **[R]**
- Rejected content must not be logged (ADR-0024) and must not leave a stored trace beyond a
  content-free reject counter.
- B introduces a special-category purpose whose legal basis is unreviewed **[NV]**.

**Engineering implications.** A is a classifier/denylist plus evals (false-negative tests for
each SECRET format, Hindi/Hinglish phrasings). B adds a consent purpose, notice, UI and evals —
likely its own milestone.

**Recommendation: Option A** for Phase 03, with allergies/dietary needs as the first candidate
for a later special flow.

**Why.** Gate 03 says "no restricted memories written without valid permission"; there is no
valid permission mechanism for special categories yet, so rejecting is the only compliant choice.

**Requires explicit owner approval.** The category list; reject-vs-special-flow for each
SENSITIVE category; the user-facing refusal copy; legal review of the list.

---

## 10. D10 — Temporal for extraction, embedding and deletion

**Question.** Which mechanism runs asynchronous memory work?

**Current state and evidence.**

- Temporal runs `dataExportWorkflow` and `accountDeletionWorkflow`; the worker has no DB access
  and calls HMAC-signed internal API endpoints; inputs are ids only (ADR-0020; `apps/temporal-worker/src/workflows/`). **[V]**
- Outbox table has no writer or relay; no BullMQ, cron or `@nestjs/schedule`; an in-process
  interval with a Redis lock runs maintenance (`maintenance.service.ts`). **[V]**
- Nothing is deployed; Temporal runs locally via compose. **[D]**

**Options.**

| Option | Description                                                                                        |
| ------ | -------------------------------------------------------------------------------------------------- |
| A      | Fire-and-forget in-process after `finalize`                                                        |
| B      | Temporal workflows (data-rights pattern) + a durable job row written in the `finalize` transaction |
| C      | Activate the outbox relay (SQS/EventBridge) for memory events                                      |
| D      | Add BullMQ                                                                                         |

**Security and privacy implications.**

- B keeps Temporal history free of personal data (ids only) and keeps the worker DB-less; every
  step re-checks consent and the thread flag in the API.
- Deletion correctness must **not** depend on Temporal: deleting a memory deletes its derived rows
  (embeddings, access-event references) by FK cascade in the same transaction, so the next
  response cannot see it. Temporal only cancels/no-ops pending extraction for that user or thread.
  **[R]**
- A loses work on crash and has no retry or audit trail. C and D add infrastructure (C needs an
  ADR; D adds a dependency and a second scheduler).

**Engineering implications.** B: `finalize` writes a `memory.extraction_jobs` row (unique on
`source_message_id`) in its existing transaction, then starts `memoryExtractionWorkflow` with a
deterministic id (`memory-extract:<message_id>`, `REJECT_DUPLICATE`). If the start fails, the
maintenance interval re-kicks pending rows — a minimal outbox without a relay. Extraction LLM
calls count against usage limits (owner decision: per-user budget or service budget). Embedding
workflows exist only if D3 escalates.

**Recommendation: Option B.**

**Why.** It reuses a tested, already-reviewed pattern, adds no infrastructure or dependency, and
the job row makes the start durable without activating the outbox.

**Requires explicit owner approval.** Temporal as the mechanism; whether extraction spend counts
against the user's daily/monthly limit (recommended: yes, so one user cannot exhaust the service
budget).

---

## 11. D11 — FORCE RLS gaps: in Phase 03 or separately?

**Question.** Should Phase 03 backfill `FORCE ROW LEVEL SECURITY` on existing tables (audit S1)
and add the consent re-check in the generation runner (audit S2)?

**Current state and evidence — correction to the audit.**

- ENABLE without FORCE on 12 tables **[V]**: `identity.{users, user_emails, password_credentials,
external_identities, staff_role_grants, verification_challenges, devices, sessions,
refresh_credentials}` and `conversation.{threads, messages, message_events}`.
- This is **an intentional, documented design**, not an oversight **[V]**:
  - `20261121100000_conversation_phase02/migration.sql:219-223`: "threads/messages/message_events
    are NOT FORCEd: the table owner must reach them from the narrow SECURITY DEFINER maintenance
    functions (reaper, retention purge)."
  - `20261120170000_identity_sessions/migration.sql:106`: "not FORCEd because the token lookups
    below run as the owner".
  - `20261120090000_user_isolation_rls/migration.sql:9-11` and
    `docs/security/data-isolation.md:44` state the same rule.
- The runtime role is not the owner and is `NOBYPASSRLS` (`roles.sql:24,30`), so RLS always
  applies on the request path. **[V]**

**Options.**

| Option | Description                                                                                         |
| ------ | --------------------------------------------------------------------------------------------------- |
| A      | Backfill FORCE in Phase 03                                                                          |
| B      | Separate, owner-approved hardening track; Phase 03 only ensures memory tables follow the FORCE rule |
| C      | No change                                                                                           |

**Security and privacy implications.** FORCE protects against code running as the owner role
(migrations, definer functions). Adding FORCE to those tables **breaks** the definer functions
unless they are redesigned (e.g. a dedicated maintenance role with explicit policies, or
per-user `karen.user_id` scoping inside the function). The residual risk today is owner-role
access, which is limited to migrations and the reviewed definer functions.

**Engineering implications.** A means reworking session lookup, reaper, purge and erase functions
and retesting auth — scope unrelated to memory, with real regression risk on authentication.
For memory: tables get ENABLE + FORCE; any cross-user maintenance (D6 purge, D12 expiry) must use
a FORCE-compatible design, decided in ADR-0036 (options: definer function owned by a dedicated
`karen_memory_maintenance` role with a policy `TO` that role; or per-user scoping in the function).

S2 is different: retrieval in `GenerationService.load()` must check `MEMORY_STORAGE` anyway, and
re-checking `AI_PROCESSING` there is a one-query change on the path Phase 03 already modifies.

**Recommendation: Option B for S1; include S2 in Phase 03.**

**Why.** S1 is a defence-in-depth change to authentication-critical code with a documented
rationale; it deserves its own review. S2 sits on the exact code path memory changes.

**Requires explicit owner approval.** Defer S1 to a separate track (and whether to record that in
`docs/security/remediation-plan.md`); include S2 in Phase 03; the memory-maintenance role design
(in ADR-0036).

---

## 12. D12 — Memory retention and expiration

**Question.** What are the default lifetimes per memory type and derived record?

**Current state and evidence.**

- Standard threads: kept until the user deletes them; ephemeral 24 h; message events 7 days — all
  "engineering defaults pending legal review" (ADR-0021 §6, `PHASE_02_REPORT.md` §5). **[D]**
- Erasure keeps receipts, legal acceptances, audit rows and backups until they expire
  (ADR-0020 §5). **[D]**
- RDS `backup_retention_period` defaults: dev 7, staging 14, **production 30 days**
  (`infra/terraform/environments/*/variables.tf:273-276`). **[V]**
- F03-01: "Differentiate short-lived task context vs durable memory". **[D]**

**Proposed defaults (all pending legal review).**

| Record                                           | Proposed lifetime                                                                                                 |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Confirmed profile facts, user-stated preferences | Until the user deletes them or revokes consent (D6); prompt to reconfirm if unused for 12 months (no auto-delete) |
| Unconfirmed suggestions                          | Expire after 30 days                                                                                              |
| Short-lived task context                         | Expires with the task, or 30 days if not tied to a task                                                           |
| Episodic events                                  | 12 months, then deleted unless pinned                                                                             |
| Embeddings / derived rows                        | Same as the parent memory (FK cascade)                                                                            |
| Corrected history (prior values)                 | Prior value kept 30 days for undo, then removed; `version` counter kept                                           |
| `memory.access_events` (ids only, no content)    | 90 days                                                                                                           |
| Suspended after consent revoke                   | Grace window from D6 (30 days)                                                                                    |
| Rejected sensitive candidates                    | Never stored (content-free counter only)                                                                          |
| Backups                                          | Age out on the RDS schedule (prod 30 days); product copy says deletion is not instant across backups              |

**Security and privacy implications.** Unbounded episodic retention increases breach impact and
erodes accuracy (stale facts). Explicit expiry for suggestions and task context implements
"one-off travel request is not a permanent home-city change".

**Engineering implications.** Needs `expires_at` per row, a FORCE-compatible purge (D11), and
retrieval that excludes expired rows in SQL (not only in the purge).

**Recommendation:** adopt the table as engineering defaults, configurable via env
(`MEMORY_*` in `docs/development/environment-variables.md`), flagged pending legal review.

**Why.** Concrete defaults unblock the data model; making them configurable avoids a migration
when legal review changes them.

**Requires explicit owner approval.** Each default; whether reconfirm-after-12-months is wanted;
legal review scheduling.

---

## 13. D13 — Branch strategy and branch-protection verification

**Question.** How should Phase 03 be branched and merged, and is `main` protected?

**Current state and evidence (verified 2026-11-23 via GitHub API).**

- `GET repos/arvindydv/karen/branches/main/protection` → **404 "Branch not protected"**. **[V]**
- `GET repos/arvindydv/karen/rulesets` → `[]`; `GET …/rules/branches/main` → `[]`. **[V]**
- Repository visibility **PUBLIC**; the authenticated user has ADMIN. **[V]** So `main` is
  unprotected and every document in `docs/` (including security findings) is public.
- Branch protection has been open since Phase 00 (P0-3, S-03 in
  `docs/security/remediation-plan.md:13`, E3 in Phase 02). **[D]**
- Phase 02 was one long-lived branch; the voice drift (~17k lines) was found only at the end
  (ADR-0035). **[D]**
- No Phase 03 branch exists. **[V]**

**Options.**

| Option | Description                                                                                         |
| ------ | --------------------------------------------------------------------------------------------------- |
| A      | One long-lived `phase-03/memory` branch, one PR at the end                                          |
| B      | Milestone branches `phase-03/<mNN-topic>` from `main`, one PR each, feature flag off until the gate |
| C      | Commit straight to `main`                                                                           |

**Security and privacy implications.** Without protection, a direct or force push can bypass CI,
review and the migration gate; in a public repo this also exposes the history to anyone. Phase 03
adds the most sensitive schema in the product; reviewed migrations ("never auto-applied") rely
on PR review actually being required.

**Engineering implications.** B keeps PRs reviewable (schema, contracts, retrieval, extraction,
mobile as separate PRs), surfaces scope drift early, and is safe because the feature is
flag-off. Required checks should be the CI jobs: TypeScript, Integration, Web — Playwright smoke,
Mobile, Python (both matrix entries), Terraform, Security, Containers (`.github/workflows/ci.yml`).

**Recommendation: Option B**, after enabling protection on `main`: PR required, at least the CI
jobs above as required checks, no force pushes, no deletions, administrators included.

**Why.** Protection is a long-standing open P0 item and the cheapest control available; small
flagged PRs are the direct lesson of ADR-0035.

**Requires explicit owner approval.** Enabling protection (an owner action in GitHub settings);
the required-check list; whether self-approval is acceptable for a single-maintainer repo
(GitHub requires a second account for "required approvals"); the branch naming scheme.

---

## 14. Contradictions and missing evidence found in this task

| #   | Finding                                                                                                                                                 | Evidence                                                               | Effect                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------- |
| C1  | Audit S1 presents missing FORCE as a gap; it is an intentional, documented design for definer functions                                                 | migration comments cited in §11; `data-isolation.md:44` **[V]**        | Changes D11 recommendation                               |
| C2  | ADR-0020 §5 says "Redis entries are keyed by HMACs"; code keys chat rate and usage counters by raw user UUID                                            | `conversation.service.ts:292`; `usage-limits.service.ts:94-95` **[V]** | ADR vs code mismatch; fix or correct ADR (separate item) |
| C3  | Branch protection was [NV] in the audit; it is now verified **absent**, and the repo is **public**                                                      | GitHub API **[V]**                                                     | D13 entry condition                                      |
| C4  | `pg_trgm` was [NV] in the audit; it is verified **not enabled**                                                                                         | migrations **[V]**                                                     | D3 needs a migration if used                             |
| C5  | ADR-0028 says SP-1 passed for 8 models; the live registry has 9 entries with `verified_at: 2026-11-22`                                                  | `model-registry.live.json` **[V]**                                     | Confirm the 9th entry's probe evidence                   |
| C6  | `PHASE_02_REPORT.md` §7 still shows the pre-SP-1 state and says the branch is "not yet merged"; it was merged (#43) and SP-1 ran (ADR-0028)             | **[V]**                                                                | Report is stale; Gate 02 status needs a fresh record     |
| C7  | `MEMORY_STORAGE` is grantable in mobile onboarding today although no memory feature exists; `PERSONALIZATION` is not offered in onboarding              | `onboarding.tsx:350`, `privacy.ts` **[V]**                             | D5 re-confirmation question                              |
| C8  | The multimodal plan never calls itself roadmap Phase 03 in its body; only the filename does, and ADR-0026 links to it                                   | **[V]**                                                                | D2 is a naming fix, not a content conflict               |
| C9  | `karen_architecture.md` §2/§6 and the blueprint still name Vercel AI Gateway; ADR-0025 overrides and asks the owner to amend §2                         | ADR-0025 header **[V]**                                                | Pre-existing; owner amendment still pending              |
| C10 | Roadmap F03-02 specifies FTS + vectors + fusion; architecture §5 says "avoid saving every conversation by default" — both bear on D3/D8 recommendations | **[D]**                                                                | D3 and D8 need explicit approval as deviations/readings  |
| C11 | Audit said "about 26" golden cases; there are 25 files                                                                                                  | `ls evals/golden-cases` **[V]**                                        | Cosmetic                                                 |

**Still not verified:** OpenRouter embedding support, models, prices and ZDR behaviour; ECONOMY-tier
structured-extraction quality in Hindi/Hinglish; PostgreSQL FTS behaviour on Devanagari/Hinglish;
`pg_trgm` and pgvector availability on the target RDS version; legal bases, retention periods and
DPDP withdrawal obligations; test counts on current `main` (not re-run).

---

## 15. Proposed principles (for adoption in ADR-0036, not yet approved)

1. AI output is a proposal, never an authorization; the server validates every memory write
   (schema, source span, sensitivity, consent, thread flag, dedupe).
2. Every memory belongs to the authenticated owner; `user_id` comes from the principal, is
   filtered in the same SQL as any search, and RLS (ENABLE + FORCE) backs it up.
3. Cross-user retrieval must be impossible and is tested adversarially (Gate 03).
4. Ephemeral conversations never create or retrieve memories (DB constraint).
5. Retrieval is consent-checked at read time; writes re-check consent at each step.
6. Deletion propagates synchronously to derived rows and asynchronously cancels pending jobs; it
   never depends on Temporal for correctness.
7. Sensitive data is never silently inferred or stored; deterministic server checks are
   authoritative, the model may only escalate restriction.
8. Memory reaches the model only through a dedicated contract field, delimited and labelled as
   data, never as a caller-supplied system message.
9. Reuse existing patterns (data-rights workflows, `withUserScope`, consent guard, audit); no new
   dependency or infrastructure without measured evidence.

---

## 16. Recommended next task (after owner review)

**Task 03 — Phase 03 architecture design and ADR-0036 draft**, scoped by the approved decisions:
data model (tables, columns, constraints, RLS/FORCE, maintenance role), retrieval design and
context budget, AI contract v5 shape, extraction proposal/validation pipeline, workflow and job
design, deletion/export/erasure changes, consent and thread-flag semantics, eval plan with a
synthetic EN/HI/Hinglish memory set and thresholds, milestone/PR plan. Still documentation-only.

Owner actions that can run in parallel: enable branch protection (D13); schedule legal review of
D5, D6, D9 and D12; decide the multimodal plan rename (D2).

---

## 17. Owner decision record

**Status: OWNER APPROVED** for D1–D13 · Owner: Project Owner · Decision date: 2026-11-23.
The approved option and the owner's conditions for each decision are recorded below. Where a
condition differs from or narrows the recommendation in §1–§13, the condition below prevails.

| #   | Decision                       | Approved option                                   | Owner conditions                                                                                                                                                                                                                                                                                                                                                           | Status         | Owner         | Date       |
| --- | ------------------------------ | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ------------- | ---------- |
| D1  | Proceed while Gate 02 is NO-GO | Option B                                          | Phase 03 planning and design may proceed. Implementation approval is conditional on the documented entry conditions. Mock gateway only. Gate 03 cannot pass while Gate 02 is NO-GO. No live extraction or embedding calls without separate approval.                                                                                                                       | OWNER APPROVED | Project Owner | 2026-11-23 |
| D2  | Multimodal plan handling       | Option C                                          | Rename the multimodal plan to a non-Phase-03 filename, add a clarification banner, and update the ADR-0026 link as a documentation erratum. Preserve valid routing and image-input content.                                                                                                                                                                                | OWNER APPROVED | Project Owner | 2026-11-23 |
| D3  | FTS-only vs embeddings         | Option B                                          | FTS-first, with optional `pg_trgm` subject to compatibility and evaluation. Embeddings remain disabled unless measured retrieval quality justifies them. Test Devanagari and Hinglish before accepting FTS as sufficient.                                                                                                                                                  | OWNER APPROVED | Project Owner | 2026-11-23 |
| D4  | Paid embedding probe and cap   | Option B                                          | Approve a free catalog inspection. No paid probe now. A future paid probe requires a synthetic evaluation set, non-production key, verified provider data policy, and separate approval. Proposed ceiling: USD 2. Synthetic text only.                                                                                                                                     | OWNER APPROVED | Project Owner | 2026-11-23 |
| D5  | Consent mapping                | Option C                                          | `MEMORY_STORAGE` covers explicit, user-visible memories. `PERSONALIZATION` is required for inferred tailoring. Reconfirm existing grants when the updated memory notice ships, subject to legal review. Viewing, exporting and deleting memories must remain available without memory consent.                                                                             | OWNER APPROVED | Project Owner | 2026-11-23 |
| D6  | Revocation behaviour           | Option B                                          | Stop processing immediately and suspend memories on revocation. Offer immediate deletion. The proposed 30-day grace period is provisional and subject to legal review. Re-grant behaviour must be explicitly defined: re-granting consent must not silently restore suspended memories without a clear, user-visible policy. The user must have a clear delete-now option. | OWNER APPROVED | Project Owner | 2026-11-23 |
| D7  | Confirmation policy            | Option B                                          | Explicit "remember…" requests may be stored with Undo only after deterministic server verification of the source span. Other user-stated preferences require confirmation. No inferred memories in Phase 03. Assistant messages are never memory sources.                                                                                                                  | OWNER APPROVED | Project Owner | 2026-11-23 |
| D8  | Per-thread `memory_enabled`    | Option B                                          | Add `memory_enabled`. Default on for standard threads only when consent is active and memory status is clear in the UI. Ephemeral threads must be disabled by a database constraint. The flag never overrides consent.                                                                                                                                                     | OWNER APPROVED | Project Owner | 2026-11-23 |
| D9  | Sensitive categories           | Option A                                          | Reject the proposed sensitive categories in Phase 03. Always reject secrets, credentials, identity numbers and minors' data. Third-party facts are confirm-only and remain subject to sensitive-data exclusions. No special-category exception flow until legal review.                                                                                                    | OWNER APPROVED | Project Owner | 2026-11-23 |
| D10 | Async mechanism                | Option B                                          | Use Temporal plus a durable job row written transactionally when the reply is finalized. Jobs re-check consent and thread state. Deletion is synchronous SQL and never depends on Temporal. Extraction work counts against usage limits.                                                                                                                                   | OWNER APPROVED | Project Owner | 2026-11-23 |
| D11 | FORCE RLS / consent re-check   | Option B                                          | Keep the documented FORCE RLS exclusions on the 12 identified existing tables as a separate hardening track. Include the generation consent re-check in Phase 03. New memory tables must use appropriate RLS and FORCE RLS. Maintenance access must preserve tenant isolation.                                                                                             | OWNER APPROVED | Project Owner | 2026-11-23 |
| D12 | Retention defaults             | Approve retention categories, not final durations | Proposed durations are provisional engineering defaults only. They are not final policy or user-facing promises until legal review.                                                                                                                                                                                                                                        | OWNER APPROVED | Project Owner | 2026-11-23 |
| D13 | Branch strategy and protection | Option B                                          | Approve enabling protection for `main` before the first Phase 03 merge, followed by milestone-sized PRs. Require CI checks, prohibit force pushes and branch deletion, and include administrators. Document a single-maintainer approval exception if a second reviewer is unavailable. Keep the feature flag off until the gate is passed.                                | OWNER APPROVED | Project Owner | 2026-11-23 |

**Important qualifications (owner).**

1. D12 retention durations are not legally approved.
2. The 30-day revocation grace period in D6 is provisional and subject to legal review.

_Approval recorded 2026-11-23 (Task 02A). Approval covers the decisions above; it does not by
itself start implementation — D1's entry conditions still apply._
