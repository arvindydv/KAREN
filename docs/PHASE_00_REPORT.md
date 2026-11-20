# KAREN — Phase 00 Report: Foundation Completion & External Feasibility

- **Date:** 2026-11-20 (run 3).
- **Remote:** `origin` is the private repository `arvindydv/KAREN`. `origin/main` is at `100a037`.
- **Branches:** `origin/main` is still at `100a037`. PR #1 brings in the Phase 00 hardening commits (16, plus this status update).
- **Pushed with your approval:** branch `phase-00-hardening`, opened as **PR #1** (https://github.com/arvindydv/KAREN/pull/1). Hosted CI on it is **16/16 green**. **Not merged.**
- **Roadmap:** `karen_phases.md`, section "PHASE 00 — Complete and production-validate the
  foundation". Task statuses are maintained there.
- **This is the single Phase 00 document.** At the owner's request it combines the roadmap's
  `FOUNDATION_RELEASE_GATE.md`, the execution plan, the completion report and ADR-0015 (§5).
  The earlier `docs/FOUNDATION_READINESS_REPORT.md` still stands as the foundation baseline.

> **Verdict**
>
> | Gate status                     | Value | Why                                                                                                                                                           |
> | ------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
> | `LOCAL_IMPLEMENTATION_COMPLETE` | no    | Coverage artifacts (#5) are still missing; adding them needs a dependency you have to approve. #21's remaining controls are scheduled in later phases (§8.4). |
> | `EXTERNAL_VALIDATION_PENDING`   | yes   | 19 tasks need GitHub, AWS, Vercel, legal, vendors or your sign-off. Hosted CI is now verified.                                                                |
> | `PHASE_00_GATE_PASSED`          | no    | Gate 00 needs hosted CI, deployed staging, and real IdP + gateway trials                                                                                      |
>
> **Phase 01 readiness: NOT READY.**

---

## 1. What Phase 00 is

Phase 00 turns the tested local scaffold (8 apps, contracts, Terraform, CI definitions) into a
platform that is **secure, observable, repeatably deployable and least-privilege**. It also makes
the vendor decisions every later phase depends on:

- the identity provider (ADR-0015);
- whether the live AI Gateway is feasible;
- the provider capability registry.

It builds **no product features**.

**Gate 00** (from the roadmap):

1. A clean clone reproduces the test suite.
2. GitHub CI and a deployed staging environment pass smoke checks.
3. User data access is isolated.
4. The real IdP and gateway trials are complete.
5. The on-call rollback path has been rehearsed.
6. Production stays closed to the public until Phase 01's controls pass.

## 2. How much is complete

There are 31 tasks across four workstreams:

| Workstream                           | Tasks |
| ------------------------------------ | ----- |
| F00-01 Git, branch protection and CI | 7     |
| F00-02 Environments and operations   | 10    |
| F00-03 Privacy and security          | 7     |
| F00-04 Vendor feasibility and ADRs   | 7     |

| Status                                                                         | Run 1 | Run 2 | **Run 3** |
| ------------------------------------------------------------------------------ | ----- | ----- | --------- |
| `DONE_LOCAL`: implemented, tested, with evidence                               | 7     | 9     | **10**    |
| `IN_PROGRESS`: a genuine local gap remains                                     | 9     | 4     | **0**     |
| `DEFERRED`: remaining scope is scheduled in a later phase, exposure documented | –     | –     | **1**     |
| `BLOCKED_EXTERNAL`: local prerequisites done, waiting on external action       | 13    | 18    | **20**    |
| `NOT_STARTED`                                                                  | 2     | 0     | **0**     |
| `VERIFIED_SANDBOX` / `VERIFIED_PRODUCTION`                                     | 0     | 0     | 0         |

**Where the 31 tasks stand:**

- **10 have no work left** (`DONE_LOCAL`).
- **1 has a local gap:** #5. Hosted CI is green, but coverage reports are missing.
- **1 is deferred:** #21. Its remaining controls (CSRF, attachment scanning, egress filtering)
  belong to later phases.
- **19 are waiting on external action:** GitHub, AWS, Vercel, legal, vendors or your sign-off.
- **The only local engineering work left is coverage reporting (#5).** It needs your approval to add a dependency.

None of this has been validated against real cloud services yet.

## 3. Task-by-task status

| #   | Task (short)                                           | Status           | Evidence / remaining                                                                                                                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------ | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | GitHub org/repo/remote, CODEOWNERS, MFA                | BLOCKED_EXTERNAL | **Private repo exists** (`arvindydv/KAREN`, personal account, private, verified with `gh repo view`). Still open: an organisation account (recommended), CODEOWNERS with real handles, and checks on contributor MFA and recovery admins.                                                                                                 |
| 2   | Push commits, signed tags                              | BLOCKED_EXTERNAL | Branch `phase-00-hardening` (16 commits) is pushed, and **PR #1 is open** against `main`. Merging waits for your approval. Release tags are not created yet. Gitleaks over the full history: no leaks.                                                                                                                                    |
| 3   | Protected `main`, required checks, Dependabot          | BLOCKED_EXTERNAL | **GitHub returns 403 for branch protection** on this repository: "Upgrade to GitHub Pro or make this repository public". Branch protection on a private repo needs a paid plan (GitHub Pro, or an organisation on a paid plan). That is your purchase decision. `.github/dependabot.yml` is ready; rules are in §9.2.                     |
| 4   | SHA-pinned actions, least privilege, concurrency, OIDC | **DONE_LOCAL**   | All `uses:` are pinned to commit SHAs. The deploy workflow takes inputs through `env:` and has per-target concurrency. actionlint 1.7.7: 0 findings.                                                                                                                                                                                      |
| 5   | Hosted CI, SBOM/license/JUnit/coverage artifacts       | IN_PROGRESS      | **Hosted CI on PR #1 (run 44705796262): 16/16 jobs green.** Artifacts uploaded: JUnit for TS, ai-service and voice-agent, plus the CycloneDX SBOM. **Remaining local gap: coverage reports are not produced yet.** That needs a coverage provider dependency (e.g. `@vitest/coverage-v8`, pytest-cov), which needs your go-ahead.         |
| 6   | Pinned runtimes, lockfile installs, clean clone        | **DONE_LOCAL**   | Fresh-clone check passed locally (run 2). **Also confirmed on the hosted runner (run 44705796262):** Node from `.nvmrc`, pnpm 10.28.0 via `packageManager`, `--frozen-lockfile`, uv pinned to 0.9.10, `uv sync --frozen`.                                                                                                                 |
| 7   | Differential CI                                        | BLOCKED_EXTERNAL | Was `NOT_STARTED`. The roadmap says to add it only after hosted CI is green, so it cannot be implemented locally.                                                                                                                                                                                                                         |
| 8   | Isolated AWS accounts                                  | BLOCKED_EXTERNAL | §9.3.                                                                                                                                                                                                                                                                                                                                     |
| 9   | Terraform remote state, plan review                    | BLOCKED_EXTERNAL | `pnpm infra:validate` passes (3 environments × 4 offline tests).                                                                                                                                                                                                                                                                          |
| 10  | Provision VPC/RDS/Redis/WAF/ECS                        | BLOCKED_EXTERNAL | IaC exists.                                                                                                                                                                                                                                                                                                                               |
| 11  | Least-privilege DB roles                               | **DONE_LOCAL**   | `infra/database/roles.sql` and `pnpm db:roles`. **Local dev now runs as the restricted role** (§4.1), and so do the integration tests and the built API image. Not yet applied in AWS.                                                                                                                                                    |
| 12  | Backups, PITR, restore drill                           | BLOCKED_EXTERNAL | Needs RDS.                                                                                                                                                                                                                                                                                                                                |
| 13  | Readiness/liveness, controlled degradation             | **DONE_LOCAL**   | Tested outages: Redis, PostgreSQL, and (new) the IdP JWKS endpoint, which returns 503 and retryable instead of 401. Cloud alerts: NOT VERIFIED.                                                                                                                                                                                           |
| 14  | OTel sampling, alerts, p95/p99, DLQ, pool metrics      | BLOCKED_EXTERNAL | **Local part done (run 3):** the `http.server.request.duration` histogram (route templates, explicit buckets for p95/p99) and live `db.client.connection.*` pool gauges, both exported over OTLP. Proven against the real API in `metrics.int.test.ts`. Remaining: a metrics backend, alerts and SQS DLQ alarms (AWS).                    |
| 15  | Runbooks                                               | **DONE_LOCAL**   | **Run 3:** new `deploy-and-rollback`, `model-gateway-outage`, `provider-outage` and `webhook-failure` runbooks. `database-migrations` and `incident-kill-switches` updated. Credential rotation: `security/internal-service-auth.md` plus the key and secret steps in the new runbooks. **Rollback is NOT rehearsed** (that is #17, AWS). |
| 16  | Container startup with real credentials                | BLOCKED_EXTERNAL | api, provider-worker and temporal-worker images rebuilt and smoke-tested locally (§10).                                                                                                                                                                                                                                                   |
| 17  | Failure simulations                                    | BLOCKED_EXTERNAL | **Local drills all done** (§6). The failed-deployment and rollback drill needs ECS.                                                                                                                                                                                                                                                       |
| 18  | Data classification and data-flow map                  | BLOCKED_EXTERNAL | §8 has the field classification and data-flow map. The upstream AI-processor list depends on the live gateway routing plus legal review.                                                                                                                                                                                                  |
| 19  | Retention policy, DPDP legal review                    | BLOCKED_EXTERNAL | Needs counsel.                                                                                                                                                                                                                                                                                                                            |
| 20  | RLS with negative tests                                | **DONE_LOCAL**   | `rls.int.test.ts`, 17 tests.                                                                                                                                                                                                                                                                                                              |
| 21  | Headers, CSP, CORS, CSRF, SSRF, scanning, egress       | DEFERRED         | Done: helmet/CORS, CSP/HSTS, `safeFetch` (35 tests), and https-only identity endpoints when deployed. The remaining controls are scheduled in §8.4: CSRF in P01 F01-01, attachment scanning in P08 F08-01, egress filtering in F00-02 #10. Today's exposure is documented there.                                                          |
| 22  | Threat model (9 named scenarios)                       | **DONE_LOCAL**   | §7: every scenario has its mitigation and evidence.                                                                                                                                                                                                                                                                                       |
| 23  | Audit semantics                                        | **DONE_LOCAL**   | Columns `policy_decision` and `reason_code`; DENIED events must carry both.                                                                                                                                                                                                                                                               |
| 24  | Synthetic fixtures only                                | **DONE_LOCAL**   | `@karen/test-fixtures`; the seed refuses to run outside local/test.                                                                                                                                                                                                                                                                       |
| 25  | ADR-0015 trial                                         | BLOCKED_EXTERNAL | Desk decision in §5. Trial steps in §9.4.                                                                                                                                                                                                                                                                                                 |
| 26  | Issuer/audience/JWKS, token lifecycle                  | BLOCKED_EXTERNAL | **Added this run:** the boot rules described in §4.2. The real values need the trial.                                                                                                                                                                                                                                                     |
| 27  | Vercel AI Gateway account and budgets                  | BLOCKED_EXTERNAL | §9.5.                                                                                                                                                                                                                                                                                                                                     |
| 28  | Live gateway test from Mumbai                          | BLOCKED_EXTERNAL | §9.6. **No paid calls made.**                                                                                                                                                                                                                                                                                                             |
| 29  | Provider capability registry                           | **DONE_LOCAL**   | Schema plus registry enforcement, tested.                                                                                                                                                                                                                                                                                                 |
| 30  | OAuth verification, LiveKit, partner outreach          | BLOCKED_EXTERNAL | Business processes.                                                                                                                                                                                                                                                                                                                       |
| 31  | Observability / feature-flag / email vendors           | BLOCKED_EXTERNAL | Recommendation in §8.3: no new paid tools; Amazon SES; DB-backed flags. **Awaiting your sign-off.**                                                                                                                                                                                                                                       |

## 4. What changed

### 4.0 Run 3 (this run): branch `phase-00-hardening`

**GitHub readiness (Task 1).** Read-only checks only; nothing was pushed.

| Check             | Result                                                                                                                                                                                                                |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Remote            | `origin` = `https://github.com/arvindydv/KAREN.git` (private)                                                                                                                                                         |
| Divergence        | Local `main` is 0 behind / 10 ahead of `origin/main`                                                                                                                                                                  |
| Working tree      | Clean                                                                                                                                                                                                                 |
| Secret scan       | gitleaks `--all` over every branch and commit: **no leaks**                                                                                                                                                           |
| Tracked env files | Only `*.env.example`, with placeholders or explicitly local-only values. `.env`, keys, tfstate, tfvars and `sbom/` are all ignored.                                                                                   |
| CI triggers       | `pull_request`, `push` to `main` and `merge_group`. Pushing the branch alone runs nothing; opening the PR runs CI. `deploy.yml` is manual (`workflow_dispatch`) and stays inert while `DEPLOYMENTS_ENABLED` is unset. |
| CI jobs           | **16** jobs, because this branch adds `Container build — api-migrate`                                                                                                                                                 |

**Local work (Task 2)**

- **p95/p99 latency metrics.**
  - The API records the `http.server.request.duration` histogram in seconds.
  - Labels are route templates only; unknown paths become `__unmatched__`, so IDs never reach
    labels.
  - Explicit buckets give useful p95/p99 resolution.
  - OTLP export is configured in `initTelemetry`, using `@opentelemetry/sdk-metrics` and
    `exporter-metrics-otlp-http` (same versions already in the lockfile).
  - `histogramQuantile` computes local percentiles.
- **DB pool metrics.**
  - The API now creates the `pg.Pool` itself and passes it to the Prisma adapter.
  - It exports live `db.client.connection.count{state=idle|used}`, `db.client.connection.max`
    and `db.client.connection.pending_requests`.
  - Evidence: `packages/observability` unit tests (3), and `apps/api/test/metrics.int.test.ts`
    (2), which drives the real API on PostgreSQL and Redis.
- **Runbooks.** Four new runbooks; two updated (§3 #15).
- **Security configuration.** Deployed environments must use https identity endpoints (new boot
  rule, with a test).
- **Outbound HTTP safety.**
  - `safeFetch` (run 2) is the mandated client for untrusted URLs.
  - A code search found **no** server-side fetch of untrusted URLs today. The only outbound
    clients go to configured hosts: the gateway (https required in live mode), JWKS (same-origin
    and https rules) and internal services.

**New defects found and fixed in run 3**

| #   | Finding                                                                                                                                                                                     | Fix                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1  | **Migrations could not be run as documented.** The runtime API image has no Prisma CLI (it is a devDependency), so the documented "one-off ECS task using the api image" could not migrate. | New Dockerfile target `migrate` (non-root). Built locally, and `migrate status` ran against the dev DB. Added to CI as `Container build — api-migrate`. Runbook updated. |
| R2  | **Webhook events could be lost.** The replay claim was taken before the sink hand-off. If the hand-off failed, the provider's retry was acknowledged as a "duplicate" and dropped.          | The claim is released on hand-off failure and the endpoint returns 503, so the retry is processed. Test added.                                                           |

### 4.1 Run 2

**Local database security (Step 1)**

- **Local config.** `apps/api/.env` now sets `DATABASE_URL` to `karen_api_local`, the restricted
  role, and `MIGRATION_DATABASE_URL` to the owner role.
  - Only those lines were changed, plus two empty `OIDC_*` keys added.
  - The previous file is backed up outside the repo.
  - `.env` stays git-ignored.
- **Fresh setup run against the dev database:** `db:migrate:deploy`, then `db:roles`, then
  `db:seed`. The seed connects as the owner role.
- **Checked against the running dev API and the API image:**

  | Check                                      | Result                                  |
  | ------------------------------------------ | --------------------------------------- |
  | `/health/ready`                            | DB and Redis both up                    |
  | Seeded user `/v1/me`                       | 200                                     |
  | Staff user on an admin route               | 200                                     |
  | Ordinary user on an admin route            | 403                                     |
  | New subject                                | Provisioned under RLS                   |
  | Suspended user                             | 403                                     |
  | Same user re-activated                     | 200                                     |
  | `psql` as the runtime role, unscoped query | **0** users, 0 consents (6 users exist) |
  | API logs: tokens or DB passwords           | **0** occurrences                       |

**Security review fixes (Step 5).** Each was found in code, fixed, and covered by tests:

| #   | Finding                                                                                                                                                                                                                                                                     | Severity | Fix                                                                                                                                                                                                                                                                                                                           |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | **The approval subject check was vacuous.** The workflow built the "approval" record from its _own_ input (`userId`, `taskId`, `actionType`, `providerId`). An approval signal for another user, task, action or provider passed whenever the payload hash and cap matched. | High     | The signal now carries the approval's subject fields (copied by the API from the stored approval). The workflow compares them with its input. New test covers 4 mismatch cases, each ending `CANCELLED` with 0 provider calls.                                                                                                |
| S2  | **The kill switch was ignored by workflows.** The workflow hard-coded `executionPaused: false`. `KAREN_EXECUTION_PAUSED` only affected the API, so already-approved workflows would still execute.                                                                          | High     | provider-worker refuses every side-effecting call while paused, as a non-retryable `ExecutionPausedError`, before contacting the provider. The workflow escalates with nothing dispatched. Status reconciliation keeps working. Tests at the worker and workflow level.                                                       |
| S3  | **An IdP outage looked like a bad token.** jose reports a JWKS network failure as a bare `TypeError: fetch failed`. The API classified it as `MALFORMED_TOKEN` and returned 401, which would sign every user out during an IdP blip.                                        | Medium   | The `remoteJwks` wrapper tags the failure as `JWKS_UNAVAILABLE`. The API returns 503 `DEPENDENCY_UNAVAILABLE`, retryable, and still denies access. Unit and integration tests.                                                                                                                                                |
| S4  | **IdP misconfiguration was not caught at boot.** A JWKS URL on a different origin from the issuer, or a Cognito issuer with a trailing slash (every token would fail the exact `iss` match), was accepted.                                                                  | Medium   | Boot rules reject both, with tests.                                                                                                                                                                                                                                                                                           |
| S5  | **Prisma migrations are not atomic.** Found by the migration-failure drill (§6): a failing statement left earlier statements applied. `migrate resolve --rolled-back` then reported "up to date" over a half-migrated schema.                                               | Medium   | New migrations must be wrapped in `BEGIN;`…`COMMIT;`. `scripts/check-migrations.mjs` runs in `pnpm verify` and CI, and allows a documented opt-out for `CONCURRENTLY`. The two new migrations were wrapped. Re-running the drill showed nothing persisted. The local DB checksums were updated (dev and test databases only). |

**Remaining Phase 00 work (Step 3)**

- **#5:** CI now produces JUnit, SBOM and license-gate results.
- **#6:** clean-clone reproduction passes.
- **#17:** local failure drills (§6).
- **#21:** `safeFetch`, an SSRF-safe outbound client.
- **#22:** threat scenarios (§7).
- **#18:** data-flow map (§8.2).
- **#31:** vendor recommendation (§8.3).

**Hosted CI findings**

The run on `100a037` was read-only inspected with `gh run view`.

| #   | Failing job     | Cause                                                                                                                                                                                                                                                           | Status                                                                                                                          |
| --- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| S6  | **Integration** | CI's unpinned `setup-uv` installed uv **0.13.9**. That version resolves `--project` relative to `--directory`, so `uv run --project apps/ai-service --directory apps/ai-service` failed with "Project directory does not exist". Locally (uv 0.9.10) it worked. | Fixed in `a78545a`: scripts use `--directory` only (checked with both uv 0.9.10 and 0.13.9 via `uvx`), and CI pins uv `0.9.10`. |
| —   | **Security**    | GHSA-7589-6fvf-x4pw, the `effect` advisory.                                                                                                                                                                                                                     | Already fixed by the override in `acf3481`.                                                                                     |

**Git (Step 2)**

- All changed and untracked files were inspected.
- 7 code commits plus this documentation commit, with history kept intact.
- No `.env`, keys, state or build output is tracked.
- Gitleaks over the full git history: **no leaks**.
- Working-tree hits are all in git-ignored `.next` build output.

### 4.2 Run 1 (summary)

- **RLS** on identity, consent and idempotency tables, using `PrismaService.withUserScope`, which
  sets a transaction-local `karen.user_id`. Pre-authentication lookup goes through a
  `SECURITY DEFINER` function.
- **Restricted runtime role:** `karen_api_runtime` has no DELETE, no BYPASSRLS, and INSERT-only
  access to the audit trail.
- **Cognito-compatible verifier:** `client_id` plus `token_use=access`.
- **Terraform:** an `oidc` variable that fails closed, and unused DB secrets removed.
- **Audit:** `policy_decision` and `reason_code`.
- **Provider registry:** reconciliation, contract owner, legal expiry and alternatives.
- **Web/admin headers:** CSP, HSTS and Permissions-Policy.
- **CI/supply chain:**
  - all actions SHA-pinned;
  - Dependabot with a 7-day cooldown;
  - `effect` overridden to 3.22.4 (GHSA-7589-6fvf-x4pw, high).

## 5. ADR-0015 — Identity provider selection

**Status: ACCEPTED, conditional on the hands-on trial (§9.4).**

This is a desk evaluation. Prices and capabilities are from the vendors' public pages, retrieved
2026-11-20, and need re-checking before any budget is set. If the Expo/UX part of the trial fails,
re-run this matrix with **Clerk as the fallback**.

**Context.** KAREN needs:

- Google, Apple and email OTP sign-in.
- Phone OTP for India.
- Account recovery.
- OIDC/JWT for the existing provider-neutral verifier (ADR-0004).
- Multi-device sessions with revocation.
- Passkeys and MFA.
- Mature Expo and Next.js SDKs.

Constraints:

- India data residency.
- AWS `ap-south-1`.
- Low operating burden.
- No second auth architecture.
- Account status and roles stay in KAREN's database.

**Weighted matrix.** Scores are engineering judgement and NOT VERIFIED by a prototype.

| Driver (weight)                          | Cognito Essentials | Clerk | Auth0 | Supabase Auth |
| ---------------------------------------- | ------------------ | ----- | ----- | ------------- |
| Token/session security & revocation (20) | 4                  | 4     | 5     | 3             |
| India phone OTP & abuse controls (10)    | 3                  | 3     | 4     | 3             |
| Expo/web SDK & UX (15)                   | 3                  | 5     | 4     | 4             |
| Data residency / AWS fit (15)            | 5                  | 2     | 3     | 3             |
| Cost at scale (15)                       | 4                  | 3     | 1     | 5             |
| Lock-in / portability (10)               | 3                  | 3     | 3     | 3             |
| Operational simplicity (10)              | 4                  | 5     | 4     | 2             |
| Passkeys / MFA (5)                       | 4                  | 4     | 5     | 2             |
| **Weighted score (/5)**                  | **3.80**           | 3.60  | 3.55  | 3.30          |

**Indicative monthly cost**, at list rates, excluding SMS (which every option bills separately).
Indian SMS also needs TRAI DLT sender-ID and template registration.

| Users | Cognito Essentials (10K MAU free, then $0.015/MAU) | Clerk Pro ($25 incl. 50K MRU, then $0.02 → $0.018) | Supabase Pro ($25 incl. 100K MAU, then $0.00325) | Auth0                     |
| ----- | -------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------ | ------------------------- |
| 10K   | ≈ $0                                               | ≈ $25                                              | ≈ $25                                            | free tier (≤25K MAU)      |
| 100K  | ≈ $1,350                                           | ≈ $1,025                                           | ≈ $25                                            | custom / enterprise quote |
| 1M    | ≈ $14,850                                          | ≈ $17,225                                          | ≈ $2,950                                         | custom / enterprise quote |

**Decision: Amazon Cognito user pool, Essentials tier, `ap-south-1`.** Managed login, using the
OAuth 2.0 authorization-code flow with PKCE (Expo `expo-auth-session` and the Next.js BFF).

Why:

- User data stays in the same region and account boundary as the rest of KAREN.
- No new data processor.
- Competitive cost at 100K–1M users.
- Standard JWKS-signed JWTs.
- The verifier changes are already done and tested.

**Rejected alternatives:**

- **Clerk:** best developer experience, but a non-AWS processor with no confirmed India region.
  It is the fallback.
- **Auth0:** cost moves to enterprise quotes at 100K+ users.
- **Supabase Auth:** a second Postgres platform, which would be a competing architecture.

**Security implications:**

- The API enforces:
  - `iss` (exact; Cognito format checked at boot);
  - the signature, using an asymmetric algorithm allow-list;
  - `exp`/`nbf`;
  - `client_id` and `token_use=access`;
  - a JWKS on the issuer's own origin.
- Roles and suspension come from KAREN's database on every request.
- Cognito's threat protection is in the **Plus** tier, not Essentials. Until a review before
  public launch, OTP abuse is covered by the fail-closed sensitive rate limiter, WAF rate rules
  and SMS spend caps.

**Migration and lock-in:**

- Identities are keyed by `(issuer, subject)` and mapped to KAREN UUIDs.
- Cognito does not export password hashes, so prefer passwordless sign-in.
- A second issuer can be added alongside the first.

**Sources:**

- [Cognito pricing](https://aws.amazon.com/cognito/pricing)
- [Clerk pricing](https://clerk.com/pricing)
- [Clerk pricing explained](https://clerk.com/articles/clerk-pricing-explained)
- [Auth0 pricing](https://www.auth0.com/pricing)
- [Auth0 plans](https://auth0.com/blog/whatever-you-are-building-auth0-has-a-plan.md)
- [Supabase pricing](https://www.supabase.com/pricing)
- [Supabase MAU](https://supabase.com/docs/guides/platform/manage-your-usage/monthly-active-users)

## 6. Failure drills executed locally (task #17)

| Drill                                           | How                                                            | Result                                                                                                                                                                              |
| ----------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Redis outage                                    | API integration test                                           | Sensitive routes fail closed (503). Other routes keep a per-process limit. Readiness 503.                                                                                           |
| PostgreSQL outage                               | API integration test                                           | Liveness 200, readiness 503, requests return a safe envelope (no host or driver detail).                                                                                            |
| IdP JWKS outage                                 | Unit and integration tests                                     | Denied with 503, retryable. Users are not signed out.                                                                                                                               |
| Missing `APP_ENV` or secrets                    | Config tests, image refusal                                    | Services refuse to start.                                                                                                                                                           |
| Worker restart while awaiting approval          | `local-temporal.int.test.ts` against the local Temporal server | Worker 1 is shut down at `AWAITING_APPROVAL`. The signal arrives with no worker running. Worker 2 replays and completes `COMPLETED_VERIFIED` with **exactly 1** provider execution. |
| Provider timeout or ambiguous result            | Workflow test                                                  | Reconciled via status. The side effect is never retried blindly.                                                                                                                    |
| Client disconnect mid-stream                    | ai-service test                                                | Budget reservation settled conservatively (none left in flight), invocation recorded `cancelled`, no gateway replay.                                                                |
| Migration failure                               | Scripted drill on a throwaway DB                               | Found S5. Fixed by explicit transactions; re-drill left no partial objects.                                                                                                         |
| Kill switch during an approved action           | Workflow and provider-worker tests                             | `ESCALATED`, 0 provider calls.                                                                                                                                                      |
| **Not run:** failed ECS deployment and rollback | Needs AWS                                                      | BLOCKED_EXTERNAL                                                                                                                                                                    |

## 7. Threat scenarios (task #22)

These complement `docs/security/threat-model.md`. That file should absorb this section once doc
changes there are authorised.

| Scenario                                                                    | Mitigation in place                                                                                                                                                                                                       | Evidence                                                                                 | Residual risk / next control                                                                                                                                |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Prompt injection** (e-mail, web, docs, tool output)                       | The LLM proposes only; side-effecting tools are proposal-only; policy and approval are decided in code; tool registry allow-list.                                                                                         | ai-service tool-registry tests; golden case "forward my e-mails"; workflow policy tests. | Injection can still distort answers. Content provenance labels are needed from Phase 02.                                                                    |
| **OAuth token theft** (IdP tokens, future connector tokens)                 | Short-lived access tokens validated on every call; refresh tokens never reach KAREN servers; no tokens in logs (redaction, path-only request logs).                                                                       | Logging tests; container log scan found 0 tokens.                                        | Connector refresh tokens (Phase 05) need KMS envelope encryption and per-user RLS. Design required before Phase 05.                                         |
| **Model egress** (data leaving via the gateway)                             | Gateway key backend-only; consent purpose `AI_PROCESSING`; redaction backstop; no prompt content in invocation records.                                                                                                   | ai-service tests; public-env guard.                                                      | Upstream processors and retention unknown until the live gateway (#18). Egress FQDN filtering is AWS work (#10).                                            |
| **Replay** (internal calls, webhooks, approvals)                            | One-time HMAC signatures (Redis, fails closed); webhook timestamp plus event-ID replay guard; first approval decision wins.                                                                                               | Internal-auth, provider-worker and workflow tests.                                       | `x-karen-caller` is not authenticated (shared secret). Per-service keys later.                                                                              |
| **Webhook spoofing**                                                        | Per-provider HMAC over the raw body; unknown provider returns 404; **webhooks are hints, the provider status read-back is the proof**.                                                                                    | provider-worker tests; descriptor rule requiring read-back reconciliation.               | Per-provider secret rotation runbook (#15).                                                                                                                 |
| **Impersonation** (forged tokens, wrong IdP, ID token used as access token) | Signature plus `iss`/`aud` or `client_id` plus `token_use`; JWKS on the issuer's origin; dev issuer refused outside local/test.                                                                                           | Verifier, env and auth-isolation tests.                                                  | Real Cognito trial (#25/#26).                                                                                                                               |
| **Approval race / misuse**                                                  | First decision wins; approval bound to payload hash, cap, expiry, assurance, **and now user/task/action/provider (S1)**.                                                                                                  | Workflow tests (mismatch cases → `CANCELLED`, 0 calls).                                  | Signals are trusted from the API. Phase 04 must load the approval from the DB, mark it `CONSUMED`, and restrict who can signal (Temporal namespace access). |
| **Duplicate side effects**                                                  | Stable idempotency key per task step; workflow ID uniqueness; ambiguous results reconciled before retry; replay proven not to re-execute.                                                                                 | Workflow tests and worker-restart drill.                                                 | Providers without native idempotency need client-reference reconciliation per adapter.                                                                      |
| **Rogue support access**                                                    | Staff roles only from DB grants (runtime role cannot write them); RBAC on staff routes; denials audited with policy and reason; runtime role cannot read or alter the audit trail; admin console fails closed (ADR-0014). | Auth and RLS tests.                                                                      | Staff identity (separate IdP, MFA) and per-case access grants are not built. `enable_admin` must stay false.                                                |

## 8. Data classification, data flow and vendor recommendation

### 8.1 Field classification (current tables)

| Field(s)                                                                                           | Class    | Notes                                               |
| -------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------- |
| `identity.users.id`                                                                                | PERSONAL | Pseudonymised as `user_ref` in telemetry            |
| `identity.users.display_name`, `locale`, `timezone`, `external_identities.subject`, `last_seen_at` | PERSONAL | Never logged; RLS                                   |
| `identity.users.status`, `version`, timestamps; `external_identities.issuer`                       | INTERNAL |                                                     |
| `identity.staff_role_grants.*`                                                                     | INTERNAL | Privilege-escalation target; read-own only          |
| `consent.consent_grants.*`, `consent.legal_acceptances.*`                                          | PERSONAL | Legal records; RLS (FORCE)                          |
| `audit.audit_events.actor_ref`, `subject_id`                                                       | PERSONAL | UUIDs only                                          |
| `audit.audit_events.metadata`, `reason_code`, `policy_decision`                                    | INTERNAL | Pre-redacted; free text rejected                    |
| `platform.outbox_events.payload`                                                                   | INTERNAL | No SENSITIVE data (enforce with the first consumer) |
| `platform.idempotency_records.response_body`                                                       | PERSONAL | RLS; expires                                        |
| Redis rate-limit keys (client IP)                                                                  | PERSONAL | 60 s TTL                                            |
| Gateway key, HMAC secrets, DB URLs                                                                 | SECRET   | Secrets Manager only                                |

### 8.2 Data-flow map (current, before Phase 01)

```
Client (web/mobile) --TLS--> Cloudflare/WAF --> ALB --> api (NestJS)
   | Bearer JWT (IdP)                                   |-- PostgreSQL (RLS, runtime role)   [PERSONAL]
                                                        |-- Redis (rate limits, IP, 60 s)    [PERSONAL, ephemeral]
                                                        |-- ai-service (HMAC-signed, internal)
                                                        |      |-- Redis (budget aggregates only)
                                                        |      `-- Vercel AI Gateway --> upstream model providers  [prompt content: PERSONAL/SENSITIVE]
                                                        `-- Temporal Cloud (workflow inputs: IDs, payload hashes, amounts)
temporal-worker --> provider-worker --> provider APIs (SANDBOX only today)
provider webhooks --> provider-worker (HMAC + replay guard) --> sink (hint only)
Telemetry: pino logs / OTel / Sentry -- redacted, user_ref only, no prompts/tokens
```

Open questions (BLOCKED_EXTERNAL):

- Which upstream processors the gateway routes each tier to.
- Their retention and training terms, and where they are located (hosting in AWS Mumbai does
  not mean inference happens in India).
- Whether Temporal Cloud region and payload encryption (a data converter) are needed for
  personal data.

### 8.3 Vendor recommendation (task #31, awaiting your sign-off)

- **Observability: no new vendor.**
  - Keep OpenTelemetry → CloudWatch, plus Sentry (errors) and Langfuse (LLM traces with content
    controls), as the architecture already specifies.
  - Sentry and Langfuse are added only when the dev environment exists. Use their free or
    developer tiers until load justifies more.
- **Feature flags: no vendor.**
  - Use DB-backed flags in the `platform` schema (audited, per-environment) plus the existing env
    kill switches.
  - Revisit a hosted service only if percentage rollouts or experimentation are needed (Phase 13).
- **Transactional e-mail: Amazon SES in `ap-south-1`.**
  - AWS-native, no new processor, same IAM and Terraform.
  - Needs domain verification (SPF/DKIM/DMARC) and an exit from the SES sandbox.
  - Cognito can send its OTP e-mails through SES.
- **SMS/OTP: AWS End User Messaging (used by Cognito).**
  - Needs TRAI DLT registration and spend limits.
  - Verify India delivery in the trial.

### 8.4 Deferred security controls: implementation phase and current exposure (task #21)

**CSRF protection** — implement in **Phase 01, F01-01**, together with the Next.js BFF session
cookies.

- **Exposure today: none.** The API authenticates only with `Authorization: Bearer` headers.
  Browsers never attach those automatically.
- There are no cookie sessions, CORS has `credentials: false`, and CORS uses an allow-list.
- **Phase 01 must add** `SameSite=Lax`/`Strict` + `HttpOnly` + `Secure` cookies, plus a
  double-submit or Origin-checked CSRF token on state-changing BFF routes, with tests.

**Attachment malware scanning** — implement in **Phase 08, F08-01**, with document ingestion.

- **Exposure today: none.** There is no upload endpoint. The S3 buckets exist in Terraform only
  and are not provisioned. The API holds IAM permission for presigned URLs on `user-artifacts`,
  but no code issues them.
- **Phase 08 must add** quarantine-prefix uploads → scan (managed scanning or an
  engine-in-Lambda; vendor choice is part of F08-01) → promote, with type and size limits.
- Rule until then: **no upload code may ship before this exists.**

**Egress filtering** (FQDN allow-list) — implement in **Phase 00, F00-02 #10**, when the AWS
environment is provisioned, and before real users (`docs/security/egress-policy.md`).

- **Exposure today, in the design:** security groups allow any outbound 443. A compromised
  service could exfiltrate data to an arbitrary https host. Nothing is deployed, so this is not
  live.
- **Mitigations already in code:**
  - `safeFetch` host allow-lists for untrusted URLs;
  - fixed configured hosts for the gateway and JWKS;
  - the gateway key is held only by ai-service.
- **Still to build:** AWS Network Firewall or an egress proxy with per-service allow-lists,
  plus VPC endpoints for AWS APIs.

## 9. External validation — ordered checklist and exact setup instructions (nothing below has been executed)

### 9.0 Ordered, cost-conscious checklist

The order is: free and reversible steps first, then steps that create billable resources. Each
step needs your explicit approval.

**Step 1 — GitHub CI on the hardening branch**

- **Prerequisites:** none.
- **Your action:** approve. Then I run:
  `git push -u origin phase-00-hardening`
  `gh pr create -R arvindydv/KAREN --base main --head phase-00-hardening --title "Phase 00 hardening" --body-file <summary>`
  I then watch CI with `gh pr checks --watch`, fix any failure on the branch, and **do not
  merge** until every job is green. Merge only on your instruction (`gh pr merge --merge`, which
  keeps history).
- **Cost or billing risk:** GitHub Actions minutes on the private repo. The free-plan monthly
  allowance should cover about 16 jobs per run; check _Settings → Billing_ if runs are frequent.
- **Acceptance:** all 16 CI jobs succeed on the PR head commit. No security check is skipped or
  weakened.
- **Evidence:** PR URL, run ID, `gh pr checks` output, and JUnit, SBOM and license artifacts.

**Step 2 — Repository protection**

- **Prerequisites:** step 1 is green.
- **Your action:** choose GitHub Pro, or move the repo to an organisation on a paid plan. Then
  configure §9.2: branch protection, required checks, secret scanning with push protection,
  Dependabot, CODEOWNERS and the Actions allow-list.
- **Cost or billing risk:** a paid GitHub plan; see github.com/pricing.
- **Acceptance:** a direct push to `main` is rejected; a PR without green checks cannot merge.
- **Evidence:** `gh api repos/<repo>/branches/main/protection` output and screenshots.

**Step 3 — AWS development account**

- **Prerequisites:** none.
- **Your action:** create `karen-dev` under AWS Organizations, with MFA on the root user and IAM
  Identity Center. **First create an AWS Budgets alert** (e.g. $25 and $50). Bootstrap the
  Terraform state (S3, KMS key, lock).
- **Cost or billing risk:** near zero until resources exist. The state bucket and KMS key cost
  cents per month.
- **Acceptance:** you can log in through Identity Center, the budget alert is active and the
  state backend works.
- **Evidence:** account ID (not secret), budget screenshot, `terraform init` output.

**Step 4 — Cognito authentication trial**

- **Prerequisites:** step 3.
- **Your action:** follow §9.4 (pool, clients, synthetic user, local API pointed at Cognito).
- **Cost or billing risk:** low. Essentials includes 10K MAU free per the AWS pricing page.
  SMS/OTP is billed per message, so **do not enable SMS** until DLT registration is done. Don't
  pick the Plus tier; it has no free tier.
- **Acceptance:**
  - A Cognito access token → `/v1/me` returns 200 and provisions a user under RLS.
  - An ID token returns 401.
  - A user suspended in KAREN's DB gets 403.
  - Behaviour after global sign-out is recorded.
  - The Expo PKCE flow works on a device.
- **Evidence:** a command transcript with tokens redacted, a screenshot of the Expo flow, the
  ADR-0015 checklist in §5 completed.

**Step 5 — Vercel AI Gateway smoke test**

- **Prerequisites:** a Vercel team, plus your approval of the spend.
- **Your action:** follow §9.5: dev key, a **hard budget** (e.g. $10), catalog fetch, then the
  §9.6 smoke tests with `KAREN_AI_DAILY_BUDGET_USD=1`, `KAREN_AI_MAX_REQUEST_COST_USD=0.01` and
  `max_output_tokens ≤ 50`.
- **Cost or billing risk:** paid inference. Bounded by the gateway's hard budget and KAREN's
  per-request and daily caps. Expected spend is cents, but verify the model price in the catalog
  first.
- **Acceptance:**
  - 1 non-streaming and 1 streaming completion succeed with `is_mock=false`.
  - Cost is recorded, no prompt text appears in logs, and an over-budget request is refused
    before calling the gateway.
  - Model slugs come from the live catalog.
- **Evidence:** invocation records (no content), TTFT measurement, and a gateway dashboard
  screenshot showing spend.

**Step 6 — Terraform plan (dev)**

- **Prerequisites:** step 3; real `terraform.tfvars` (ACM certificate, hostnames, the `oidc`
  values from step 4).
- **Your action:** run `terraform plan -out dev.plan` and review it with me. **No `apply`
  without separate approval.**
- **Cost or billing risk:** the plan itself is free. **Applying it is the main billing risk:**
  NAT gateway(s), RDS, ElastiCache, ALB, interface VPC endpoints and Fargate tasks bill hourly
  from creation. Use `single_nat_gateway=true` and the smallest sizes, and destroy after the
  rehearsal.
- **Acceptance:** the plan has no errors; the reviewed resource list and cost estimate are
  accepted; it contains no public database or Redis.
- **Evidence:** the plan file summary and a cost estimate from the AWS Pricing Calculator.

**Step 7 — Staging deployment and rollback rehearsal**

- **Prerequisites:** step 6 applied (with approval), images pushed to ECR, migrations applied
  using the `migrate` image, and `roles.sql` run.
- **Your action:** follow `docs/runbooks/deploy-and-rollback.md`:
  1. Deploy SHA A, then SHA B.
  2. Roll back to SHA A.
  3. Trigger a failed deployment (for example, a task definition missing `APP_ENV`) and watch
     the circuit breaker roll it back.
  4. Run a restore from an RDS snapshot or PITR into a scratch instance.
- **Cost or billing risk:** hourly charges for the whole environment while it runs. Time-box
  the rehearsal and tear down afterwards.
- **Acceptance:**
  - Smoke checks pass after each step.
  - The rollback completes within the agreed objective.
  - The circuit breaker rolled back automatically.
  - Restore drill: data is readable.
  - RLS is verified on RDS (unscoped queries as the runtime role return 0 rows).
- **Evidence:** a timeline with SHAs, ECS events, smoke outputs, and restore timing.

**Step 8 — Security and legal sign-offs**

- **Prerequisites:** steps 1–7.
- **Your action:**
  - Security review of §4, §7 and §8.4, plus the threat model.
  - DPDP legal review (notices, retention schedule, processors including the gateway's upstream
    providers, cross-border transfer).
  - Vendor sign-off for §8.3.
- **Cost or billing risk:** counsel's fees. No cloud cost.
- **Acceptance:** written sign-offs; a retention schedule per data class; a processor list.
- **Evidence:** the signed documents, referenced from this report.

Rules for everything in this section:

- Run nothing here without your explicit go-ahead.
- Every step is non-production.
- Tear trial resources down afterwards.

### 9.1 Private GitHub repository and hosted CI

```bash
# The private repo and origin already exist (arvindydv/KAREN). Only the push is pending:
git log --oneline origin/main..main              # review the 10 commits
git push origin main                             # needs your approval; fast-forward, history preserved
gh run watch -R arvindydv/KAREN                  # expect all jobs green; record the result here
```

Then add `.github/CODEOWNERS` with real handles, for example `* @<org>/core`, and
`/infra/ @<org>/platform`.

### 9.2 Branch protection, environments and secrets

**Prerequisite (purchase decision).** GitHub refuses branch protection on this private personal
repository unless the account is on GitHub Pro. Choose one:

- GitHub Pro on the personal account; or
- **recommended:** transfer the repo to an organisation on a paid plan, which also gives team
  CODEOWNERS and organisation-wide MFA enforcement.

Until then, `main` is unprotected. Every change must still go through a PR by convention.

1. **Protect `main`:**
   - Require a pull request with ≥1 approving review, plus CODEOWNERS review.
   - Dismiss stale approvals.
   - Require conversation resolution and linear history.
   - Allow no force pushes or deletions.
   - Apply the rules to admins too.
2. **Required status checks** (exact job names from `ci.yml`):
   - `TypeScript — format, lint, typecheck, unit tests, build, contracts`
   - `Integration — PostgreSQL/pgvector, Redis, Temporal, migrations`
   - `Web — Playwright smoke`
   - `Mobile — Expo config + JS bundle (iOS/Android)`
   - `Python — ai-service (ruff, mypy, pytest)`
   - `Python — voice-agent (ruff, mypy, pytest)`
   - `Terraform — fmt, validate, offline tests`
   - `Security — secret scan + dependency vulnerabilities`
   - `Container build — api`, `— temporal-worker`, `— provider-worker`, `— web`, `— admin`,
     `— ai-service`, `— voice-agent`
3. **Code security:** turn on secret scanning with push protection, Dependabot alerts and
   security updates, and private vulnerability reporting.
4. **Actions settings:**
   - Default `GITHUB_TOKEN` permissions: read-only.
   - Allow only GitHub-owned actions plus `pnpm/*`, `astral-sh/*`, `hashicorp/*`, `docker/*`
     and `aws-actions/*`.
   - Require SHA pinning.
5. **Environments:** create `dev`, `staging` and `production`.
   - `production`: required reviewers, deployments from `main` only.
   - Keep the repo variable `DEPLOYMENTS_ENABLED` **unset**.
   - Variables later: `AWS_DEPLOY_ROLE_ARN` per environment.
   - CI needs **no secrets**.

### 9.3 AWS development environment (no paid resources until you approve the plan)

1. **Accounts:** AWS Organizations with separate `karen-dev`, `karen-staging` and `karen-prod`
   accounts.
   - Root user with MFA, used for nothing else.
   - IAM Identity Center for people.
   - AWS Budgets alert on `karen-dev`, e.g. $50/month.
2. **Terraform state:** follow `docs/runbooks/terraform-state-bootstrap.md` (S3 + KMS + lock) in
   `karen-dev`.
3. **First plan:**
   - Run `terraform -chdir=infra/terraform/environments/dev plan -out dev.plan` with a reviewed
     `terraform.tfvars`.
   - Leave `enable_admin=false` and `oidc` unset.
   - **Review the plan and its cost before any `apply`.**
4. **GitHub OIDC deploy role** (`token.actions.githubusercontent.com`): trust restricted to
   `repo:<org>/karen:environment:dev`.
5. **Database, after RDS exists:**
   - Create a dedicated migration role (not the RDS master user).
   - Run `prisma migrate deploy` with `MIGRATION_DATABASE_URL`.
   - Run `psql -v ON_ERROR_STOP=1 -f infra/database/roles.sql`.
   - Run `CREATE ROLE karen_api LOGIN PASSWORD '<from Secrets Manager>' IN ROLE karen_api_runtime;`
   - Store `api/DATABASE_URL` with `sslmode=verify-full`.

### 9.4 Cognito identity-provider trial (ADR-0015)

All in `karen-dev`, `ap-south-1`.

1. **Create the user pool** (console: Cognito → User pools → Create).
   - Feature plan **Essentials**.
   - Sign-in with e-mail.
   - Self-registration **off** for the trial.
   - MFA optional.
   - Deletion protection on.
2. **Add an app client** `karen-dev-web`.
   - Public client, no secret.
   - Authorization-code grant with PKCE.
   - Scopes `openid email profile`.
   - Callback URLs `http://localhost:3000/auth/callback` and the Expo dev-client scheme.
   - Token revocation enabled.
   - Access-token TTL 15 min.
   - Refresh-token rotation, if offered for the client.
3. **Managed login:** set a domain prefix (e.g. `karen-dev-<random>`) and apply branding.
4. **Trial-only CLI client** `karen-dev-cli`.
   - Enable `ALLOW_USER_PASSWORD_AUTH` on this client **only**; delete it after the trial.
   - Create one synthetic user:
     ```bash
     aws cognito-idp admin-create-user --user-pool-id <pool> --username trial@<your-domain> --region ap-south-1
     aws cognito-idp admin-set-user-password --user-pool-id <pool> --username trial@<your-domain> --password '<strong>' --permanent
     ```
5. **Point the local API at Cognito** in `apps/api/.env`:
   ```
   AUTH_MODE=oidc
   OIDC_ISSUER_URL=https://cognito-idp.ap-south-1.amazonaws.com/<pool-id>
   OIDC_JWKS_URL=https://cognito-idp.ap-south-1.amazonaws.com/<pool-id>/.well-known/jwks.json
   OIDC_AUDIENCE=<karen-dev-cli client id>
   OIDC_AUDIENCE_CLAIM=client_id
   OIDC_REQUIRED_TOKEN_USE=access
   OIDC_ALLOWED_ALGORITHMS=RS256
   ```
6. **Run the smoke test.** It is free and makes no model calls.
   ```bash
   TOKENS=$(aws cognito-idp initiate-auth --auth-flow USER_PASSWORD_AUTH --client-id <cli-client-id> \
     --auth-parameters USERNAME=trial@<your-domain>,PASSWORD='<strong>' --region ap-south-1)
   ACCESS=$(echo "$TOKENS" | jq -r .AuthenticationResult.AccessToken)
   ID=$(echo "$TOKENS" | jq -r .AuthenticationResult.IdToken)
   curl -s localhost:4100/v1/me -H "authorization: Bearer $ACCESS"   # expect 200; user provisioned
   curl -s localhost:4100/v1/me -H "authorization: Bearer $ID"       # expect 401 (token_use=id)
   aws cognito-idp admin-user-global-sign-out --user-pool-id <pool> --username trial@<your-domain> --region ap-south-1
   # The access token stays valid until expiry (stateless JWT): KAREN must rely on short TTL +
   # DB status. Record observed behaviour; then suspend in KAREN DB → expect 403.
   ```
7. **Then evaluate the rest of the ADR checklist:**
   - Google and Apple federation.
   - E-mail OTP.
   - Passkeys on iOS and Android dev builds.
   - Expo PKCE flow.
   - Refresh rotation and revocation.
   - India SMS with DLT.
   - Custom domain.
   - Actual regional pricing.
8. **Record the results in §5 and set the Terraform `oidc` variable.** Delete `karen-dev-cli`
   afterwards.

### 9.5 Vercel AI Gateway development credentials

1. **Separate team/project** `karen-dev` in Vercel. Add a payment method only after you approve.
2. **Create an AI Gateway API key** for dev only. Set a **hard monthly budget** in the gateway,
   e.g. $10, and spend alerts.
3. **Store it** in AWS Secrets Manager `karen-dev`/`ai-service/AI_GATEWAY_API_KEY`. Locally, put
   it only in `apps/ai-service/.env`, which is git-ignored. Never use a `NEXT_PUBLIC_*` or
   `EXPO_PUBLIC_*` variable.
4. **Fetch the live model catalog.** This is a listing call; confirm in Vercel's documentation
   that it is not billed.
   ```bash
   curl -s https://ai-gateway.vercel.sh/v1/models -H "Authorization: Bearer $AI_GATEWAY_API_KEY" | jq '.data[].id'
   ```
   Choose candidate slugs per tier from that output only. Write them, with prices and
   `verified_at`, into a dev registry file. Set `KAREN_MODEL_<TIER>`.

### 9.6 Minimal, controlled live integration smoke tests (each needs your approval)

| Test                                                                                                                                                                                                  | Cost                                     | Pass criteria                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------- |
| Cognito token → API `/v1/me` (§9.4.6)                                                                                                                                                                 | Free tier                                | 200 for access token, 401 for ID token, 403 after DB suspension               |
| Gateway **one** non-streaming completion: `KAREN_AI_GATEWAY_MODE=live`, `KAREN_AI_DAILY_BUDGET_USD=1`, `KAREN_AI_MAX_REQUEST_COST_USD=0.01`, `max_output_tokens` ≤ 50, ECONOMY tier, synthetic prompt | A few cents at most (verify price first) | 200, `is_mock=false`, served model recorded, cost recorded, no prompt in logs |
| Gateway **one** streaming completion (same caps)                                                                                                                                                      | Cents                                    | Single `start`, deltas, single `done`; TTFT recorded from `ap-south-1`        |
| Budget refusal: set `KAREN_AI_DAILY_BUDGET_USD` below one request                                                                                                                                     | Free (refused before the call)           | `BUDGET_EXCEEDED`, 0 gateway calls                                            |
| Hosted CI first run                                                                                                                                                                                   | Free (GitHub Actions minutes)            | All required checks green; artifacts present                                  |

## 10. Verification results (run 3, branch `phase-00-hardening`; all executed locally)

| Check                                                                                               | Result                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm verify` (format, public-env, migration gate, lint + boundaries, typecheck, unit tests, build) | **PASS**. **164 TS unit tests** (run 2: 159; +3 observability metrics, +1 webhook hand-off, +1 https identity config).                                                                                                                                                                                                                                                                                              |
| `pnpm test:integration` (real PostgreSQL 17, Redis, Temporal)                                       | **PASS**. API **41** (+2 metrics), temporal-worker 2 (incl. restart drill), ai-service Redis 5.                                                                                                                                                                                                                                                                                                                     |
| `pnpm verify:py`                                                                                    | **PASS**. ai-service 151, voice-agent 61.                                                                                                                                                                                                                                                                                                                                                                           |
| `pnpm test:e2e:web`                                                                                 | **PASS** 3/3.                                                                                                                                                                                                                                                                                                                                                                                                       |
| `pnpm evals` (mock)                                                                                 | **PASS (mock)**: 9 PASS, 0 FAIL, 5 NOT_EVALUATED.                                                                                                                                                                                                                                                                                                                                                                   |
| `pnpm contracts:check`                                                                              | **PASS**                                                                                                                                                                                                                                                                                                                                                                                                            |
| `pnpm infra:validate`                                                                               | **PASS** (3 × 4/4)                                                                                                                                                                                                                                                                                                                                                                                                  |
| actionlint (16-job CI)                                                                              | **PASS** (0)                                                                                                                                                                                                                                                                                                                                                                                                        |
| `pnpm check:licenses`                                                                               | **PASS** (1,032 packages)                                                                                                                                                                                                                                                                                                                                                                                           |
| `pnpm audit --audit-level high --prod`                                                              | **PASS** (0 high; 4 moderate dev-tooling, accepted)                                                                                                                                                                                                                                                                                                                                                                 |
| OSV scanner                                                                                         | **PASS**                                                                                                                                                                                                                                                                                                                                                                                                            |
| gitleaks `--all` (complete history)                                                                 | **PASS** (no leaks)                                                                                                                                                                                                                                                                                                                                                                                                 |
| Docker: api runtime                                                                                 | **PASS**. Readiness 200 while connected as the restricted DB role; no Prisma CLI in the runtime image, as expected.                                                                                                                                                                                                                                                                                                 |
| Docker: api `migrate` target                                                                        | **PASS**. Runs as non-root; `migrate status` succeeded against the dev DB.                                                                                                                                                                                                                                                                                                                                          |
| Docker: provider-worker                                                                             | **PASS**. Built (a first attempt stalled without output and was restarted; the rebuild took about 70 s). Ready with the kill switch on and Redis + Temporal connected.                                                                                                                                                                                                                                              |
| Fresh clone                                                                                         | Run 2 (`6173b78`) **PASS**. Run 3's diff touches no install or toolchain inputs beyond `pnpm-lock.yaml` (two direct deps already present in the lockfile); `pnpm install --frozen-lockfile` passes.                                                                                                                                                                                                                 |
| **Hosted CI, PR #1** (run 44705796262, head `d4e51a5`)                                              | **16/16 SUCCESS.** The log confirms the RLS tests (17), metrics tests (2) and restart drill ran. Totals: Vitest unit 160, Jest 4, integration 43 + 5. License gate and migration gate passed; gitleaks found no leaks; OSV found no issues; audit found 0 high. Non-blocking: 16 "Node.js 20 is deprecated" warnings from pinned third-party actions (follow-up: Dependabot action bumps after the 7-day cooldown). |

**Not executed:**

- Hosted CI of the branch.
- `terraform plan/apply`.
- Any Cognito or Vercel request (**no paid calls**).
- An ECS deploy or rollback.
- Export to a real metrics backend. Only the in-memory exporter is proven.

## 11. Known limitations and residual risks

- **Approval signals are trusted from the API.** Until Phase 04 stores approvals in the database
  and marks them consumed, anyone with Temporal signal access could forge one. Restrict namespace
  access in Temporal Cloud.
- **Threat model file not updated.** `docs/security/threat-model.md` should still absorb §7. The
  migration rule is now in `docs/runbooks/database-migrations.md`.
- **Metrics backend not proven.** OTLP metric export is configured but has not been tested
  against a real collector or backend. That will be checked in staging (§9.0, step 7).
- **RLS relies on the transaction-local setting.** It protects against a missing filter, not
  against SQL injection that calls `set_config`. Parameterised queries remain the primary control.
- **Per-request transaction cost.** Principal resolution now adds one short transaction per
  request. The latency impact is not measured; measure p95 in staging.
- **Next.js CSP** still allows `'unsafe-inline'` scripts. Move to nonce-based CSP in Phase 01.
- **`karen_phases.md` was reformatted once by Prettier** in run 1 (whitespace and emphasis style
  only).

## 12. Remaining Phase 00 exit criteria and Phase 01 readiness

**Gate 00, criterion by criterion:**

1. **Clean clone reproduces the tests:** ✅ locally and ✅ in hosted CI (PR #1, 16/16).
2. **GitHub CI and deployed staging pass smoke checks:** ❌
   - CI: ✅ green on PR #1. It must stay green after merging.
   - Branch protection: needs a paid GitHub plan.
   - Staging: needs AWS (steps 3, 6 and 7).
3. **User data access isolated:** ✅ locally. ⏳ Still to verify on RDS (step 7).
4. **Real IdP and gateway trials done:** ❌ Steps 4 and 5.
5. **On-call rollback rehearsed:** ❌ The runbook now exists; the rehearsal needs ECS (step 7).
6. **Production closed to the public:** ✅ Nothing is deployed.

**Phase 01 readiness: NOT READY.** Gate 00's external criteria (2, 4, 5) are unmet. No local
engineering work remains in Phase 00.

**Next actions, in order:**

1. **Review and approve the merge of PR #1.** It is green, with mergeable state `CLEAN`. After
   the merge, confirm that the `push`-to-`main` CI run is also green.
2. Decide the GitHub plan, then turn on branch protection with the 16 required checks (step 2).
3. Approve adding coverage reporting (#5), or accept JUnit-only artifacts for Phase 00.
4. Create `karen-dev` with a budget alert (step 3), then run the Cognito trial (step 4).
5. Approve the gateway spend cap (step 5), then the Terraform plan review (step 6).
