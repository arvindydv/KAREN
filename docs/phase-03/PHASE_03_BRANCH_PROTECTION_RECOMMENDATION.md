# KAREN — Phase 03 — Branch protection recommendation for `main` (GOV-1, Task 03D)

- **Date:** 2026-11-23 · **Baseline:** `main` @ `e5ff562` · **Register item:** GOV-1 (D13), with Q8.
- **Status: RECOMMENDATION ONLY.** Protection was **not** enabled or changed in Task 03D. Every
  GitHub call made in this task was a read-only `GET`. The owner applies the configuration (or a
  modified one) and records the protection API output as M0 evidence.
- **Authority:** D13 (OWNER APPROVED 2026-11-23): "enabling protection for `main` before the first
  Phase 03 merge … Require CI checks, prohibit force pushes and branch deletion, and include
  administrators. Document a single-maintainer approval exception if a second reviewer is
  unavailable." This document turns that into exact settings. Where a setting goes beyond D13 it
  is marked **beyond D13 — owner choice**.

---

## 1. Current state (verified 2026-11-23, read-only)

| Check                                                | Result                                                                                    | Label  |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------ |
| `GET repos/arvindydv/karen/branches/main/protection` | `404 Branch not protected`                                                                | [V-gh] |
| `GET repos/arvindydv/karen/rulesets`                 | `[]`                                                                                      | [V-gh] |
| `GET repos/arvindydv/karen/rules/branches/main`      | `[]`                                                                                      | [V-gh] |
| Repository                                           | public; owned by a **user** account (not an organization); default branch `main`          | [V-gh] |
| Collaborators                                        | one (`arvindydv`, admin)                                                                  | [V-gh] |
| Merge methods                                        | merge commit, squash and rebase all allowed; auto-merge off; delete-branch-on-merge off   | [V-gh] |
| Secret scanning / push protection                    | enabled / enabled; Dependabot security updates **disabled**                               | [V-gh] |
| `CODEOWNERS`                                         | none                                                                                      | [V]    |
| Workflows                                            | `.github/workflows/ci.yml` (CI), `.github/workflows/deploy.yml` (manual, gated, inactive) | [V]    |

GitHub access was available for these reads. No write was attempted.

---

## 2. Required status checks (derived from `ci.yml`, confirmed against GitHub)

### 2.1 Derivation

`ci.yml` runs on `pull_request`, `push` to `main` and `merge_group`. It has eight jobs; two use a
matrix, so GitHub reports one check per matrix entry with the `name:` template rendered.
`deploy.yml` runs only on `workflow_dispatch` and is not a PR check.

The rendered names below were then compared with the check runs GitHub actually recorded for
`main` @ `e5ff562` (`GET repos/arvindydv/karen/commits/e5ff5627…/check-runs`). All 16 match
exactly, and all were reported by the GitHub Actions app (`app.slug = github-actions`,
**`app_id = 15368`**) **[V-gh]**. The same commit also carries three check runs named `Dependabot`
from the dynamic "Dependabot Updates" workflow; those are not PR checks and are **not** required.

The count (16) agrees with `docs/security/remediation-plan.md` S-03 ("16 required checks") **[V]**.

### 2.2 Exact check names (copy exactly; the separator is an em dash `—`, U+2014)

| #   | `ci.yml` job id | Exact check name                                                     |
| --- | --------------- | -------------------------------------------------------------------- |
| 1   | `typescript`    | `TypeScript — format, lint, typecheck, unit tests, build, contracts` |
| 2   | `integration`   | `Integration — PostgreSQL/pgvector, Redis, Temporal, migrations`     |
| 3   | `web-e2e`       | `Web — Playwright smoke`                                             |
| 4   | `mobile`        | `Mobile — Expo config + JS bundle (iOS/Android)`                     |
| 5   | `python`        | `Python — ai-service (ruff, mypy, pytest)`                           |
| 6   | `python`        | `Python — voice-agent (ruff, mypy, pytest)`                          |
| 7   | `terraform`     | `Terraform — fmt, validate, offline tests`                           |
| 8   | `security`      | `Security — secret scan + dependency vulnerabilities`                |
| 9   | `containers`    | `Container build — api`                                              |
| 10  | `containers`    | `Container build — api-migrate`                                      |
| 11  | `containers`    | `Container build — temporal-worker`                                  |
| 12  | `containers`    | `Container build — provider-worker`                                  |
| 13  | `containers`    | `Container build — web`                                              |
| 14  | `containers`    | `Container build — admin`                                            |
| 15  | `containers`    | `Container build — ai-service`                                       |
| 16  | `containers`    | `Container build — voice-agent`                                      |

Note on the earlier documentation: `PHASE_03_MILESTONE_PLAN.md` M0 lists the matrix jobs with
placeholders (`Python — <each matrix app>`, `Container build — <each matrix name>`); the table above
is the expanded form. The Python check name ends with ` (ruff, mypy, pytest)`, which the M0
placeholder omits.

