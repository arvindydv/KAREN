# KAREN — Foundation Readiness Report

- Date: 2026-11-20 · Scope: foundation hardening & release gate (no product features)
- Environment: Linux workstation, Node 24.4.1, pnpm 10.28.0, uv 0.9.10, Docker 29.6.1,
  Terraform 1.15.7; local PostgreSQL 17 + pgvector 0.8.7, Redis 7.4.12, Temporal dev server
  via `docker compose`.
- Statuses: **PASS** (executed, succeeded) · **FAIL** · **BLOCKED** (cannot run here: missing
  credentials/cloud/tooling) · **NOT VERIFIED** (not exercised; no claim made).

> **This is not a production-readiness claim.** Everything below was validated locally. No cloud
> account was touched, no Terraform was planned/applied, the Vercel AI Gateway was never called
> with a real key, and GitHub CI has not run yet (no remote).

## 1. Verdict

The foundation is **safe and stable enough to start product feature work** (beginning with
Authentication & Onboarding) without another restructuring. Ten security findings were fixed in
code with tests (§3). The remaining blockers (§5) gate **real users / first deploy**, not the
start of development.

## 2. Verification results (commands actually executed)

| #   | Command                                                                                           | Result                         | Notes                                                                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `pnpm install --frozen-lockfile`                                                                  | **PASS**                       | lockfile up to date                                                                                                                                                |
| 2   | `pnpm verify` (format, public-env guard, lint + dependency-cruiser, typecheck, unit tests, build) | **PASS**                       | 23/23 turbo tasks; 107 TS unit tests across 14 packages (api 19, domain 26, provider-worker 13, temporal-worker 10, config 7, …; mobile 4 via Jest)                |
| 3   | `pnpm verify:py` (ruff, ruff format, mypy --strict, pytest)                                       | **PASS**                       | ai-service 150 passed; voice-agent 61 passed                                                                                                                       |
| 4   | `pnpm test:integration`                                                                           | **PASS**                       | API 20 tests on real Postgres/Redis; temporal-worker/provider-worker integration; **new** ai-service Redis suite 5 tests (`pytest -m integration`)                 |
| 5   | `pnpm test:e2e:web` (Playwright, Chromium, production build)                                      | **PASS**                       | 3/3                                                                                                                                                                |
| 6   | `pnpm evals`                                                                                      | **PASS (mock)**                | 6 cases: 9 PASS, 0 FAIL, 5 NOT_EVALUATED — mock gateway validates routing/policy/tool boundaries only, **not model quality**                                       |
| 7   | `pnpm infra:validate` (fmt, init -backend=false, validate, offline `terraform test`) ×3 envs      | **PASS**                       | static only; nothing planned or applied                                                                                                                            |
| 8   | `pnpm contracts:check`                                                                            | **PASS**                       | Before the first commit the script's `git diff` had no baseline (vacuous); re-run after the initial commit: no drift (§6)                                          |
| 9   | `pnpm db:migrate:diff` (new root alias) with shadow DB                                            | **PASS**                       | "No difference detected"; `db:migrate:status`: up to date                                                                                                          |
| 10  | GitHub Actions lint: `rhysd/actionlint:1.7.7` (incl. shellcheck)                                  | **PASS**                       | 0 errors in `ci.yml`, `deploy.yml`                                                                                                                                 |
| 11  | Secret scan: `gitleaks v8.28.0 dir` (working tree)                                                | **PASS for committable files** | 26 hits, **all** Next.js build-time preview keys inside git-ignored `apps/*/.next/`; 0 in committed files; `gitleaks git` over history after commit: no leaks (§6) |
| 12  | `pnpm audit --audit-level high --prod`                                                            | **PASS**                       | 0 production advisories                                                                                                                                            |
| 13  | `pnpm audit` (all, incl. dev)                                                                     | **4 moderate (accepted)**      | dev tooling only — see §3.8                                                                                                                                        |
| 14  | OSV `osv-scanner v2.2.4` over `pnpm-lock.yaml` + both `uv.lock`                                   | **PASS**                       | 1,717 + 83 + 86 packages; 2 time-boxed ignores (dev tooling)                                                                                                       |
| 15  | Docker builds (7 images) + smoke tests                                                            | see §2.1                       |                                                                                                                                                                    |
| 16  | GitHub CI on a real runner                                                                        | **BLOCKED**                    | no remote; pushing not authorised (§6)                                                                                                                             |

