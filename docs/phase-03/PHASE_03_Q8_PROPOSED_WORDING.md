# KAREN — Phase 03 — Q8 proposed single-maintainer exception wording (Task 03D)

- **Date:** 2026-11-23 · **Register item:** Q8 (D13) · **Status: PROPOSED — NOT APPROVED.**
- This file proposes wording only. Q8 stays **OPEN** in `PHASE_03_DECISION_REGISTER.md` until the
  owner records approved wording (register "Evidence needed": "Recorded wording (M0 note or ADR-0036
  acceptance note)").

## 1. The existing Q8 discussion (sources)

| Source                                           | What it says                                                                                                                                                       |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PHASE_03_OWNER_DECISIONS.md` §13 (D13)          | Requires explicit owner approval of "whether self-approval is acceptable for a single-maintainer repo (GitHub requires a second account for 'required approvals')" |
| `PHASE_03_OWNER_DECISIONS.md` §17, D13 condition | "Document a single-maintainer approval exception if a second reviewer is unavailable." Also: "include administrators"                                              |
| `PHASE_03_DECISION_REGISTER.md` Q8               | "GitHub cannot require a second approval from the same account; the exception must be explicit, not improvised." Blocks IMPL (M0)                                  |
| `PHASE_03_MILESTONE_PLAN.md` M0                  | "If protection cannot include admins or required reviews for a single maintainer → Q8 exception text recorded instead of silently relaxing"                        |
| `docs/security/remediation-plan.md` S-03         | Original P0 item: "PR + approval"                                                                                                                                  |

Facts checked in Task 03D: the repository has one collaborator (admin) and is user-owned **[V-gh]**.
GitHub does not count a PR author's own approval [GitHub docs]. With administrators included
(`enforce_admins: true`, D13), any required-approval count ≥ 1 would make every PR unmergeable. The
branch-protection recommendation therefore sets `required_approving_review_count: 0`; this exception
is what makes that setting a documented decision rather than a silent relaxation.

## 2. Proposed wording (exact text for the owner to approve, amend or reject)

Clauses in **[square brackets]** are options the owner may keep or strike; everything else is the
core text.

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
> 6. **[Higher-risk PRs.** For a PR that adds or changes a database migration, `infra/database/roles.sql`,
>    a `SECURITY DEFINER` function, RLS policies, authentication/authorization code, or
>    `.github/workflows/`, the maintainer waits at least **[24 hours]** between opening the PR (or its
>    last commit) and merging, and re-reads the diff before merging.**]**
> 7. **[Owner decisions are not self-approved in code review.** A PR that records an owner decision
>    (for example ADR-0036 acceptance, a register status change or D1 written approval) is merged
>    only together with, or after, the owner's written decision; the PR review does not constitute
>    the decision.**]**
> 8. **Emergency bypass.** Protection is never relaxed to merge faster. If a genuine emergency
>    requires bypassing protection (for example, a security fix while CI itself is broken), the
>    maintainer records the reason, the exact setting changed and the time in an issue or M-note
>    **before** changing it, restores the original configuration immediately afterwards, and attaches
>    the protection API output proving restoration.
> 9. **Expiry.** This exception ends automatically when a second person is given write access to the
>    repository. On that day the required approving review count is raised to at least 1, stale
>    approvals continue to be dismissed, and [approval of the most recent push is required].
> 10. **Review.** The exception is re-confirmed by the owner at each phase gate review.
>
> Approved by: ______________________ (owner) · Date: __________ · Recorded in: ______________

## 3. What approval of this wording would and would not mean

- **Would mean:** Q8 can be marked decided in the register with the approved text; the
  `required_approving_review_count: 0` setting in GOV-1 is documented.
- **Would not mean:** GOV-1 done (protection must still be applied and verified), D1 approval
  (GOV-2), ADR-0036 acceptance, or implementation authorisation.

## 4. Open choices inside the wording

| Clause | Choice                                                                                |
| ------ | ------------------------------------------------------------------------------------- |
| 6      | Keep or drop the higher-risk cooling-off; if kept, the period ([24 hours] proposed)   |
| 7      | Keep or drop                                                                          |
| 9      | Whether "approval of the most recent push" is turned on at expiry                     |
| Where  | Record in the M0 note, the ADR-0036 acceptance note, or both (register allows either) |