### 2.3 Points the owner should know before requiring all 16

1. **`main` is currently red.** The CI run for `e5ff562` (run `45130001332`, push to `main`) failed
   in check #1: one mobile Jest test, `apps/mobile/src/chat-screens.test.tsx:285` ("Conversation ›
   asks for AI-processing consent instead of showing the composer": `Unable to find an element with
accessibility label: Message KAREN`) **[V-gh]**. The same check passed on PR #45's head, the
   merge commit only changed dependency versions outside `apps/mobile`, and the test passed 3 of 3
   times locally in Task 03D (`pnpm --filter @karen/mobile exec jest --ci src/chat-screens.test.tsx`)
   **[V]**. That points to a timing-sensitive (flaky) test, but the root cause is **NOT VERIFIED**.
   With the check required, a recurrence blocks merges until re-run or fixed. Task 03D did not change
   the test (code changes are out of scope).
2. **Recent failure rate.** Of the last 30 CI runs, 13 failed **[V-gh]**: mostly check #1 on
   Dependabot React 19.3.1 branches, checks #15/#16 on Dependabot Python 3.14 base-image branches,
   once check #2 on a Dependabot tooling branch, and once check #16 on `main` (push of `f7a4d02`). Required checks will hold those Dependabot PRs until they pass — which is the
   intended effect.
3. **Voice-agent checks (#6, #16).** Voice is archived (ADR-0035) but still built and tested in CI
   **[V]**. They are included because they run on every PR today. If a later PR removes voice-agent
   from the matrices, the two names must be removed from protection **in the same change window**,
   otherwise every PR waits forever for a check that never reports ("Expected — Waiting for status
   to be reported").
4. **Renaming jobs.** Any change to a job `name:` (or matrix entry) in `ci.yml` has the same
   effect. This fails safe (PRs block, nothing merges unchecked) but needs a protection update.
5. **Path filters.** `ci.yml` has no `paths:` filters **[V]**, so every check reports on every PR
   (docs-only PRs included). No check will be skipped-and-missing.

---

## 3. Recommended configuration

| Setting                                      | Recommended value                                   | Basis                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mechanism                                    | Classic branch protection on `main`                 | M0 acceptance criteria and GOV-1 evidence are written against `GET …/branches/main/protection` (fields `required_status_checks`, `enforce_admins`, `allow_force_pushes`, `allow_deletions`). Repository rulesets are **not** returned by that endpoint; using rulesets instead requires changing the evidence command to `GET …/rules/branches/main` (owner choice) |
| Require a pull request before merging        | **Yes**                                             | D13 (milestone PRs); `required_pull_request_reviews` object present                                                                                                                                                                                                                                                                                                 |
| Required approving reviews                   | **0** while there is one maintainer                 | GitHub does not let a PR author approve their own PR [GitHub docs]; with one collaborator **[V-gh]** and administrators included, any value ≥ 1 makes every PR unmergeable. The gap is covered by Q8 (see `PHASE_03_Q8_PROPOSED_WORDING.md`). Raise to **1** when a second maintainer with write access exists                                                      |
| Dismiss stale approvals on new commits       | **Yes**                                             | No effect at 0 required reviews, but correct the day the count becomes 1, and prevents an approval of an earlier commit from carrying over                                                                                                                                                                                                                          |
| Require review from code owners              | No                                                  | No `CODEOWNERS` file **[V]**                                                                                                                                                                                                                                                                                                                                        |
| Require approval of the most recent push     | **No** while there is one maintainer                | Requires someone other than the last pusher to approve; with one maintainer it blocks every PR. Revisit with the count                                                                                                                                                                                                                                              |
| Required status checks                       | The 16 names in §2.2, each pinned to `app_id 15368` | D13 "Require CI checks". Pinning to the GitHub Actions app means a commit status or a check from another app with the same name cannot satisfy the requirement                                                                                                                                                                                                      |
| Require branches to be up to date (`strict`) | **Yes** — beyond D13, owner choice                  | The Integration check runs migrations from scratch and a schema↔migrations drift check **[V]**. Two migration PRs that each pass against an older `main` can conflict once both merge. Cost: each PR must be updated after any other merge (more CI runs, more Dependabot rebases)                                                                                  |
| Include administrators (`enforce_admins`)    | **Yes**                                             | D13 "include administrators"                                                                                                                                                                                                                                                                                                                                        |
| Allow force pushes                           | **No**                                              | D13                                                                                                                                                                                                                                                                                                                                                                 |
| Allow deletions                              | **No**                                              | D13                                                                                                                                                                                                                                                                                                                                                                 |
| Require conversation resolution              | Yes — beyond D13, owner choice                      | Cheap; makes self-review notes left on a PR blocking until resolved                                                                                                                                                                                                                                                                                                 |
| Require linear history                       | No — beyond D13, owner choice                       | Repository history uses merge commits **[V]** (`git log`); requiring linear history changes the merge method for all PRs                                                                                                                                                                                                                                            |
| Require signed commits                       | No — beyond D13, owner choice                       | Not required by any document; would need signing set up for the maintainer and Dependabot handling                                                                                                                                                                                                                                                                  |
| Push restrictions (`restrictions`)           | `null`                                              | Who-can-push restrictions apply to organization-owned repositories; this repository is user-owned **[V-gh]** [GitHub docs]                                                                                                                                                                                                                                          |
| Lock branch                                  | No                                                  | Would make `main` read-only                                                                                                                                                                                                                                                                                                                                         |
| Merge queue                                  | Not configured                                      | `ci.yml` already listens to `merge_group` **[V]**, but merge-queue availability for a user-owned repository is **[NV]**; not needed for a single maintainer                                                                                                                                                                                                         |

Items related to protection but outside this recommendation (listed so they are not forgotten):
Dependabot security updates are disabled **[V-gh]** (remediation-plan S-03 mentions them); the
`production` GitHub environment for `deploy.yml` (manual approval) is a separate setting.

---

## 4. Exact request (for the owner to run — **not run in Task 03D**)

Save as `protection.json`:

```json
{
  "required_status_checks": {
    "strict": true,
    "checks": [
      {
        "context": "TypeScript — format, lint, typecheck, unit tests, build, contracts",
        "app_id": 15368
      },
      {
        "context": "Integration — PostgreSQL/pgvector, Redis, Temporal, migrations",
        "app_id": 15368
      },
      { "context": "Web — Playwright smoke", "app_id": 15368 },
      { "context": "Mobile — Expo config + JS bundle (iOS/Android)", "app_id": 15368 },
      { "context": "Python — ai-service (ruff, mypy, pytest)", "app_id": 15368 },
      { "context": "Python — voice-agent (ruff, mypy, pytest)", "app_id": 15368 },
      { "context": "Terraform — fmt, validate, offline tests", "app_id": 15368 },
      { "context": "Security — secret scan + dependency vulnerabilities", "app_id": 15368 },
      { "context": "Container build — api", "app_id": 15368 },
      { "context": "Container build — api-migrate", "app_id": 15368 },
      { "context": "Container build — temporal-worker", "app_id": 15368 },
      { "context": "Container build — provider-worker", "app_id": 15368 },
      { "context": "Container build — web", "app_id": 15368 },
      { "context": "Container build — admin", "app_id": 15368 },
      { "context": "Container build — ai-service", "app_id": 15368 },
      { "context": "Container build — voice-agent", "app_id": 15368 }
    ]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false,
    "required_approving_review_count": 0,
    "require_last_push_approval": false
  },
  "restrictions": null,
  "required_linear_history": false,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "required_conversation_resolution": true,
  "lock_branch": false,
  "allow_fork_syncing": false
}
```

Apply (owner action):

```bash
gh api --method PUT -H "Accept: application/vnd.github+json" \
  repos/arvindydv/karen/branches/main/protection --input protection.json