### 2.1 Container images

All built with the CI commands (`docker build`, same Dockerfiles/args), then run with
`--network host` against local infra. Every image runs as a non-root user.

| Image                    | Build    | Smoke test                                                                                                                                                                                                                                                                   | Result                               |
| ------------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| api (750 MB)             | **PASS** | `/health/live` 200, `/health/ready` 200, `/v1/me` 401 without token, 200 with local-dev token; refuses to start without `APP_ENV`; refuses `APP_ENV=staging` + `AUTH_MODE=local-dev`                                                                                         | **PASS**                             |
| temporal-worker (566 MB) | **PASS** | `/health/ready` 200 (connected to local Temporal); refuses without `APP_ENV`                                                                                                                                                                                                 | **PASS**                             |
| provider-worker (573 MB) | **PASS** | `/health/ready` 200                                                                                                                                                                                                                                                          | **PASS**                             |
| web (262 MB)             | **PASS** | `/` 200 (Next.js standalone)                                                                                                                                                                                                                                                 | **PASS**                             |
| admin (262 MB)           | **PASS** | `/sign-in` 200; console routes redirect (no staff IdP — by design)                                                                                                                                                                                                           | **PASS**                             |
| ai-service (249 MB)      | **PASS** | `/health/ready` 200 (local and deployed-shape `APP_ENV=dev`+Redis); signed completion 200 (`is_mock: true`), **replayed signature 401**, forged 401; Redis budget hash + replay marker written; refuses without `APP_ENV` and with `KAREN_AI_BUDGET_STORE=memory` in staging | **PASS**                             |
| voice-agent (500 MB)     | **PASS** | Exits by design: "refusing to connect: LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET not set"; refuses without `APP_ENV`                                                                                                                                                  | **BLOCKED** (no LiveKit credentials) |

Not done: image vulnerability scanning (Trivy not installed; not in CI either — recommended),
multi-arch builds, pushing to ECR.

## 3. Security findings and fixes

