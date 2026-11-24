# KAREN — Phase 03 — M0 note: entry conditions and owner decision record

- **Date:** 2026-11-23 · **Milestone:** M0 (owner actions + documentation; no code) · **PR:** PR-M0-1
  (branch `phase-03/m0-entry-conditions`).
- **What this records:** the owner's decisions from the decision session held on 2026-11-23 in
  answer to the owner decision packet (`PHASE_03_OWNER_DECISION_PACKET.md`), the branch-protection
  evidence (GOV-1), the approved Q8 wording, the D1 written approval (GOV-2) and the D4 free
  catalog inspection (GOV-5).
- **Recorded by:** engineering (Claude Code), on the owner's instruction in the session. The owner's
  answers were given in writing in that session; this note transcribes them. Merging PR-M0-1 is the
  owner's act (Q8 clauses 4, 5 and 7).
- **Not recorded here:** any legal approval (none exists), any Gate 02 or Gate 03 status change, any
  approval beyond M1, any change to D1–D13.

## 1. GOV-1 — branch protection (DONE)

Applied 2026-11-23 with `PUT repos/arvindydv/karen/branches/main/protection` using the payload in
`PHASE_03_BRANCH_PROTECTION_RECOMMENDATION.md` §4 (owner instruction: "Yes, apply it and record
Q8"). Verification output of `GET …/branches/main/protection` **[V-gh]**:

```json
{
  "checks": [
    {
      "app_id": 15368,
      "context": "TypeScript — format, lint, typecheck, unit tests, build, contracts"
    },
    {
      "app_id": 15368,
      "context": "Integration — PostgreSQL/pgvector, Redis, Temporal, migrations"
    },
    {
      "app_id": 15368,
      "context": "Web — Playwright smoke"
    },
    {
      "app_id": 15368,
      "context": "Mobile — Expo config + JS bundle (iOS/Android)"
    },
    {
      "app_id": 15368,
      "context": "Python — ai-service (ruff, mypy, pytest)"
    },
    {
      "app_id": 15368,
      "context": "Python — voice-agent (ruff, mypy, pytest)"
    },
    {
      "app_id": 15368,
      "context": "Terraform — fmt, validate, offline tests"
    },
    {
      "app_id": 15368,
      "context": "Security — secret scan + dependency vulnerabilities"
    },
    {
      "app_id": 15368,
      "context": "Container build — api"
    },
    {
      "app_id": 15368,
      "context": "Container build — api-migrate"
    },
    {
      "app_id": 15368,
      "context": "Container build — temporal-worker"
    },
    {
      "app_id": 15368,
      "context": "Container build — provider-worker"
    },
    {
      "app_id": 15368,
      "context": "Container build — web"
    },
    {
      "app_id": 15368,
      "context": "Container build — admin"
    },
    {
      "app_id": 15368,
      "context": "Container build — ai-service"
    },
    {
      "app_id": 15368,
      "context": "Container build — voice-agent"
    }
  ],
  "conversation_resolution": true,
  "deletions": false,
  "enforce_admins": true,
  "force_push": false,
  "reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false,
    "require_last_push_approval": false,
    "required_approving_review_count": 0
  },
  "strict": true
}
```

All M0 pass criteria hold: 16 exact checks pinned to `app_id` 15368; `enforce_admins` true; force
pushes and deletions false; PR required with 0 approvals, documented by Q8 (§3).

## 2. Owner decisions recorded 2026-11-23

| ID    | Decision                                                                                                                                                   |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OD-01 | Per-user-scoped `SECURITY DEFINER` maintenance, no new database role (as proposed; Q4)                                                                     |
| OD-03 | "Stop processing immediately" definition (arch §3.2.1) acknowledged; `abortLocal` option not adopted                                                       |
| OD-04 | Gate 03 expected NOT PASSED at the end of M0–M7 acknowledged; deletion-reflection test (arch §13.3) approved as written                                    |
| OD-05 | Extraction-job rows accepted as a provisional retention category (30 d after terminal; 24 h max age; legal review LEG-4 pending)                           |
| OD-08 | All ten roadmap deviations (arch §1.4; ADR "Deviations") acknowledged                                                                                      |
| OD-09 | All additions outside D1–D13 accepted as provisional (settings / ask before saving, restore, undo, activity, `delete_memories`, caps 500/50, 100 jobs/day) |
| OD-11 | Option (a): seal both held-out test splits (retrieval + extraction) with SHA-256 **before** M1 lexicon/tokeniser work                                      |
| OD-12 | Option (b): M2a carries the current `identity.erase_user` body unchanged plus memory deletes; the NEW-1 fix follows and keeps them                         |
| ADR   | ADR-0036 accepted (the session option stated "I would then mark ADR-0036 Accepted in your name"); status line and index in PR-M0-1                         |

Unchanged by the session: Q16 stays ADOPTED-ENG (not overridden). The legal qualifications on D5,
D6, D9 and D12 stay in force unchanged (arch §15, ADR). OD-02, OD-06, OD-07, OD-10, OD-13, Q5, Q6,
Q7, Q9 (thresholds and formal dataset-rule approval), Q10, Q12, Q15, LEG-1…LEG-5 and APP-1…APP-6
remain **OPEN**. Sealing under OD-11 (a) applies the arch §13.3 dataset rules as written.

## 3. Q8 — single-maintainer exception (approved wording)

Approved as proposed with clauses 6 and 7 kept and the 24-hour period as written:

> **Phase 03 single-maintainer approval exception (D13 / Q8)**
>
> 1. **Scope.** This exception applies to pull requests into `main` of `arvindydv/karen` while the
>    repository has exactly one maintainer with write access. It replaces the second-person approval
>    that remediation item S-03 and D13 would otherwise require. It does not relax any other branch
>    protection rule.
> 2. **What stays mandatory.** Every change to `main` goes through a pull request. Every required
>    status check listed in the recorded protection configuration must pass on the PR's final
>    commit; no check may be skipped, disabled or marked optional to obtain a merge (CLAUDE.md
>    principle 8). Administrators are subject to these rules (`enforce_admins` on). Force pushes and
>    deletion of `main` stay prohibited.
> 3. **Required approvals.** The required approving review count is set to **0** because GitHub
>    does not allow a pull request's author to approve it and no second reviewer exists. This is the
>    only reason for the value 0.
> 4. **Self-review record in place of approval.** Before merging, the maintainer records a
>    self-review on the PR: the PR description's "How it was verified" section is complete; anything
>    not proven is marked **NOT VERIFIED**; and, for Phase 03 PRs, the milestone's exit conditions
>    in `docs/phase-03/PHASE_03_MILESTONE_PLAN.md` are checked off with links. A PR without this
>    record is not merged.
> 5. **AI-assisted changes.** A review, summary or approval produced by an AI assistant is not a
>    review for the purpose of this exception. The maintainer's own self-review record (item 4) is
>    required for AI-assisted PRs as for any other.
> 6. **Higher-risk PRs.** For a PR that adds or changes a database migration, `infra/database/roles.sql`,
>    a `SECURITY DEFINER` function, RLS policies, authentication/authorization code, or
>    `.github/workflows/`, the maintainer waits at least **24 hours** between opening the PR (or its
>    last commit) and merging, and re-reads the diff before merging.**
> 7. **Owner decisions are not self-approved in code review.** A PR that records an owner decision
>    (for example ADR-0036 acceptance, a register status change or D1 written approval) is merged
>    only together with, or after, the owner's written decision; the PR review does not constitute
>    the decision.**
> 8. **Emergency bypass.** Protection is never relaxed to merge faster. If a genuine emergency
>    requires bypassing protection (for example, a security fix while CI itself is broken), the
>    maintainer records the reason, the exact setting changed and the time in an issue or M-note
>    **before** changing it, restores the original configuration immediately afterwards, and attaches
>    the protection API output proving restoration.
> 9. **Expiry.** This exception ends automatically when a second person is given write access to the
>    repository. On that day the required approving review count is raised to at least 1, stale
>    approvals continue to be dismissed, and approval of the most recent push is required.
> 10. **Review.** The exception is re-confirmed by the owner at each phase gate review.
>
> Approved by: Project Owner · Date: 2026-11-23 · Recorded in: this note

## 4. GOV-2 / GOV-6 — D1 written implementation approval

Template: `PHASE_03_D1_APPROVAL_TEMPLATE.md`. Owner instruction in the session: "M0 → M1 only".

> **Phase 03 — D1 written implementation approval.** The Project Owner gives written approval under
> owner decision D1 (Option B, approved 2026-11-23) for Phase 03 implementation to start, **scope:
> Task 04, M0 → M1 only**. Each later milestone (M2a onwards) needs a further written approval.
>
> Entry conditions: GOV-1 done (§1) · Q8 recorded (§3) · ADR-0036 accepted (§2; effective on merge
> of PR-M0-1) · `MEMORY_FEATURE_ENABLED` does not exist yet — it is introduced default-off in the
> first PR that adds runtime memory code (M3 or earlier); M1 is a pure library with no runtime
> effect · D2 done in PR-M0-1 (GOV-4) · D4 inspection recorded (§5).
>
> Conditions restated from D1 (unchanged): mock gateway only; no live extraction or embedding call
> without separate written approval; Gate 03 cannot be declared passed while Gate 02 is NO-GO; the
> memory flag stays off in every deployed environment; one PR per milestone into protected `main`
> with required checks green and no skipped tests; no retention duration, purge date or grace
> period in product copy before legal approval.
>
> Not granted: live extraction or paid calls; embeddings; `pg_trgm`; AWS or infrastructure changes;
> enabling memory anywhere deployed; production launch; legal wording; any Gate pass; any change to
> D1–D13.
>
> Project Owner · 2026-11-23

## 5. GOV-5 — D4 free catalog inspection

- **Date:** 2026-11-23. **Calls:** `GET https://openrouter.ai/api/v1/models` and
  `GET https://openrouter.ai/api/v1/embeddings/models` — unauthenticated, no key, no spend **[V]**.
- **Result:** `/models` lists 477 models and **no** embedding models; `/embeddings/models` lists
  **40** embedding models (response SHA-256 `837fd523b26697ae9eb7c718d31a9ab486da46af2f94fad0e93197e6fe32a74d`).
- **Status of this list:** catalog-listed only. Nothing below is verified for quality, Hindi /
  Hinglish performance, dimensions, data policy (ZDR / `data_collection=deny`) or availability; no
  model is added to any registry. Prices are the catalog's listed prompt price, converted to USD per
  1M tokens, and are **not verified** by a paid call. Use: input to the arch §6.8 embedding decision
  in M7 and to any future paid-probe request (D4 conditions; APP-2).

| Model id (catalog)                                                                                                                                                                                                                                                                              | Listed prompt price, USD / 1M tokens | Listed context length |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | --------------------- |
| ['architecture', 'canonical_slug', 'context_length', 'created', 'default_parameters', 'description', 'endpoints', 'expiration_date', 'hugging_face_id', 'id', 'knowledge_cutoff', 'links', 'name', 'per_request_limits', 'pricing', 'supported_parameters', 'supported_voices', 'top_provider'] |
| `perplexity/pplx-embed-v2-context-0.6b`                                                                                                                                                                                                                                                         | 0.02                                 | 32000                 |
| `perplexity/pplx-embed-v2-context-9b`                                                                                                                                                                                                                                                           | 0.12                                 | 32000                 |
| `cohere/embed-5-fast`                                                                                                                                                                                                                                                                           | 0.08                                 | 128000                |
| `cohere/embed-5-pro`                                                                                                                                                                                                                                                                            | 0.12                                 | 128000                |
| `amazon/titan-embed-image-v1`                                                                                                                                                                                                                                                                   | 0.8                                  | 128                   |
| `amazon/titan-embed-text-v1`                                                                                                                                                                                                                                                                    | 0.1                                  | 8192                  |
| `amazon/titan-embed-text-v2`                                                                                                                                                                                                                                                                    | 0.02                                 | 8192                  |
| `nvidia/nemotron-3.5-embed-1b:free`                                                                                                                                                                                                                                                             | 0                                    | 32768                 |
| `nvidia/nemotron-3.5-embed-8b:free`                                                                                                                                                                                                                                                             | 0                                    | 32768                 |
| `mongodb/voyage-code-4`                                                                                                                                                                                                                                                                         | 0.12                                 | 32000                 |
| `mongodb/voyage-multimodal-3.5`                                                                                                                                                                                                                                                                 | 0.12                                 | 32000                 |
| `mongodb/voyage-4-lite`                                                                                                                                                                                                                                                                         | 0.02                                 | 32000                 |
| `mongodb/voyage-4`                                                                                                                                                                                                                                                                              | 0.06                                 | 32000                 |
| `mongodb/voyage-4-large`                                                                                                                                                                                                                                                                        | 0.12                                 | 32000                 |
| `nvidia/nemotron-3-embed-1b:free`                                                                                                                                                                                                                                                               | 0                                    | 4096                  |
| `google/gemini-embedding-2`                                                                                                                                                                                                                                                                     | 0.2                                  | 8192                  |
| `google/gemini-embedding-2-preview`                                                                                                                                                                                                                                                             | 0.2                                  | 8192                  |
| `perplexity/pplx-embed-v1-4b`                                                                                                                                                                                                                                                                   | 0.03                                 | 32000                 |
| `perplexity/pplx-embed-v1-0.6b`                                                                                                                                                                                                                                                                 | 0.004                                | 32000                 |
| `thenlper/gte-base`                                                                                                                                                                                                                                                                             | 0.005                                | 512                   |
| `thenlper/gte-large`                                                                                                                                                                                                                                                                            | 0.01                                 | 512                   |
| `intfloat/e5-large-v2`                                                                                                                                                                                                                                                                          | 0.01                                 | 512                   |
| `intfloat/e5-base-v2`                                                                                                                                                                                                                                                                           | 0.005                                | 512                   |
| `intfloat/multilingual-e5-large`                                                                                                                                                                                                                                                                | 0.01                                 | 512                   |
| `sentence-transformers/paraphrase-minilm-l6-v2`                                                                                                                                                                                                                                                 | 0.005                                | 512                   |
| `sentence-transformers/all-minilm-l12-v2`                                                                                                                                                                                                                                                       | 0.005                                | 512                   |
| `baai/bge-base-en-v1.5`                                                                                                                                                                                                                                                                         | 0.005                                | 512                   |
| `sentence-transformers/multi-qa-mpnet-base-dot-v1`                                                                                                                                                                                                                                              | 0.005                                | 512                   |
| `baai/bge-large-en-v1.5`                                                                                                                                                                                                                                                                        | 0.01                                 | 512                   |
| `baai/bge-m3`                                                                                                                                                                                                                                                                                   | 0.01                                 | 8194                  |
| `sentence-transformers/all-mpnet-base-v2`                                                                                                                                                                                                                                                       | 0.005                                | 512                   |
| `sentence-transformers/all-minilm-l6-v2`                                                                                                                                                                                                                                                        | 0.005                                | 512                   |
| `mistralai/mistral-embed-2312`                                                                                                                                                                                                                                                                  | 0.1                                  | 8192                  |
| `google/gemini-embedding-001`                                                                                                                                                                                                                                                                   | 0.15                                 | 20000                 |
| `openai/text-embedding-ada-002`                                                                                                                                                                                                                                                                 | 0.1                                  | 8192                  |
| `mistralai/codestral-embed-2505`                                                                                                                                                                                                                                                                | 0.15                                 | 8192                  |
| `openai/text-embedding-3-large`                                                                                                                                                                                                                                                                 | 0.13                                 | 8192                  |
| `openai/text-embedding-3-small`                                                                                                                                                                                                                                                                 | 0.02                                 | 8192                  |
| `qwen/qwen3-embedding-8b`                                                                                                                                                                                                                                                                       | 0.01                                 | 40960                 |
| `qwen/qwen3-embedding-4b`                                                                                                                                                                                                                                                                       | 0.02                                 | 32768                 |

## 6. Later owner approvals (same day)

| Date       | Approval                                                                                                                                      |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-11-23 | Implementation scope extended to **M2a** (owner: "yes" to "continue with M2a"); M2a built stacked on the unmerged M1 PR, merge order enforced |
| 2026-11-23 | **Q6:** the consent suspension trigger writes the content-free `memory.suspended` audit row                                                   |

| 2026-11-24 | **Written implementation authorisation for M2b → M7 and the NEW-1 fix**, development/test environments only (owner's "Phase 03 complete execution mission", §8: "This assignment authorizes engineering implementation in development/test environments, including M2b and the remaining milestones"). Explicitly **not** authorised: production deployment or migrations, enabling `MEMORY_FEATURE_ENABLED` in any deployed environment, live paid extraction, paid embeddings, new extensions, legal approval claims, marking Gate 02/03 passed. The same instruction schedules NEW-1 now (OD-10). |

Merging any PR still needs the owner's explicit authorisation (D13; no merge by engineering).