```

If the owner decides against `strict` or conversation resolution, change those two values; every
other value implements D13 or the single-maintainer constraint.

---

## 5. Verification (evidence for GOV-1 / M0)

Run after applying and attach the output to the M0 note:

```bash
gh api repos/arvindydv/karen/branches/main/protection \
  --jq '{checks: [.required_status_checks.checks[] | {context, app_id}],
         strict: .required_status_checks.strict,
         enforce_admins: .enforce_admins.enabled,
         reviews: .required_pull_request_reviews,
         force_push: .allow_force_pushes.enabled,
         deletions: .allow_deletions.enabled,
         conversation_resolution: .required_conversation_resolution.enabled}'
```

Pass criteria (M0 acceptance, `PHASE_03_MILESTONE_PLAN.md`):

1. `checks` lists exactly the 16 names in §2.2, each with `app_id: 15368`.
2. `enforce_admins: true`, `force_push: false`, `deletions: false`.
3. `reviews` is present (PR required) with `required_approving_review_count: 0` **and** the Q8
   exception wording recorded (otherwise the 0 is an unexplained relaxation).
4. Negative check (recommended, remediation-plan S-03 "a direct push is rejected"): a direct push of
   a throwaway commit to `main` is rejected. Do this only with a commit that is safe to land if the
   rejection unexpectedly does not happen.

---

## 6. What this does not do

- Does not enable protection, create rulesets, change repository settings or re-run CI.
- Does not fix the failing/flaky mobile test (§2.3 item 1).
- Does not record Q8, GOV-1 or GOV-2 as done.
- Does not approve committing the Phase 03 documents to the public repository (owner call; see the
  decision packet OD-10).