| #    | Area (task item)                 | Finding (verified in code)                                                                                                                                                                                             | Fix                                                                                                                                                                                                                                                                                                       | Evidence                                                                                                                           |
| ---- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 3.1  | Rate limiting (1)                | Redis error ⇒ limiter returned "not blocked" for **all** routes incl. auth. Window key created by `INCR` then separate `PEXPIRE` (crash ⇒ key without TTL ⇒ permanent block).                                          | New `sensitive` throttler via `@SensitiveRateLimit()` **fails closed** (503 `DEPENDENCY_UNAVAILABLE`, retryable); default throttler **degrades** to a bounded per-process window. Atomic `MULTI{SET NX PX; INCR; PTTL}`. Applied to the dev token route; all future auth/OTP/approval routes must use it. | `redis-throttler.storage.ts`, unit + 2 integration tests (limit enforced; Redis down ⇒ 503 on sensitive, 401→429 on default)       |
| 3.2  | Rate-limit key spoofing (1)      | `trustProxy: true` ⇒ client-controlled left-most `X-Forwarded-For` became the rate-limit key.                                                                                                                          | `API_TRUSTED_PROXY_HOPS` (Terraform default 2 = Cloudflare → ALB).                                                                                                                                                                                                                                        | `bootstrap.ts`, env docs, Terraform var with validation                                                                            |
| 3.3  | AI budget (2)                    | Per-process tracker: N replicas ⇒ N × budget, reset on restart.                                                                                                                                                        | `RedisDailyBudgetTracker`: per-UTC-day hash, Lua reserve/settle/release, integer micro-USD, **fails closed** before any gateway call. Settings refuse `memory` store in dev/staging/production; Terraform sets `KAREN_AI_BUDGET_STORE=redis`.                                                             | Integration: 50 concurrent reservations from 2 connections ⇒ exactly 10 granted; outage ⇒ 503                                      |
| 3.4  | Auth bypass in deployed envs (3) | `APP_ENV` defaults to `local`; an image deployed without it would allow `AUTH_MODE=local-dev` and unsigned internal calls.                                                                                             | All images bake `KAREN_DEPLOYED_ARTIFACT=true`; TS `loadEnv` and both Python settings then **refuse** a missing `APP_ENV`.                                                                                                                                                                                | Unit tests (TS + Python); container smoke: image without `APP_ENV` exits with ConfigError; `APP_ENV=staging` + `local-dev` refused |
| 3.5  | Authorisation (3)                | `identity.users.status` never checked: suspended / deletion-requested users kept full API access with valid IdP tokens.                                                                                                | `resolvePrincipal` denies non-`ACTIVE` accounts (403).                                                                                                                                                                                                                                                    | Integration test for both statuses                                                                                                 |
| 3.6  | Internal HMAC (5)                | Replay possible within the 300 s window for POSTs (billable completions); no rotation overlap; caller header unauthenticated.                                                                                          | One-time-use signature cache (Redis `SET NX EX 601`, fails closed) for POST/PUT/PATCH/DELETE; `INTERNAL_SERVICE_HMAC_SECRET_PREVIOUS` accepted during rotation (constant-time against both); runbook. Caller-header limitation documented.                                                                | Tests: replay ⇒ 401; previous key accepted; unknown key ⇒ 401; cross-replica replay refused on real Redis                          |
| 3.7  | Data isolation (4)               | All current queries correctly scoped; **no RLS, no DB roles/grants SQL** (Terraform only creates per-service secrets).                                                                                                 | Documented table-by-table RLS requirements + mechanism; cross-user consent isolation test. RLS/roles = blocker before real user data.                                                                                                                                                                     | `docs/security/data-isolation.md`, integration test                                                                                |
| 3.8  | Dependencies (8)                 | 4 moderate advisories (GHSA-3g3m-2fjr-6pw4 glob, GHSA-g3hv-75wg-m249 minimatch) only via Jest/Expo CLI/ESLint dev tooling.                                                                                             | Kept time-boxed OSV exceptions (to 2027-01-31); reason updated to include the ESLint path. **Unresolved, accepted**: not in server images or app bundles.                                                                                                                                                 | `pnpm audit --prod` = 0                                                                                                            |
| 3.9  | Secrets in Git (9)               | `.gitignore` already excluded `.env*`, keys, tfstate; missed `terraform.tfvars` at env level is covered by `infra/terraform/.gitignore`.                                                                               | Added `*.tfvars` (except examples), local DB files, dumps, logs, tmp, `.vercel/`. `.env.example` files contain placeholders only.                                                                                                                                                                         | gitleaks: 0 committable hits                                                                                                       |
| 3.10 | Logging (10)                     | API request logs included full URL **with query string** (future OAuth `code`/`state`, tokens).                                                                                                                        | Serializer logs path only. Pino redaction paths + text scrubber + `user_ref` reviewed: adequate.                                                                                                                                                                                                          | `app.module.ts`                                                                                                                    |
| 3.11 | Admin (6)                        | Console is fail-closed (no session ⇒ redirect) but has no deployable identity layer.                                                                                                                                   | ADR-0014: Cloudflare Access (validated in-app) + separate staff OIDC with MFA + API RBAC + audit. `enable_admin` must stay `false` until implemented.                                                                                                                                                     | Terraform already refuses admin without CIDR allow-list                                                                            |
| 3.12 | Egress (7)                       | SGs are default-deny with explicit rules, RDS/Redis have no egress, but services may reach **any** host on 443.                                                                                                        | Documented per-service FQDN allowlist and Network Firewall/egress-proxy decision; blocker before real users.                                                                                                                                                                                              | `docs/security/egress-policy.md`                                                                                                   |
| 3.13 | Migrations / errors (10)         | Reviewed: SQL migrations reviewed + drift-checked in CI, append-only audit trigger, never auto-applied in deploy workflow; error filter returns safe envelopes, logs 5xx with correlation id, no empty catches (lint). | No change needed.                                                                                                                                                                                                                                                                                         | `db:migrate:diff` PASS                                                                                                             |

New ADRs: **0013** (fail-closed coordination & environment guards), **0014** (admin access control).
Updated: ADR-0007/0012 cross-refs, threat model, internal-auth runbook, env-var reference, `.env.example`s.
New dependency: `redis==8.1.0` (ai-service; released 2026-07-30; zero transitive packages).

## 4. Readiness by area

| Area           | Status                                      | Detail                                                                                                                                                                                                                                                                   |
| -------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Authentication | **PASS (local) / BLOCKED (real IdP)**       | JWT verification (JWKS, iss/aud/exp, asymmetric allow-list), DB-held roles, inactive-account denial, local-dev issuer isolated to local/test (config + route + image guards). IdP not chosen; `OIDC_*` not wired in Terraform (API would refuse to start — fail closed). |
| AI Gateway     | **PASS (mock) / NOT VERIFIED (live)**       | Router, budgets (now shared), per-request caps, retries, streaming, contract fixtures tested. No gateway key ⇒ live calls, model IDs, prices and fallbacks are NOT VERIFIED; live mode refuses to start without a verified registry.                                     |
| Infrastructure | **PASS (static) / NOT VERIFIED (cloud)**    | Terraform validates for dev/staging/production with offline tests. Never planned or applied; state bootstrap, AWS account, Temporal Cloud, LiveKit, Cloudflare not provisioned.                                                                                          |
| CI             | **BLOCKED**                                 | Workflows lint clean; not executed on GitHub. Actions are pinned to major tags, not commit SHAs (recommend SHA pinning before enabling deploys).                                                                                                                         |
| Data           | **PASS (app-level) / BLOCKER (RLS, roles)** | see §3.7                                                                                                                                                                                                                                                                 |

## 5. Remaining blockers and known limitations

**Before starting Auth & Onboarding implementation:** none.

**Before first deployed environment:**

1. Choose IdP (ADR-0012) and wire `AUTH_MODE=oidc`/`OIDC_*` into Terraform task definitions.
2. SQL bootstrap for least-privilege per-service DB roles (data-isolation.md §3).
3. Split the verifier-side HMAC secret in Terraform before the first rotation (runbook note).
4. Terraform state bootstrap + first `plan` reviewed in a real account (never done).
5. Pin GitHub Actions to commit SHAs; enable branch protection + required checks.

**Before real users:** 6. PostgreSQL RLS on user-owned tables (data-isolation.md §2), in the same migrations as the tables. 7. Egress FQDN filtering (egress-policy.md). 8. Admin edge identity + staff session (ADR-0014) before `enable_admin = true`. 9. Live Vercel AI Gateway verification (key, catalog-verified registry, budgets on the gateway side). 10. DPDP legal review, retention schedule, export/deletion jobs; connector-token envelope encryption.

**Known limitations:** `x-karen-caller` is not authenticated (shared secret); in-flight reservations of a crashed ai-service process stay counted until day end (conservative); Redis is now on the critical path for auth-like routes and model calls (Multi-AZ required — production default); Playwright warns that `next start` is used with `output: standalone` (tests still exercise the production build; the image uses `server.js`); mobile native builds (EAS/Xcode/Gradle) **NOT VERIFIED** — only Expo config + JS bundle export run in CI.

## 6. Git and GitHub status

- Branch `main`, one initial commit ("Foundation: KAREN monorepo, hardened and verified"),
  535 files, working tree clean. No remote configured; nothing pushed.
- Post-commit checks: `pnpm contracts:check` **PASS** (regenerated OpenAPI + client identical to
  the committed copies); `gitleaks git` over history **PASS** ("no leaks found").
- Excluded by `.gitignore`: `node_modules`, `.venv`, build output (`dist`, `.next`, `.turbo`,
  `*.tsbuildinfo`), generated Prisma client, every `.env*` except `.env.example`, keys/certs,
  Terraform state/plans/`*.tfvars`, local DB files/dumps, logs, test reports, caches.
- **CI status: BLOCKED** — the workflows have never run on GitHub.

### Connect a private GitHub repository (not done — needs your authorisation)

```bash
# 1. Create the private repo (or create it in the GitHub UI with no README/licence/.gitignore)
gh repo create <owner>/karen --private --source=. --remote=origin --description "KAREN"
# 2. Push
git push -u origin main
# 3. Protect main: Settings → Branches → require PR + these status checks:
#    TypeScript, Integration, Web — Playwright smoke, Mobile, Python — ai-service,
#    Python — voice-agent, Terraform, Security, Container build — * (7)
# 4. Settings → Code security: enable secret scanning + push protection, Dependabot alerts
# 5. Keep repository variable DEPLOYMENTS_ENABLED unset (deploy workflow stays inert);
#    create `production` environment with required reviewers before any deploy work
```

Then watch the first real run (`gh run watch`) and record results here — local YAML linting is
not a substitute for an actual runner (service containers, `docker compose --wait`, Playwright
`--with-deps`, OSV/gitleaks images).

## 7. Architecture readiness for upcoming features

| Feature                                     | Supported by today's foundation                                                                                                          | Genuine gaps (no restructuring needed)                                                                    |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1. Authentication & onboarding              | Provider-neutral verifier, identity mapping, DB roles, inactive-account denial, `legal_acceptances`, fail-closed `@SensitiveRateLimit()` | IdP choice; client sign-in flows; profile/onboarding endpoints                                            |
| 2. Profile & consent                        | `identity.users` (locale, timezone, display name), `consent.consent_grants` with receipt hash + expiry, `ConsentService` deny-by-default | Grant/revoke endpoints + consent UI; RLS on consent tables                                                |
| 3. AI conversations (Vercel AI Gateway)     | Signed `AiServiceClient`, ModelRouter, SSE streaming, shared budget, contracts + Python mirror                                           | Conversation schema/module (`conversation.*`); live gateway verification                                  |
| 4. Personal Memory Engine                   | pgvector extension + raw-SQL module, `MEMORY_STORAGE` consent purpose, embedding tier behind a flag                                      | `memory.*` schema with provenance; RLS + `user_id` filter inside vector SQL; embedding model verification |
| 5. Responsibility Engine & task persistence | Canonical task state machine (`@karen/domain`), Temporal action workflow with approval verification + idempotency, task contracts        | `tasks.*`/`approvals.*` tables + outbox relay; workflow ↔ DB persistence activities                       |
| 6. Voice assistant                          | `voice-agent` (LiveKit worker, signed bridge to ai-service), SG/Terraform wiring                                                         | API-minted LiveKit tokens (ADR-0012); audio model path NOT VERIFIED                                       |
| 7. Authorised provider integrations         | Adapter contract, registry, webhook HMAC + replay guard, sandbox adapter labelled SANDBOX, reconcile-before-retry                        | Connector token envelope encryption; per-provider egress allowlist; first contracted partner              |

No feature requires moving services, changing the deployable count or rewriting contracts.

## 8. Recommended implementation sequence — Authentication & Onboarding

1. **ADR-0015: choose the IdP** against explicit criteria — India phone-OTP delivery (DLT-registered
   SMS templates), Google/Apple sign-in, passkeys, Expo + Next.js SDK quality, ap-south-1 data
   residency, pricing at 100k MAU, token customisation (`acr`/`amr`). Create dev/staging tenants.
2. **Wire OIDC config** (`OIDC_ISSUER_URL/AUDIENCE/JWKS_URL/ALLOWED_ALGORITHMS`, `AUTH_MODE=oidc`)
   into Terraform task definitions; add an integration test with a local mock IdP JWKS (rotation by `kid`).
3. **DB roles + RLS migration** for `identity.*`, `consent.*`, `platform.idempotency_records`
   with `PrismaService.withUserScope()` — before any profile data is written.
4. **Contracts first:** `PATCH /v1/me/profile`, `GET/POST /v1/me/consents`, `POST /v1/me/consents/{id}/revoke`,
   `POST /v1/me/legal-acceptances` in `@karen/api-contracts` → OpenAPI → generated client;
   `Idempotency-Key` on writes; consent receipts hashed and audited in the same transaction.
5. **Clients:** mobile (Expo AuthSession, Auth Code + PKCE, refresh token in SecureStore) and web
   (server-side session, httpOnly cookies, no tokens in `localStorage`); loading/empty/error/denied states.
6. **Onboarding flow:** language → city/timezone → legal acceptance → granular consents (each
   opt-in, nothing pre-ticked) → approval defaults; minimal data collection (product §24).
7. **Account lifecycle:** deletion request (Temporal workflow, grace period), suspension admin
   action (audited), session revocation on status change.
8. **Abuse controls:** `@SensitiveRateLimit()` on every auth-adjacent endpoint; per-user limiter
   key once authenticated.
9. **Step-up hooks** for HIGH-risk approvals using `acr`/`amr` (enforced later with approvals).
10. **Validation:** contract drift, integration (real Postgres/Redis), Playwright sign-in against the
    IdP test tenant, mobile E2E smoke; DoD checklist; update threat model.
