# KAREN — Complete Phased Product Feature Roadmap & Technology Execution Blueprint

**Version:** 1.0 — 20 November 2026  
**Status:** IMPLEMENTATION PLAN / NOT A CLAIM OF COMPLETION  
**Audience:** Claude Code, engineering, product, security, QA, and partner-integration teams  
**Product:** KAREN — premium, India-first personal AI life agent, designed for international expansion  
**Source of truth for starting state:** the repository status supplied on 20 November 2026 (`main`: `5781c15` foundation, `100a037` theme).  
**Architecture alignment:** `KAREN_WORLD_CLASS_TECH_ARCHITECTURE_2026.md`, product master specification audited v1.1, and the implemented eight-app foundation. This file is written to be actionable without requiring those documents to understand the work.

> **Purpose.** Convert KAREN from a locally tested foundation into a dependable personal AI assistant that can **understand requests → remember only what is permitted → plan → obtain approval → execute supported actions → independently verify results → follow through → recover or escalate**. The aim is _reliably completed outcomes_, not just plausible chatbot replies.

> **Truthfulness rule.** A UI shell, mock, sandbox workflow or approved design is never described as a live feature. External integrations are conditional on documented API rights, working credentials, commercial onboarding, provider support, security/legal approval and real environment tests. No product can guarantee perfect answers or universal transaction access.

---

## 1. Where we are today, and what not to rebuild

### 1.1 Implemented foundation: keep and extend

- [x] pnpm/Turborepo monorepo, strict TypeScript, Node 24; 8 application shells: `api`, `ai-service`, `temporal-worker`, `provider-worker`, `voice-agent`, `web`, `admin`, `mobile`.
- [x] NestJS/Fastify auth-guard scaffolding, `/v1/me`, OIDC/JWT validation hooks, DB-backed roles, disabled-user denial, health endpoints.
- [x] Python FastAPI model router abstraction, **mock-only** Vercel AI Gateway client, streaming skeleton, Redis-backed shared daily budget, signed interservice calls with replay protection.
- [x] Temporal action workflow skeleton, approval/idempotency checks; provider adapter contracts and **SANDBOX-labelled** provider.
- [x] Prisma/PostgreSQL 17/pgvector, module schemas and append-only audit structure.
- [x] Zod → OpenAPI → generated typed clients, mirrored AI/Python contract, domain task state machine, observability/config/UI packages.
- [x] Terraform AWS `ap-south-1` environments, CI/deploy workflow definitions, Docker images, existing unit/integration/browser/mock-eval tests and static IaC validation.
- [x] Deep-space marketing theme and shell screens.

### 1.2 Not implemented / not production verified

- [ ] Real user sign-up, login, onboarding, profile/consent management, recovery and account lifecycle.
- [ ] Real AI Gateway inference or verified model prices/IDs; real conversations; memory persistence and retrieval.
- [ ] Durable business records for goals/tasks/approvals/actions/notifications; verified provider execution.
- [ ] LiveKit-connected voice; real external provider connections and production webhooks; subscriptions and billing.
- [ ] Remote origin, pushed GitHub CI, branch protection, Terraform plan/apply, deployed environments, native device builds.
- [ ] Production-grade service DB roles/RLS, egress restrictions, admin identity, privacy/legal review, supported operations.

**Important:** The 107 TypeScript tests, 211 Python tests, integration tests, image builds and mocked AI evaluations prove important _local foundation behavior_, not completed features or external service reliability.

### 1.3 Progress conventions (use in issues and PRs)

- **Status:** `NOT_STARTED`, `IN_PROGRESS`, `BLOCKED_EXTERNAL`, `BLOCKED_TECH`, `DONE_LOCAL`, `VERIFIED_SANDBOX`, `VERIFIED_PRODUCTION`, `DEFERRED`.
- **Priority:** `P0` launch-critical, `P1` high-value next, `P2` later, `PX` partner/approval-dependent.
- **Requirement identity:** stable `Fxx-yy` feature IDs; keep when reorganizing phases.
- Every `DONE` claim must name proof (test, migration, screenshot, trace, load result, partner confirmation or runbook). Never equate `DONE_LOCAL` with `VERIFIED_PRODUCTION`.
- Use a feature flag for unverified external actions. Mock data must be visually labelled and mechanically isolated from real payment/booking records.

---

## 2. Non-negotiable architecture and technology decisions

| Concern                    | Recommended production choice                                                                                                                                                   | Rules / rationale                                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Web + marketing            | Existing **Next.js**, React, TypeScript; server rendering for public pages                                                                                                      | Reuse landing/theme; keep signed-in application accessible and responsive                                                                       |
| iOS + Android              | Existing **React Native/Expo**; Expo Router, TanStack Query, Zustand for local UI, SecureStore                                                                                  | Expo development builds for native SDKs; Android low-end device testing                                                                         |
| Admin/support              | Existing **Next.js admin** with separate staff IdP/audience and backend authorization                                                                                           | A redirect is not staff authentication; no staff access through ordinary user session                                                           |
| Product API                | Existing **NestJS/Fastify** modules, Zod/OpenAPI clients, Prisma, strict DTOs                                                                                                   | Own user/business state; no AI bypass around policy or audit                                                                                    |
| AI orchestration           | Existing **Python/FastAPI**; LangGraph where multi-step reasoning helps; Pydantic outputs                                                                                       | No direct AI write to financial/provider tables; use typed proposal APIs                                                                        |
| Paid multi-model inference | **Vercel AI Gateway** with backend-only API key, version-pinned tested model slugs and three-tier budgets                                                                       | Gateway unifies supported inference billing, not AWS/voice/partners; check catalog and terms before activation                                  |
| Internal model selection   | Existing KAREN `ModelRouter` + capability registry: `NO_MODEL`, `ECONOMY`, `BALANCED`, `REASONING`, `VISION`, `EMBEDDING`, `AUDIO`                                              | Select by quality, privacy, tail latency and cost per correct outcome; enforce fallback compatibility                                           |
| Live voice                 | Existing **LiveKit** worker, WebRTC, tested STT/TTS/realtime path                                                                                                               | Validate Gateway audio protocol with LiveKit; direct audio provider only as a documented exception                                              |
| Durable actions            | Existing **Temporal TypeScript worker**, canonical state machine and human approval                                                                                             | Temporal retries do **not** make external side effects exactly-once; reconcile with partner references                                          |
| Primary storage            | **PostgreSQL 17 + Prisma 7 + pgvector**, schemas per module; full-text search                                                                                                   | Transactional truth and auditable actions; expand/contract migrations; measured indexes                                                         |
| Short-lived coordination   | **Redis** for rate limits, TTL cache, atomic budgets, short-lived idempotency hints                                                                                             | Never sole authoritative record for payment, booking or task history                                                                            |
| Events/queues              | Transactional Postgres outbox → **SQS + DLQ / EventBridge**                                                                                                                     | Add Kafka only if high-volume replay/fanout benchmarks justify it                                                                               |
| Private objects            | **AWS S3**, KMS encryption, virus scan, lifecycle retention, presigned upload/download                                                                                          | No publicly readable user receipts/audio/document URLs                                                                                          |
| Hosting                    | Existing Terraform → **ECS/Fargate**, RDS, Redis, Secrets Manager in AWS Mumbai                                                                                                 | Do not introduce Kubernetes/Go/Rust/Qdrant by default; measure before adding                                                                    |
| Observability              | OpenTelemetry + Sentry + Langfuse (traces with content controls); CloudWatch/managed Grafana                                                                                    | Correlate `request_id`, `conversation_id`, `task_id`, `workflow_id`, `provider_operation_id`                                                    |
| Product analytics          | PostHog or equivalently privacy-configured analytics; server-side event catalog                                                                                                 | No raw personal chat or memory in analytics by default                                                                                          |
| CI/security                | GitHub Actions SHA-pinned; dependency/secret/IaC scans, SBOM, image signing, protected `main`                                                                                   | Immutable deploy artifact, stage gates, rollback                                                                                                |
| Authentication             | **ADR-0015: evaluate Cognito User Pools Essentials vs Auth0/Clerk; default recommendation: Cognito** for AWS-native, OIDC, passkeys and managed login _if UX/Expo spike passes_ | Cognito passkeys require supported pool plan/managed login; verify pricing, Apple/Google flows, custom domain and Expo PKCE before ADR sign-off |
| Payments                   | Approved PSP/merchant + user-authorized UPI/app-store billing as applicable                                                                                                     | KAREN never stores PIN/CVV/OTP; settlement proven from authoritative PSP/provider status                                                        |

**Avoid prematurely:** replacing current stack, custom-training a frontier LLM, production second gateway (OpenRouter/LiteLLM), ten new microservices, Kafka, Elasticsearch, vector DB cluster, bespoke payment wallet, or autonomous browser purchases. Propose ADRs only when a measured blocker exists.

### 2.1 Initial domain modules / data ownership

- `identity`: users, identities, sessions/device registrations, account status, profile, preferences, feature entitlements.
- `consent`: notices, consent grants/receipts, purposes, external connection grants, revocations, retention/deletion requests.
- `conversation`: conversations, messages, message events, sources, attached artefact references, feedback.
- `memory`: facts, suggestions, preferences, episodes, embeddings, conflicts, deletion jobs.
- `planning`: goals, goal checkpoints, reminders, user-created rules and schedules.
- `responsibility`: tasks, task events, action proposals, approvals, execution attempts, outcomes/evidence, follow-ups.
- `integration`: provider catalog, connection metadata, operation ledger, webhook inbox, reconciliation results.
- `notification`: notification intent, templates, deliveries, acknowledgments, device endpoints, preferences.
- `billing`: plans, entitlements, purchases, renewals, verification, credits/quotas, refund status.
- `support`: cases, redacted evidence, escalation status, restricted operator actions.
- `platform`/`audit`: feature flags, model registry, prompt versions, distributed outbox, append-only audit, policies, data retention.

**DB approach:** each new module gets reviewed migrations, owner/service DB role, tenant/user-scoped access rules, audit events, indexes, contract tests, backfill/rollback plan. Production app credentials must not own tables or have `BYPASSRLS`. RLS transaction context and connection-pooling behavior must be tested explicitly. Use `FORCE ROW LEVEL SECURITY` where appropriate; migration owners remain separate.

### 2.2 Task safety contract (apply to ALL phases)

1. An LLM can **propose**, explain and rank actions; it cannot approve or execute a sensitive action itself.
2. Backend checks identity + scoped consent + policy + risk + exact permitted tool + resource ownership **for each action**.
3. Material proposal fields (person/account/recipient/address/date/time/quantity/price/currency/provider/expiry) are normalized and cryptographically bound to an approval. Any material change invalidates it.
4. A workflow records intent and idempotency key _before_ dispatch. Timeouts create `UNKNOWN/RECONCILING`, not `FAILED_AND_SAFE_TO_RETRY`.
5. Provider webhook signatures and replay checks are required but **provider-authoritative read-back** verifies outcomes. Never claim completed from frontend redirect or model text alone.
6. User sees real state, cancellation policy, date of last verification and human follow-up route. Every task ends as verified completed/cancelled, or visibly unresolved/escalated.
7. Prompt injection from email, web, documents or provider output cannot expand tool scopes or approve transactions.

---

## 3. Phases, sequencing, delivery gates

| Phase  | Name                                           | Deliverable                                                                    | Release gate                                           |
| ------ | ---------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------ |
| **00** | Foundation completion & external feasibility   | deployable, least-privilege, protected source repo; IdP and supplier decisions | CI/staging works; no unowned external blocker          |
| **01** | Identity, onboarding, privacy                  | real secure sign-up through account deletion                                   | auth and consent E2E, RLS proof                        |
| **02** | Premium AI chat                                | real, streamed, multilingual text assistant with grounded answers              | gateway live smoke, latency and budget controls        |
| **03** | Personal memory                                | viewable/editable permissioned long-term memory                                | isolation + deletion + retrieval evals                 |
| **04** | Goals, tasks, approvals, reminders             | Responsibility Engine with durable non-financial verified execution            | crash/replay/recovery/consent tests pass               |
| **05** | Connected productivity                         | calendar, email draft/send, contacts + connection manager                      | verified scopes, sandbox/test-account execution        |
| **06** | Natural voice & multimodal basics              | interruptible Hindi/Hinglish voice, transcript, safe handoff                   | measured Indian-accent/slot accuracy and audio latency |
| **07** | Proactive assistant & life operations          | patterns, routines, scheduled watches, proactive cards                         | explicit opt-in; low-noise notifications               |
| **08** | Research, documents, maps & discovery          | searchable evidence-backed comparisons, uploaded docs, location                | source freshness and grounding tests                   |
| **09** | Transaction engine & ONE approved pilot        | real quote → approval → provider → verification → refund path                  | partner contract and reconciliation proven             |
| **10** | Travel & mobility                              | flight/hotel/train/bus/cab discovery and approved partner actions              | separate go/no-go per provider, geography, capability  |
| **11** | Daily commerce & experiences                   | food, grocery, shopping, restaurants, events, local services                   | checkout and refund verified per partner               |
| **12** | Family, money insights & specialized workflows | delegation, health appointments, documents, expenses                           | high-risk data/privacy and regulated-market reviews    |
| **13** | Growth, subscription, international & scale    | premium monetization maturity, support, reliability and globalization          | load/security/DR/SLO gates and unit economics          |

**Cross-cutting parallel tracks (start in Phase 00; never defer):** accessibility/localization, admin operations, analytics, privacy/security, cost controls, reliability, product design, automated evaluations, support and incident response. **Subscriptions:** infrastructure during P04/P05, controlled paid beta before general launch; P13 covers mature packaging/growth, not first billing.

**Dependency spine:** `CI + IdP → privacy/consent → real gateway chat → memory → durable task/approval → trusted connected actions → voice/proactivity → transactional partner → wider verticals`. Vendor discovery can run in parallel, but a public promise cannot precede verified capability.

---

## PHASE 00 — Complete and production-validate the foundation

**Objective:** Turn the tested local scaffold into a secure, observable, repeatably deployable platform. Do NOT rebuild components that already pass unless gaps are reproduced.  
**Tech:** existing repo, AWS/Terraform, GitHub, Secrets Manager/KMS, ECS, RDS, Redis, Temporal, Cloudflare, OpenTelemetry, Playwright, k6, Renovate/Dependabot.  
**Exit artifact:** `FOUNDATION_RELEASE_GATE.md` with evidentiary links, architecture decision `ADR-0015`, staged deployment and rollback guide.

### F00-01 — Git, branch protection and CI

- [ ] Create GitHub organization/repository/private remote; confirm ownership, CODEOWNERS, contributor access, MFA and recovery admins. — **BLOCKED_EXTERNAL** (private repo `arvindydv/KAREN` exists (personal account); org account, CODEOWNERS and MFA/recovery checks pending)
- [ ] Push both existing commits and signed/protected release tags; preserve history; confirm clean working tree. — **BLOCKED_EXTERNAL** (`100a037` on origin; 10 new commits await push approval)
- [ ] Configure protected `main`: PR required, approvals, no force pushes, mandatory checks, secret scanning and Dependabot/Renovate. — **BLOCKED_EXTERNAL** (GitHub returns 403: private repo needs GitHub Pro or a paid org plan for branch protection; Dependabot config ready)
- [x] Pin GitHub Actions and reusable workflows to **commit SHAs**; least-privilege `permissions`, concurrency controls, OIDC deployment roles. — **DONE_LOCAL** (all `uses:` SHA-pinned, deploy hardened; actionlint clean)
- [ ] Run full `pnpm verify`, Python suite, Playwright, integration Postgres/Redis, mocked evals, SBOM/license/secret scans in hosted CI; upload test/JUnit/coverage artifacts. — **BLOCKED_EXTERNAL** (hosted run on `100a037`: 13/15 jobs passed; both failures (effect advisory, uv `--project`) fixed locally; JUnit/SBOM/license gate added; green run needs push)
- [x] Confirm CI runner Node 24, pinned pnpm/Python/uv; lockfile-only installs; reproducible clean clone. — **DONE_LOCAL** (fresh clone of `6173b78`: frozen install, `pnpm verify`, `verify:py`, integration all pass; hosted-runner confirmation via previous item)
- [ ] Add differential CI only after full checks are established; contract-drift check always required. — **BLOCKED_EXTERNAL** (by definition needs a green hosted-CI baseline first; not locally implementable)

### F00-02 — Environments, infrastructure and operations

- [ ] Create isolated AWS dev/staging/prod accounts or rigorously isolated resources; distinct service principals, keys, secrets, DBs, gateway keys/budgets. — **BLOCKED_EXTERNAL** (AWS accounts)
- [ ] Terraform remote encrypted state, lock mechanism, plan review, drift detection; run **plan first** and require approval to apply to staging/prod. — **BLOCKED_EXTERNAL** (static validate + offline tests pass; no plan/apply)
- [ ] Provision private VPC, private RDS/Redis, TLS ingress, AWS WAF/Cloudflare origin restrictions, egress allowlists, NAT/VPC endpoints, S3, KMS, ECS and autoscale settings. — **BLOCKED_EXTERNAL** (IaC exists; not provisioned)
- [x] Implement minimum-privilege database roles by service/module; migration-only elevated role; deny default public schema grants and superuser in app workloads. — **DONE_LOCAL** (`infra/database/roles.sql`, `pnpm db:roles`; local dev + tests + API image run as the restricted role; not yet applied in AWS)
- [ ] Enable backups, PITR, snapshot restoration drill, DR objectives, log retention and encrypted multi-AZ where appropriate. — **BLOCKED_EXTERNAL** (needs RDS)
- [x] Add readiness/liveness checks that check _appropriate_ dependencies; controlled degradation for optional services; configure health and startup alerts. — **DONE_LOCAL** (Redis-, DB- and IdP-JWKS-outage tests; cloud alerts NOT VERIFIED)
- [ ] Configure OTel trace sampling, redaction, Sentry alerts, structured logs, metrics for p95/p99, provider failure, cost, retries, SQS DLQ, DB pool utilization. — **IN_PROGRESS** (logs/redaction/correlation done; local gap: p95/p99 + DB-pool metrics not emitted; alerts need cloud)
- [ ] Publish deploy/rollback, incident response, credential rotation, database migration, model outage, provider outage and webhook failure runbooks. — **IN_PROGRESS** (local gap: deploy/rollback, model-outage, provider-outage, webhook-failure runbooks — new doc files not authorised this run)
- [ ] Validate all container startup gates with real credentials in isolated nonproduction; voice-agent needs LiveKit sandbox account before claiming working. — **BLOCKED_EXTERNAL** (needs real credentials / LiveKit)
- [ ] Simulate failed deployment, rolled-back migration, missing secret, Redis outage, interrupted stream, worker restart and timeouts. — **BLOCKED_EXTERNAL** (local drills done (Redis, DB, JWKS outage, worker restart, stream disconnect, migration failure, missing secret); failed-deployment drill needs ECS)

### F00-03 — Privacy/security engineering foundation

- [ ] Identify data classification per field (PII, sensitive, operational, provider tokens, aggregated); data flow map including gateway/upstream AI processors. — **BLOCKED_EXTERNAL** (field classification + data-flow map in report; upstream AI-processor list needs live gateway routing + legal)
- [ ] Define retention and deletion policy per data class; legal review of India's DPDP Act/Rules 2025 phased effective requirements, user notices, vendors and cross-border transfers. — **BLOCKED_EXTERNAL** (DPDP legal review)
- [x] Add user-scoped PostgreSQL RLS policies and negative tests for read/write/list/search/joins, missing context, pooled connections and role bypass. — **DONE_LOCAL** (migration `20261120090000_user_isolation_rls`, `rls.int.test.ts` (17 tests))
- [ ] Implement security headers, CSRF where cookie sessions used, CSP, CORS allowlist, SSRF-safe URL fetch, attachment scanning and outbound hostname restrictions. — **IN_PROGRESS** (headers/CSP/CORS + SSRF-safe `safeFetch` done; CSRF waits for cookie sessions (P01), attachment scanning for uploads (P08), egress filtering for AWS)
- [x] Threat model prompt injection, OAuth token theft, model egress, replay, webhook spoofing, impersonation, approval race, duplicate side effects, rogue support access. — **DONE_LOCAL** (all nine scenarios with mitigations + evidence in report §7)
- [x] Implement audit event semantics: actor, action, target, outcome, policy decision, trace link, timestamp, reason; do not log raw tokens or unmasked PII. — **DONE_LOCAL** (`policy_decision` + `reason_code`; DENIED must carry both)
- [x] Create staging-only synthetic users/profiles and synthetic provider callbacks; forbid production secrets and sensitive content in fixtures. — **DONE_LOCAL** (`@karen/test-fixtures`; seed refuses outside local/test)

### F00-04 — Vendor feasibility and ADRs

- [ ] **ADR-0015:** prototype Cognito Essentials managed login + Google/Apple federation + email OTP/password + passkeys + Expo PKCE + account recovery; compare Auth0/Clerk UX, current costs and operational burden before selecting. — **BLOCKED_EXTERNAL** (desk evaluation done (Cognito Essentials, conditional; report §5); hands-on spike needs AWS account)
- [ ] Decide exact non-production identity issuer/audience/JWKS and staff-console identity approach; update existing JWT guard and Terraform; verify real token lifecycle. — **BLOCKED_EXTERNAL** (guard + config rules + Terraform done; real issuer/client id + token lifecycle need the spike)
- [ ] Create paid/nonproduction Vercel AI Gateway account, separated keys and hard budgets; fetch live model catalog and pin benchmarked `creator/model` IDs (no fabricated slugs). — **BLOCKED_EXTERNAL** (paid account/key)
- [ ] Test Python gateway streaming/structured outputs/tools/timeouts/fallback/cost metadata from AWS Mumbai and collect live TTFT measurements. — **BLOCKED_EXTERNAL** (needs gateway key; no paid calls made)
- [x] Create `provider_capability_registry`: capability/read/write, API permitted, contract owner, sandbox, quotas, callback signature, consent/scopes, region, reconciliation, expiry, alternatives. — **DONE_LOCAL** (descriptor schema + registry enforcement, tested)
- [ ] Start Google/Microsoft OAuth verification, LiveKit test account, and **one** viable booking/commerce partner outreach early; record partner lead times and legal conditions. — **BLOCKED_EXTERNAL** (vendor/partner processes)
- [ ] Select observability/feature flag and transactional-email vendor with cost/retention review; do not add paid tools without a reason. — **IN_PROGRESS** (recommendation in report §8 (no new paid tools); owner sign-off pending)

**Phase 00 status (2026-11-20, run 2):** 9 DONE_LOCAL · 4 IN_PROGRESS · 18 BLOCKED_EXTERNAL · 0 NOT_STARTED — Gate 00 **NOT PASSED**; see `docs/PHASE_00_REPORT.md`.

**Gate 00:** clean clone reproduces test suite; GitHub CI and deployed staging pass smoke checks; user-data access is isolated; real IdP/gateway spikes completed; on-call rollback path rehearsed. Production must remain inaccessible to public users until Phase 01 controls pass.

---

## PHASE 01 — Authentication, onboarding, profile, consent, user lifecycle

**User journey:** opens app → chooses language → creates/signs into account → verifies identity → reads privacy notice → picks allowed permissions → personalizes KAREN → sees permission-scoped empty home → can recover, export or delete account.  
**Tech:** Cognito OIDC/PKCE (subject to ADR-0015), NestJS/Fastify, Prisma/Postgres, Zod/OpenAPI, KMS, Expo AuthSession + SecureStore, Next.js BFF/session cookies, Playwright/Detox or Maestro, FCM/APNs token collection later.  
**Suggested tables:** `identity.users`, `identity.external_identities`, `identity.devices`, `identity.profiles`, `identity.user_preferences`, `consent.notices`, `consent.grants`, `consent.receipts`, `consent.requests`, `consent.data_subject_requests`, `audit.events`.

### F01-01 — Authentication and signup

- [ ] Welcome: continue as signed-out visitor to public page; app-specific sign-up/sign-in routes with branded loading/errors.
- [ ] Signup paths: Google, Sign in with Apple where required, email OTP or password, passkey capability when validated; phone verification only when justified, with SMS abuse caps.
- [ ] Email/phone canonicalization, duplicate-account and federated identity linking with authenticated proof; guard against accidental account takeover.
- [ ] Password policy if supported, email verification, expired OTP, retry/resend throttles, lockout/captcha as risk controls—not blanket friction.
- [ ] OAuth 2.0 authorization code + PKCE, strict redirect URI, state/nonce, token validation (`iss`, `aud`, `exp`, `nbf`, `kid`), key rotation and logout propagation.
- [ ] Backend `POST /v1/identity/bootstrap` idempotently maps OIDC subject to local UUID and default role; never accept client-supplied admin role.
- [ ] Sign in on web/mobile; refresh token rotation, secure storage, biometric unlock for local app access (not a replacement for server auth).
- [ ] Password reset/account recovery, lost device, passkey management, session expiry, invalid token, network-offline and suspended-account UX.
- [ ] Sign out current device / all devices; revoke refresh tokens, clear local sensitive caches and stale notification endpoints.
- [ ] Account enumeration resistance, CSRF/XSS/session fixation checks, login rate limit with real proxy IP trust policy.

### F01-02 — Onboarding and first-run guidance

- [ ] First-run language: English/Hindi/Hinglish; preferred writing script, regional formatting, timezone, country/currency and accessibility options.
- [ ] Name and preferred address of KAREN; optional photo/avatar; no forced birthdate, income, household or exact location collection.
- [ ] Personal preferences: city, travel preferences, optional budget ranges, dietary preferences, work calendar, notification hours; mark each optional.
- [ ] Explain **assist vs act**, with examples and explicit rule: KAREN asks before sending, purchasing, booking or disclosing.
- [ ] Explain optional personal memory and proactivity **separately**; default to conservative data collection and inactive external actions.
- [ ] Smart skip/resume onboarding; save step progress transactionally; reenter after interrupted login without duplicate records.
- [ ] First successful run: empty assistant chat, suggested safe prompts, goals/reminders starter examples and connection cards; only real capabilities shown.
- [ ] New-user first-response acceptance suite: Android/iOS/web accessibility, slow network, Hindi, failed permission prompt, notification denied.

### F01-03 — Profile and settings

- [ ] `GET/PATCH /v1/me/profile` with ETag/version, schema validation, audit and patch-level field ownership.
- [ ] Avatar signed upload, size/type validation, malware scan, crop/purge, safe placeholder.
- [ ] Separate home/current travel location, saved addresses and contact addresses; explicit location permissions and source.
- [ ] Locale, timezone, currency, date format, communication channels, theme, reduced motion, text size and screen reader settings.
- [ ] Device list: first/last seen, device label, current session, revoke action; no unrestricted device fingerprinting.
- [ ] Relationship to contact/connections displayed by category, scopes, expiry and last use; disconnected/offline state.
- [ ] Account status: active, limited, suspended, deletion-requested, deleted, linked identity recoverability.

### F01-04 — Consent and legal user controls

- [ ] Versioned privacy notice, terms of service, AI disclosure and vendor processing explanation with English/Hindi translation review.
- [ ] Granular `grant/deny/revoke` by purpose: AI processing, memory writes, connected-service read/write, notifications, proactivity, precise location, optional analytics, audio retention, family sharing.
- [ ] Durable consent receipt: subject, purpose, notice version, timestamp, policy version, channel, scope, expiry; never infer consent from app installation.
- [ ] Dashboard: who can access what, why, latest access, scope expiry, permissions revoked; revoke stops new work and handles in-flight operations visibly.
- [ ] Data export request, delete request, verification/identity check, async processing status, download expiry, cancellation before irreversible purge when permitted.
- [ ] Deletion propagation: relational facts, conversation data, object store, vectors, caches, analytics identifiers, connected tokens, queued jobs, external processors where applicable.
- [ ] Record legal retention exceptions and audit proofs without presenting an impossible guarantee of instant deletion from backup media.
- [ ] Minor/guardian eligibility design and region-specific legal gating; do not launch children's features until reviewed.

### F01-05 — Security and admin identity

- [ ] Separate admin OIDC audience/groups and strict staff API guards; admins cannot sign in solely as ordinary users.
- [ ] Privileged action step-up MFA, JIT access, session timeout, least-privilege permission matrix, impersonation ban or tightly controlled break-glass.
- [ ] Admin audit: actor, ticket/reason, target, read/write access, export, previous/new state; alert on bulk access.
- [ ] Cross-user RLS tests using real DB app roles; fuzz missing/forged account context, enum IDs and connection pooling.

**API minimum:** `/v1/identity/bootstrap`, `/v1/me`, `/v1/me/profile`, `/v1/me/devices`, `/v1/me/preferences`, `/v1/consent/notices`, `/v1/consent/grants`, `/v1/consent/requests`, `/v1/data-rights/export`, `/v1/data-rights/deletion`.  
**Gate 01:** authenticated signup/login/recovery/logout work on web + physical iOS/Android; no unauthorized reads; consent receipts can be verified; end-to-end data request and RLS negative tests pass.

---

## PHASE 02 — Real AI conversations and premium chat experience

**User journey:** ask in natural language → receive streaming answer in preferred language → view evidence/uncertainty → continue conversation → optionally save item/create task → recover from partial failure.  
**Tech:** existing NestJS SSE endpoint, Python FastAPI + `ModelRouter`, Vercel AI Gateway (live), Pydantic, Langfuse, OpenTelemetry, PostgreSQL messages, Redis budgets/rate limits, TanStack Query, virtualized message UI, S3 for attachments later.  
**Tables:** `conversation.threads`, `conversation.messages`, `conversation.message_events`, `conversation.sources`, `conversation.feedback`, `platform.ai_invocations`, `platform.model_registry`, `platform.prompt_versions`, `platform.usage_ledger`.

### F02-01 — Conversation model and APIs

- [ ] `POST /v1/conversations` create UUID/thread title, owner, locale, privacy/memory mode; list with cursor pagination and last-message timestamp.
- [ ] `GET /v1/conversations/{id}` scoped retrieval; `GET /messages?cursor=` pagination, stable order and no cross-user reads.
- [ ] `POST /v1/conversations/{id}/messages` with client idempotency key, duplicate-message suppression, optimistic display and durable initial record.
- [ ] Message statuses: pending, accepted, streaming, completed, incomplete, failed, canceled; tool events stored separately from assistant text.
- [ ] Rename, pin, archive, delete (and defined retention), search history, empty state, error recovery; thread migration schema versions.
- [ ] `POST .../cancel`, `POST .../regenerate`, `POST .../feedback`, copy/share **redacted** content, edit previous message/fork branch.
- [ ] Server-side append/author ownership; no client can forge model message, sources, approval or tool outcome.

### F02-02 — Low-latency streaming pipeline

- [ ] Stream structured SSE events with event IDs: `accepted`, `token_delta`, `source`, `tool_proposed`, `status`, `usage`, `complete`, `error`.
- [ ] Authenticate before opening stream; enforce scoped access, request timeout, bounded tokens, heartbeats, backpressure, disconnect handling.
- [ ] Handle reconnection and duplicate events by monotonic sequence; do not duplicate content on replay; fallback stream after partial output must be visibly a new attempt.
- [ ] Optimize first token: deterministic intent fast path; scoped async context fetch; model warm connections; compact prompts; measure gateway → upstream TTFT.
- [ ] Mobile/web: auto-scroll only when user is at bottom, readable Markdown/code blocks, code copy, citations, feedback, smooth typed animation independent of token cadence.
- [ ] Empty/error/offline/no-credit/rate-limited states; message draft preserved on app background, reload, token expiry or network handover.
- [ ] Accessibility: logical reading order, non-jarring announcements for streamed text, reduce-motion and keyboard/screen-reader support.

### F02-03 — Gateway live integration and intelligence routing

- [ ] Replace mock behind existing `GatewayClient` in nonproduction; backend-only Secrets Manager key; unique staging/prod projects/keys.
- [ ] Live catalog lookup, pinned approved IDs, versioned model capability matrix (tool use, JSON schema, context, price, vision/audio, residency policy).
- [ ] Benchmark economy/balanced/reasoning on KAREN eval set; select measured routes; route deterministic requests to `NO_MODEL`.
- [ ] Structured Pydantic intent/slots/answer payloads; strict schema/field validation, repair only in bounded safe cases, user-facing uncertainty.
- [ ] Model call metadata: requested/served model, provider, gateway request ID, prompt version, token usage/cost, latency, fallback and error class.
- [ ] Per-user/per-plan monthly and daily limits; shared Redis atomic budget; per-request caps, concurrency limits, stop conditions, live gateway backstop budget and alerts.
- [ ] Test gateway errors: auth, 429, unavailable, malformed tool response, timeout, dropped stream, depleted credits, no compatible fallback.
- [ ] Fallback only when comparable tool/schema/data handling is verified; never retry side-effecting tool actions via model fallback.
- [ ] Prompt injection and malicious model output handling: typed tool registry; no raw HTTP/shell/network tool exposed to the LLM.

### F02-04 — Conversation understanding and trust

- [ ] Hindi/Hinglish/English intent handling, script variation, Indian places, time zones, amounts (₹), Indian number terms (lakh/crore), names and transliterated search.
- [ ] Detect ambiguity in travel dates, recipient, currency, city, age and amount; ask before a consequential action.
- [ ] Sources: link and timestamp for externally verified factual answers; abstain/qualify on stale or missing facts; no fabricated citations.
- [ ] Distinguish advice, verified search result, proposed action, execution-in-progress and verified completion in copy and UI.
- [ ] Low-stakes quick replies, safe drafts/rewrite/translate, summaries, checklists, simple planning, calculations with deterministic tools when appropriate.
- [ ] User-rated thumbs/up/down plus issue categories (wrong fact, too slow, language, unsafe action); privacy-aware eval sampling.
- [ ] Conversation settings: ephemeral/no-memory mode and deletion controls with clear behavior, not false guarantees that server never processes text.

**Performance objectives (engineering hypotheses, validate on real networks):** simple API p95 < 250 ms in region; warm fast-path chat TTFT p50 < 0.8 s and p95 < 2 s when supported by selected models; logged p50/p95/p99 and cost per completed request. Track mobile E2E separately; never promise provider-independent latency.  
**Gate 02:** real paid gateway serves tested prompts, streaming recovers safely, no secrets leak, Hindi/Hinglish slot evals pass threshold selected from baseline, budget refusal and failover tested, no unauthorized tool execution.

---

## PHASE 03 — Personal memory and intelligent continuity

**User journey:** say a preference → KAREN asks/records permission as needed → relevant later answer uses the preference with provenance → user can view, correct, forget and isolate it.  
**Tech:** PostgreSQL facts and history, pgvector + pg_trgm/FTS, Python embeddings via a **verified gateway-supported** embedding endpoint, rank fusion, Redis memoization only for permitted content, Temporal asynchronous extraction, KMS.  
**Tables:** `memory.facts`, `memory.preferences`, `memory.suggestions`, `memory.episodes`, `memory.embeddings`, `memory.conflicts`, `memory.deletion_jobs`, `memory.access_events`.

### F03-01 — Memory taxonomy and lifecycle

- [ ] Separate _verified profile fact_, _user-stated preference_, _agent-suggested preference_, _episodic event_ and _document semantic fragment_.
- [ ] Each memory field: owner/subject, type, normalized value, original statement reference, source, confidence, created/updated time, TTL/expiry, sensitivity and consent purpose.
- [ ] Extraction from an explicitly memory-enabled conversation: candidate queue → Pydantic extraction → dedupe/conflict check → policy/consent → confirm or store as user-stated per UI choice.
- [ ] Do not silently store highly sensitive inferences, secrets, financial credentials, health conditions or family facts; reject or require special explicit flow.
- [ ] Memory editing: list, search, pin, correct, unpin, disable, delete one, delete by category, clear all eligible memories.
- [ ] Provenance displayed: “saved because you told KAREN on [date]” or “inferred—needs confirmation”; corrected history preserved only as allowed.
- [ ] Differentiate short-lived task context vs durable memory; one-off travel request not a permanent home-city change.
- [ ] Resolve contradictory claims with timestamp, source confidence, confirmation, and time scope; never override explicit correction based on embeddings alone.

### F03-02 — Retrieval quality and controls

- [ ] Apply owner/user/household scope filters **before** lexical/vector retrieval; guard SQL-level RLS; no shared index query that leaks candidates.
- [ ] Use Postgres full-text + vector similarity and rank fusion; optional reranking only after benchmark and context policy check.
- [ ] Chunk summaries with embedding model ID/version; support recomputation when model dimensions change; no fabricated “same embedding” cross-model comparability.
- [ ] Context assembly has token budget, freshness score, contradiction warnings and minimal relevant facts only; protect against memory-based prompt injection.
- [ ] Retrieve with explicit audit metadata: selected IDs, matching confidence, inclusion reason and source date; keep raw content out of general logs.
- [ ] Evaluate `recall@k`, wrong-person recall, false-memory persistence, deletion propagation, latency and token savings.
- [ ] Deletion fans out to vector row, caches, derived summaries and pending extraction; handle backups under documented retention policy.

### F03-03 — Personal intelligence features

- [ ] Preference profiles: cuisine, allergies only with appropriate explicit consent, usual city, budget, airlines, seat, waking hours, accessibility needs where given.
- [ ] Interest categories, preferred tone/language, source reliability preference, option ranking weights and explanations.
- [ ] Remember pending obligations from goals/tasks (not from hallucinated promises), previous decisions and cancellation/refund outcomes.
- [ ] “Why did you recommend this?” explains which saved preferences influenced ranking, with ability to adjust them.
- [ ] Private vs shared household memories remain separate even when accounts are family-linked (Phase 12).
- [ ] Export memory in machine-readable schema, with stable IDs and version history as appropriate; respect user deletion even when a model would prefer retention.

**APIs:** `/v1/memory`, `/v1/memory/suggestions`, `/v1/memory/{id}`, `/v1/memory/export`, `/v1/memory/clear`, `/v1/memory/preferences`.  
**Performance:** retrieval p95 < 150 ms for modest user corpus warm path (target); embedding/write async; add Qdrant only when measured recall/filter/latency justifies ops complexity.  
**Gate 03:** zero cross-user recall in adversarial suite; edit/delete reflected in next response; human-reviewed memory extraction set passes quality threshold; no restricted memories written without valid permission.

---

## PHASE 04 — Goals, reminders, Responsibility Engine, approvals and verified tasks

**User journey:** “Remind me,” “help me plan,” or “do this for me” → KAREN creates a durable task, gathers missing fields, shows plan and approval where needed, executes **permitted** steps, displays progress and evidence, then follows up.  
**Tech:** NestJS domain modules, Temporal TypeScript workflows and schedules, transactional Postgres outbox, Redis for ephemeral coordination, SQS/DLQ for async notifications, Zod domain contracts, KMS-signed approval payload, SES/FCM/APNs, provider sandbox first.  
**Tables:** `planning.goals`, `planning.goal_milestones`, `planning.reminders`, `responsibility.tasks`, `responsibility.task_events`, `responsibility.proposals`, `responsibility.approvals`, `responsibility.operation_attempts`, `responsibility.evidence`, `notification.intents`, `notification.deliveries`.

### F04-01 — Canonical task engine

- [ ] Persist canonical status machine currently in `@karen/domain`; use exact approved transitions: `RECEIVED`, `UNDERSTANDING`, `RESEARCHING`, `NEEDS_INFORMATION`, `PROPOSED`, `WAITING_APPROVAL`, `APPROVED`, `EXECUTING`, `AWAITING_PROVIDER`, `VERIFYING`, `COMPLETED_VERIFIED` plus `REJECTED`, `EXPIRED`, `CANCELLING`, `CANCELLED_VERIFIED`, `FAILED_RECOVERABLE`, `RECOVERING`, `ESCALATED`, `CLOSED_UNRESOLVED`.
- [ ] Tasks include owner, creator, intent, normalized input, constraints, provider, source conversation, deadline, retry budget, policy, latest verified status and audit version.
- [ ] `POST /v1/tasks`, `GET /v1/tasks`, `GET /v1/tasks/{id}`, `POST .../cancel`, `GET .../events`, `GET .../evidence` with cursor pagination and stable filtering.
- [ ] States transition only via server-side compare-and-swap/current version; append event and transactional outbox in same DB transaction.
- [ ] Temporal workflow ID deterministically based on task ID; idempotent workflow start; worker restart/replay safe; schema evolution/versioning for long-running workflows.
- [ ] Task list cards: waiting on KAREN, waiting on you, scheduled, running, verified done, needs attention; tasks survive logout and device change.
- [ ] Timeline with timestamps, executor, action summary, evidence, provider status age and next expected check; do not expose internal token/secret details.
- [ ] Use provider capability registry: deny unsupported operations and offer allowed alternative/manual handoff rather than pretending completion.

### F04-02 — Approval and safe action boundaries

- [ ] Proposal DTO: capability, provider, destination/recipient, parameter digest, item/service, amount/currency/max total, constraints, intended side effect, expiry and cancellation consequences.
- [ ] Policy service requires identity, ownership, connection scope, risk band, funding limits, user age/regional rules, provider availability; policy decision audited.
- [ ] Approval UI human-readable, including hidden taxes/fees and uncertainty, irreversible flag and exact provider; reject, edit and approve paths.
- [ ] Approval token/record bound to immutable proposal hash and authenticating user; one-time consumption with optimistic lock; expiry enforced on server.
- [ ] Step-up reauthentication for money, irreversible actions, new beneficiaries, high-risk sends and account-wide deletion.
- [ ] Changed quote, recipient, time, amount, profile, passenger or consent revocation voids old approval and requires reapproval.
- [ ] Simulate duplicate taps, stale mobile approvals, revoked identity, switched account, replayed signed request, provider retries.
- [ ] “Approval granted” vs “operation executed” must be visibly different; never embed an unreviewed side effect inside a general consent checkbox.

### F04-03 — Durable execution, verification and recovery

- [ ] Adapter `capability → validate → quote/preview → dispatch → status/readback → reconcile → compensate/cancel` contracts with typed errors.
- [ ] Outbox publisher and webhook inbox with at-least-once delivery handling, signature/replay verification, duplicate event guard and dead-letter recovery.
- [ ] Operation ledger stores merchant/provider idempotency key, request hash, attempt, response reference, expiry and latest authoritative state.
- [ ] On provider timeout, query status/read back **before** retry; unknown state remains unknown and blocks duplicate side effect.
- [ ] Classified retry policy: transient safe failures only, bounded exponential backoff/jitter, circuit breakers, per-provider quotas.
- [ ] Partial completion creates compensation steps and user explanation; support escalation with masked proof and deadline.
- [ ] Provider outcome evidence: signed webhook plus read-back as appropriate, receipt/booking ID, source and timestamp; never label sandbox IDs real.
- [ ] Worker/process killed midway; double webhook; expired approval; task cancellation race; provider 500; network partition; replay test suites.

### F04-04 — Goals and plans

- [ ] Create/edit/archive goals (e.g., plan trip, save for event, renew document, organize appointments) with target date, budget, priorities, constraints, owner and success criteria.
- [ ] AI plan output must be structured: milestones, dependencies, confidence, estimated cost source, actions needing approval, manual steps, acceptance conditions.
- [ ] User can add/remove/reorder milestones, set recurrence, progress notes and reminders; no requirement to let AI control everything.
- [ ] Checkpoints linked to tasks; progress derived from verified evidence, not assistant claims; display blockers and alternative paths.
- [ ] Goal dashboard and weekly review prompts are opt-in; pause/complete/abandon and update timelines with audit.

### F04-05 — Reminders, notifications and notification preferences

- [ ] Natural language to unambiguous datetime with original timezone, normalized UTC, DST policy and recurrence (one-off/daily/weekly/monthly/selected days).
- [ ] Create/edit/snooze/mark-done/delete reminders; original reminder vs occurrence IDs; reschedule recurring series safely.
- [ ] Exact-once _logical_ reminder occurrence through DB uniqueness + Temporal schedules; transport delivery remains at-least-once with dedupe.
- [ ] Notification composer with templates, deep link to correct task, event priority, expiry, quiet hours, language and user-channel preferences.
- [ ] In-app inbox, OS push via FCM/APNs, optional email via SES; token invalidation, receipts and delivery retry queues.
- [ ] Quiet hours, weekend, frequency cap, snooze, do-not-disturb, multiple devices; urgent only for clearly defined user-requested events.
- [ ] Delivery success ≠ user read; separate opened/acknowledged/dismissed status and unsubscribe controls.
- [ ] Permission denied/offline/push token expired/manual changed time/India and overseas TZ tests.

### F04-06 — Initial premium task center, starter admin and entitlements

- [ ] Home: next commitments, active tasks, goals, recent conversations, actionable cards, approvals awaiting confirmation.
- [ ] Tasks detail and approval queue available web/mobile; genuine sandbox demo badges; universal empty/loading/error states.
- [ ] Admin: searchable job status by opaque ID, replay-safe manual reconcile, incident/queue dashboards; no raw sensitive data visible by default.
- [ ] Add `billing.entitlements` and `billing.usage` read APIs now to gate expensive AI features; actual paid subscription purchase may launch in controlled P05/P06 beta.
- [ ] Automated SLO monitors for task attempts with no state update, forgotten reminder, stale approval and DLQ growth.

**Gate 04:** tasks survive 24h+ and worker crashes, approvals never replay or stretch scope, notified reminders have evidence trail, simulated operation retries produce zero duplicate charges/bookings, ambiguous provider status never becomes verified completed.

---

## PHASE 05 — Connected productivity: OAuth connections, calendar, email and contacts

**User journey:** connect a service with least-privilege permissions → KAREN reads relevant permitted information → suggests a draft or action → user reviews → KAREN executes and verifies outcome → user can revoke at any time.  
**Tech:** OAuth 2.0 authorization code + PKCE, Google Calendar/Gmail/People APIs, Microsoft Graph, NestJS connection broker, Secrets Manager/KMS encrypted refresh-token vault, Temporal workflows, provider worker + webhook/poll fallback, Python gateway for summaries and extraction.  
**External gate:** Production Google Gmail **restricted scopes** may require OAuth verification and security assessment; Microsoft/organizational access may require tenant admin consent. Do not imply a real account connection is available until scope approval and provider tests pass.

### F05-01 — Universal connection manager

- [ ] Settings “Connected apps” cards: provider, actions supported, exact scopes, consent purposes, connected account identity, last sync, token status, reconnect/disconnect.
- [ ] Provider-specific `GET /v1/integrations/providers` from capability registry; feature flags and region filters prevent showing unsupported actions.
- [ ] OAuth start/callback with state, PKCE, nonce where relevant, short-lived state storage, code exchange on backend, exact redirect allowlists.
- [ ] Encrypt refresh/access tokens with envelope encryption (KMS), key rotation, owner-scoped lookup and audit; token never shipped to AI prompt/browser/mobile.
- [ ] Consent receipt tied to OAuth scopes and business capability; periodic validation of provider permissions, token refresh, expiry and removal.
- [ ] Graceful reauth for revoked/expired scopes or provider permission policy changes; in-flight tasks pause and request user approval if needed.
- [ ] Provider rate limits, per-account lock, pagination/cursors, delta sync/webhook subscription lifecycle and backfill limits.
- [ ] Sync errors, conflicting account links, provider 429, provider 5xx, no network, partial access, tenant restrictions and disconnection E2E.

### F05-02 — Calendar assistance

- [ ] Google Calendar and Microsoft Outlook Calendar: list calendars, owner, timezone, color and `read` capability (where scope allows).
- [ ] Daily agenda/weekly overview, next meeting, free/busy, conflict detection, preparation reminders and travel buffer suggestions.
- [ ] Calendar search by participant/title/date, exclude irrelevant calendars, preserve private-event visibility settings.
- [ ] Time parsing: `tomorrow at 5`, `next Friday`, `IST`, `PST`, timezone conversions, DST overlap/gap, all-day vs timed events.
- [ ] Event draft: title, start/end with timezone, description, meeting mode, location, attendee list, recurrence and reminders; display full preview.
- [ ] Create/modify/cancel invited events ONLY after explicit transaction-specific approval; enforce ownership and provider-level capability.
- [ ] Detect existing duplicates; use external event IDs and ETags for optimistic update; stale update requires reload/reapproval.
- [ ] Confirm server-side by reading back created/updated event; store calendar ID/event ID and link; distinguish queued/invited/accepted.
- [ ] Meeting summaries and scheduling suggestions are drafting assistance; do not imply attendance/consent for other participants.
- [ ] Controlled fallback: open official calendar composer with data prefilled if write API unavailable; show “needs your action,” not “created.”

### F05-03 — Email intelligence and action

- [ ] Connect Gmail/Outlook scopes separately for metadata/read/draft/send; show exact reach and why each scope is needed.
- [ ] Inbox overview: unread summaries, priority threads, date/sender filters, travel/reservation/bill extraction, deduplication.
- [ ] Search emails with user intent; source links/thread references; extraction done on minimum necessary messages only.
- [ ] Draft replies with recipient and CC/BCC, subject, references, quoted context, attachment indications and tone; view/edit final content.
- [ ] Create provider draft (if scope allows), return draft link and verify it exists; never conflate provider draft with sent email.
- [ ] **Send** requires explicit final preview/approval for exact recipient(s), subject, body digest, attachments and sending account.
- [ ] Check recipients against current verified contact and warning for unrecognized/external recipients; detect highly sensitive content and excessive bulk sending.
- [ ] Dispatch with idempotency and provider message reference; query sent status when uncertain; prevent double sending on timeout or model retry.
- [ ] Email attachments: process only selected user-authorized files, content-size/virus caps, scanning and restricted retention.
- [ ] Categorize action items and suggested follow-ups into _proposals_; never auto-file, auto-reply, delete or unsubscribe without distinct approval.
- [ ] If Gmail verification is pending, present email features as **limited / waitlisted**; permit user copy-to-email handoff instead of circumventing scopes.

### F05-04 — Contacts and relationship context

- [ ] Device contacts: just-in-time native permission; do not upload entire address book by default; user selects individual contact or explicit sync scope.
- [ ] Google People / Microsoft Graph: read-only contact sync with last-sync, encryption and consent, where approved.
- [ ] Entity matching for names/nicknames and similar names; recipient phone/email ambiguity confirmation for consequential actions.
- [ ] View/import/export selected contacts, dedupe with local references, reconnection and contact-deleted propagation.
- [ ] Birthday/anniversary reminders only with permission, no automatic messages or purchases; never expose private contact data in unrelated memories.

### F05-05 — Productivity workflows and notifications

- [ ] “Prepare me for tomorrow”: calendar agenda + authorized reminders + actionable email only if permission allows.
- [ ] “Turn this email into a task”: extract sender/deadline with source and human confirmation; link to Responsibility Engine.
- [ ] Meeting preparation brief from selected accessible threads/calendar; show sources and sensitivity labels.
- [ ] “Follow up next week”: schedule reminder, optionally draft message; send still requires later user approval.
- [ ] Multiple Google/Microsoft accounts with explicit active account selection and owner-bound data isolation.
- [ ] Proactive sync disabled by default; user chooses interval/quiet hours; partner rate limits and sync expiry monitored.

### F05-06 — First paid beta entitlements (parallel workstream)

- [ ] Define free trial, premium and usage-limited plans without inventing unlimited inference: requests, token-equivalent budget, voice minutes, active watches, saved memory and provider quotas.
- [ ] Build entitlement decision API that works server-side and gates features even if frontend is tampered with.
- [ ] In-app purchases for consumer digital KAREN subscriptions via Apple StoreKit / Google Play Billing (using policy-compliant SDK), purchase validation and server notifications; use a billing orchestration service (e.g., RevenueCat) **if it reduces integration/reconciliation work and passes cost review**.
- [ ] Web billing through approved PSP (e.g., Stripe/Razorpay depending entity/market eligibility), signed webhook, server-to-server confirmation and entitlement ledger.
- [ ] Handle purchase pending/failed/renewed/refunded/chargeback, restore purchases, billing grace, cancellation, upgrade/downgrade and family plan only after household policy exists.
- [ ] Transparent spend and quotas: user dashboard, error when exhausted, invoice/receipt availability and tax compliance by market (GST where applicable).
- [ ] App-store compliance: no misleading external-payment steering for digital goods; verify current platform policy before shipping purchase screens.

**APIs:** `/v1/connections`, `/v1/connections/{provider}/start`, `/v1/connections/callback`, `/v1/connections/{id}/revoke`, `/v1/calendar/*`, `/v1/email/*`, `/v1/contacts/*`, `/v1/billing/entitlements`, `/v1/billing/purchases`.  
**Gate 05:** least-scope OAuth passes provider review, access revocation takes effect, one calendar event is created/confirmed in a test account, email draft/send cannot occur without exact approval, missing restricted-scope access is explicitly blocked; paid beta purchase and restore sandbox verified before enabling billing.

---

## PHASE 06 — Natural, fast, multilingual voice companion

**User journey:** tap/hold to talk → speak English/Hindi/Hinglish → see live transcript → interrupt KAREN when needed → hear response → confirm sensitive slots on device → see same task/conversation after call.  
**Tech:** existing `voice-agent`, LiveKit Agents + WebRTC, Expo native audio SDK and audio focus, Gateway-validated realtime path **or** STT → Vercel AI Gateway LLM → TTS, turn detector/VAD, noise suppression, Opus codec, short-lived room tokens, Redis session state, Postgres transcript store only with consent.  
**External gate:** Validate _specific_ LiveKit ↔ Vercel Gateway realtime/SDK/API compatibility. A text OpenAI-compatible base URL is insufficient proof. Direct speech API is approved only with ADR, privacy/billing disclosure and benchmark.

### F06-01 — Voice UX and permissions

- [ ] Mic permission request on first voice use; clear failure and settings deep-link; never record silently.
- [ ] Start/end voice, mute/unmute, speaker/earpiece/Bluetooth switching, waveform/speaking indicator, listening state, audio playback control.
- [ ] Live caption panel with editable transcription, speaker attribution when supported, partial/final state and clear user correction.
- [ ] Push-to-talk and hands-free conversation modes where feasible; background audio only after OS policy review and disclosure.
- [ ] Barge-in / interrupt TTS, gracefully handle false interruptions, rapid turn changes, silence and long utterances.
- [ ] Audio focus with calls/music/notifications, headset disconnect, device orientation, screen lock and app background behavior.
- [ ] Low network/offline UI, reconnect, session resume/expiry; user-visible handling when call ends unexpectedly.
- [ ] Transcript/save/export/delete settings, audio retention opt-in separate from transcript storage; clear ephemeral mode.

### F06-02 — Low-latency session architecture

- [ ] Backend issues short-lived LiveKit room grants scoped to user/session; deny arbitrary room access; room close/revoke and participant authentication.
- [ ] Voice worker shares the same identity, memory-permission, task/approval APIs as text chat; no bypass through tool calls.
- [ ] Benchmark realtime gateway-compatible model vs composable STT/LLM/TTS by total turn latency, price, cancellation and slot accuracy.
- [ ] Adaptive VAD/turn-end/interrupt configuration with Indian-language evaluation; noise cancellation and echo suppression.
- [ ] Streaming partial transcript and partial response; avoid waiting for whole LLM output before TTS where quality/contract permits.
- [ ] Handle quota exhaustion, gateway outage, LiveKit worker crash, partial audio and STT confidence failures with readable fallback to text.
- [ ] Enforce per-session minutes, concurrency, max turn length and server budget; propagate cancellation to upstream work where supported.
- [ ] Per-stage metrics: end-of-user-turn → first model token → first audio byte → playback; p50/p95/p99 by device/network/language.

### F06-03 — Language and action accuracy

- [ ] English, Hindi, Hinglish code-switching, Indian cities and pronunciation dictionary for suppliers/stations/airports.
- [ ] Spoken INR/amount and quantity normalization, e.g., “pandrah sau” vs “pandrah hazaar”; compare against transcript and slot confidence.
- [ ] Dates, relatives, names, beneficiaries, pickup addresses and travel direction confirmation; show exact interpreted values.
- [ ] Pronouns/references from previous turn retained within scoped conversation; ask again if ambiguity remains.
- [ ] Voice-initiated email/send/purchase/booking launches mobile/web approval screen. Voice-only verbal “yes” is **not** sufficient for sensitive operations unless a separately reviewed strong-auth mechanism exists.
- [ ] Multilingual intent eval dataset: accents, noisy traffic, low-end Android, slow cellular, rural/regional lexical variation and elderly speakers.
- [ ] Preserve assistant persona/tone and responses across text/voice; no unsupported claim of human identity or emotional sentience.

### F06-04 — Voice enhancements (controlled expansion)

- [ ] Natural conversational greetings, empathetic but non-manipulative tone, user-configurable voice/speed and playback rate.
- [ ] Turn-taking under interruptions, user corrections, follow-on questions and mid-sentence cancellation.
- [ ] Optional native playback of notifications and task updates; avoid sensitive announcements on locked/public devices.
- [ ] Optional voice notes converted to draft tasks and goal checkpoints, with transcript review and retention controls.
- [ ] Wake word / fully always-on listening only after privacy, OS background policy, battery and abuse review; **not** a Phase 06 prerequisite.

**Performance:** aspirational first audible response p50 around 1 s after end-of-turn on warm favorable networks, subject to live measurements; speech **slot exact-match** for money/date/recipient is a safety gate.  
**Gate 06:** real LiveKit session passes device matrix and interruption tests; essential slots confirmed before sensitive action; transcript and audio opt-out honored; session credentials/voice token not exposed.

---

## PHASE 07 — Proactive intelligence, routines, patterns and daily life operations

**User journey:** explicitly opt in → choose topics/times → KAREN notices an authorized pattern, states why it matters and suggests a helpful step → user accepts/ignores/snoozes → supported automation runs within approved limits → user can stop it.  
**Tech:** transactional outbox, Temporal schedules, deterministic rules, optional LangGraph planner for complex planning, Redis dedupe, Postgres pattern/rule history, gateway economy tier for limited summarization/ranking, push/email/WhatsApp approved notification channels.  
**Tables:** `planning.automations`, `planning.automation_runs`, `planning.pattern_candidates`, `planning.schedules`, `notification.preferences`, `notification.delivery_metrics`, `responsibility.proactive_proposals`.

### F07-01 — Proactivity controls and trust

- [ ] Separate opt-ins by category: calendar preparation, commute, renewals, travel price, important email, budget watch, birthdays, subscriptions.
- [ ] Show examples and exact data required before enabling; each rule has source, purpose, frequency, threshold, quiet hours, expiration and stop button.
- [ ] Proactive suggestions always say “why you’re seeing this”; distinguish verified source from inferred pattern.
- [ ] Notification frequency caps, per-category mute, quiet time, timezone, holiday/weekend behavior and escalating only for user-defined urgency.
- [ ] Feedback: helpful, irrelevant, not now, never again; prevent re-notifying unchanged data.
- [ ] The user can pause all proactivity, stop a rule, disconnect source or delete inferred pattern.

### F07-02 — Intelligent pattern and routine recognition

- [ ] Detect recurring tasks from verified reminders and user-approved signals, propose—not silently activate—recurrences.
- [ ] Repeated travel routes, meeting timing, shopping replenishment, bill dates and periodic renewals: only if event data available under valid consent.
- [ ] Confidence + evidence + source freshness for each pattern; differentiate one-off coincidence from regular habit.
- [ ] Pattern privacy review for inferred health, religion, politics or sensitive personal attributes; don't automatically build these profiles.
- [ ] Daily briefing / evening recap / weekly review with user-preferred format, sources, priority and quiet hours.
- [ ] “I noticed you often…” only when factual evidence supports it; a single repeated suggestion never becomes an automatic action.

### F07-03 — Recurring jobs and watches

- [ ] User-defined recurring check: name, condition, threshold, interval/window, end date, backoff, cap on API/provider cost.
- [ ] Email/calendar daily watch for deadlines with sync checkpoints; reminders for renewal, insurance/document expiry or unpaid tasks only from verified inputs.
- [ ] Price or availability watches only on authorized fresh feeds with allowed polling cadence and clear data timestamp.
- [ ] Retry after provider outage; missed-schedule catch-up policy; scheduled task dedupe; no accidental notification storm after worker recovery.
- [ ] Condition engine deterministic comparisons: `price <= target`, status changed, deadline approaching; LLM used only for interpretation/ranking when necessary.
- [ ] User sees last checked, next check, source, confidence, status; one-tap pause/resume/delete.
- [ ] Alert condition includes material changes, route/variant/product matching and currency/tax comparability.

### F07-04 — Life administration modules

- [ ] Renewals cabinet: document type, expiry, checklist, reminder, optional encrypted attachment; never claim renewal completed without authority.
- [ ] Bills/subscription reminder inventory from manual entry or authorized email extraction; duplicate and amount verification.
- [ ] Travel plan preparation: passport/visa reminders as **advice**, not eligibility guarantees; check public authoritative sources and policy freshness.
- [ ] Follow-up ledger: promises made by KAREN, deadlines, pending external responses, escalation cadence and linked evidence.
- [ ] Household chore plans and celebrations/gifts suggestions; actual purchases only after later commerce capability/approval.
- [ ] Auto-snooze/reschedule suggestions based on calendar conflicts; do not modify event/reminder without permitted action.

### F07-05 — WhatsApp/communications pilot (conditional)

- [ ] WhatsApp Business Platform account, verified business status, approved message templates where required, compliant opt-in and opt-out.
- [ ] Pair WhatsApp identity securely to KAREN account; do not bind solely by easily spoofed inbound display name.
- [ ] Webhook verification/replay protection, conversation windows, rate limits and channel-specific privacy disclosure.
- [ ] Safe chat/reminder summaries and task links; sensitive approval redirects to authenticated app; no high-risk transaction approval through unauthenticated chat.
- [ ] Delivery status, template rejection handling, phone change and block/unsubscribe handling.

**Gate 07:** proactive rules cannot trigger without explicit consent; duplicate alert and quiet-hour tests pass; every watch shows source and last verified check; unauthorized provider access is mechanically blocked.

---

## PHASE 08 — Multimodal documents, research, location, evidence and discovery

**User journey:** share a screenshot/document/receipt or ask to compare choices → KAREN extracts verified fields, sources fresh external data where available, compares relevant alternatives and offers a transparent shortlist or actionable next step.  
**Tech:** private S3 + presigned URLs, AV scanning, verified Vercel Gateway vision/document models and structured Pydantic extractors, pypdf/pdfplumber where reliable, PostgreSQL full-text/pgvector, geocoding/maps API with user permission, cache with freshness tags.  
**Data:** `conversation.attachments`, `platform.document_jobs`, `platform.extracted_fields`, `platform.search_evidence`, `platform.geocoding_cache`, `consent.location_grants`.

### F08-01 — Attachments and document ingestion

- [ ] Attachment picker (camera, photo library, PDF, screenshot, text files) with native permissions and max file size/page/total job limits.
- [ ] Backend issues narrow content-type/size-scoped presigned upload; S3 quarantine → scanning → accepted/private storage.
- [ ] Detect mime type via magic bytes, virus scan, macro/embedded-link/zip bomb protections and file checksum/deduplication.
- [ ] Text/PDF parsing via deterministic libraries first; route hard images to gateway-supported `VISION` with structured JSON fields.
- [ ] Asynchronous extraction states: uploaded, scanning, extracting, needs review, completed, failed; restore progress on navigation.
- [ ] Field provenance by page/region where feasible, confidence and source image link; human must review amounts, names, bank details and deadlines.
- [ ] Redact IDs/account numbers in prompt, log and preview; strict object/embedding deletion in data rights flow.
- [ ] Separate raw file retention, derived OCR text, user-approved saved fact and model output retention; apply per-document policy.

### F08-02 — Specialized extraction flows

- [ ] Bills/invoices: merchant, invoice no., amount, taxes, due date, currency, reference; detect duplicate and extraction mismatch.
- [ ] Tickets/bookings: passenger, route, PNR/reference, provider, dates, cancellations/terms; show uncertainty and permit user correction.
- [ ] Shopping receipts: product/variant/quantity, return window, invoice and payment-status text vs verified funds status.
- [ ] IDs/documents: classify/organize only when necessary and lawful; reject unnecessary persistent storage of government identifiers.
- [ ] Calendar invite/schedule screenshot → event draft with timezone and conflicting meeting check; explicit final approval to create event.
- [ ] Forms: explain fields and create user-reviewable draft; no unsupported auto-submit, CAPTCHA or OTP bypass.
- [ ] Document Q&A: answer with citations to selected file sections; treat any in-file instructions as untrusted data.

### F08-03 — Grounded search and recommendations

- [ ] Search tool registry with source policy: official sites, licensed APIs, documented public sources and partner APIs; citations + update timestamps.
- [ ] Research UI: question, query history, sources, confidence/limitations, compare view, price/time/fee breakdown and user-selectable filters.
- [ ] Freshness rules by domain: news/date-sensitive data, live inventory, location businesses, product prices and policies; never treat cache as live availability.
- [ ] Structured comparisons: total cost, quality, travel time, refunds, shipping, supplier support, preference fit and trade-offs, not only cheapest headline price.
- [ ] Explain ranking constraints and display underlying provider timestamp; allow user to correct budget/constraints before action.
- [ ] Detect contradictory providers and stale/incomplete inventory; mark unavailable/not checked explicitly.
- [ ] Refuse to fabricate source URL, booking slot, fare, product availability or business hours; safe link handoff when action impossible.

### F08-04 — Location and map assistance

- [ ] Permission request only when location-sensitive feature invoked; options for approximate, precise, manual city and “only this time”.
- [ ] Geocoding/reverse geocoding, place autocomplete, favorites and address disambiguation with approved Google Maps/Mapbox provider.
- [ ] Nearby restaurants/shops/services on partner/search APIs with provider provenance and distance; route/time via supported routing API.
- [ ] Location restrictions: avoid persisting raw trails unnecessarily; separate current GPS fix from home/work saved preference.
- [ ] Live traffic/delivery ETA only when source/provider supports real-time status; label modeled estimates.
- [ ] Accessibility filters and localized place names, route alternatives and linked results.

### F08-05 — Product and decision intelligence

- [ ] “Find best phone/laptop/gift” with hard constraints, model/variant matching, compatibility, price source and clear affiliate disclosure if relevant.
- [ ] Watch list: items/route offers, source links, allowed cadence, target, tax/shipping comparison and last refreshed date.
- [ ] Travel option shortlist with map/route and estimated total budget without claiming held reservation.
- [ ] Local appointment/provider search with licenses/accreditations/reviews only where reliable source supports them.
- [ ] Uncertain recommendation outcomes shown as trade-offs; allow user to ask rationale and refine criteria.

**Gate 08:** malformed/prompt-injected document cannot call tools; extracted critical fields require user correction path; source freshness visible; no accidental sharing of private files or precise location.

---

## PHASE 09 — Universal transaction kernel and FIRST real contracted vertical

**User journey:** ask for an outcome → get live provider choices → select → recheck availability/price → approve exact offer → complete mandated provider/PSP authentication → wait through asynchronous status → verify final outcome → track change/refund.  
**Tech:** provider-worker adapters, Temporal saga/workflow, Postgres operation ledger/outbox, signed webhooks, KMS, SQS/DLQ, scoped OAuth/provider credentials, PSP/UPI redirect where authorized, audit and reconciliation jobs; data model reusable across travel/commerce/services.  
**Critical external condition:** choose **ONE** partner with actual legal API rights and sandbox + production path. Prioritize reliability of a single end-to-end vertical over fake “all-in-one bookings.”

### F09-01 — Provider onboarding and contractual capability model

- [ ] Record for each partner: geography, allowed functionality, rate limit, commercial agreement, settlement owner, personal-data sharing, liability, cancellation/refunds, API test/prod scopes and contact.
- [ ] Provider certification checks: sandbox account, callbacks, idempotency semantics, status lookup, quote TTL, production quota, error taxonomy and SLA.
- [ ] Capability table: search, quote, hold, checkout, pay, cancel, refund, webhook, reconcile, deep-link-only, unavailable; flags independent per action.
- [ ] Define user data passed to supplier by purpose and retention; no blanket sharing of contact/passenger/payment data to all vendors.
- [ ] Create provider contract fixtures and synthetic webhook replay library with business state assertions.

### F09-02 — Quote, offer and checkout primitives

- [ ] Canonical offer fields: vendor/offer ID, product or booking item, variant, locality/currency, base price, taxes, convenience fee, delivery/processing charge, total, availability timestamp, expiry and cancellation policy.
- [ ] Quote normalization never hides partner disclaimer or policy conditions; known and unknown fees marked distinctly.
- [ ] Reprice/revalidate immediately before action approval and before dispatch where provider supports it; expiry invalidates stale approval.
- [ ] Save selected quote snapshot with cryptographic digest, source, expiry, provider reference and version, bound to consent/approval.
- [ ] Split user-facing status: `SEARCHED`, `QUOTED`, `AWAITING_APPROVAL`, `AUTHORIZED`, `SUBMITTED`, `PENDING_PROVIDER`, `VERIFIED`, `UNKNOWN`, `CANCEL_PENDING`, `REFUNDED_VERIFIED` mapped into canonical task states.
- [ ] Provider handoff vs API checkout clearly different; completing external website manually is not KAREN-completed booking unless a trusted callback confirms it.

### F09-03 — Payment authorization, accounting and transaction safety

- [ ] PSP contracts distinguish KAREN subscription charges, marketplace/merchant-of-record payments, partner direct payments and user-mediated UPI intents.
- [ ] Never accept or store UPI PIN, CVV, banking OTP or password. PSP-hosted UI / native UPI app handles sensitive authentication.
- [ ] Payment intent/merchant reference unique and idempotent; webhook raw-body signature, timestamp and replay validation; compare final amount and currency.
- [ ] Provider redirect “success” is not settlement; independently poll PSP/provider status and reconcile on ambiguous timeout.
- [ ] Handle authorized/captured/failed/expired/partial/refund-pending/refund-completed/chargeback; maintain separate business and money states.
- [ ] Error/compensation handling for payment captured but booking failed, booking held but payment timed out, provider callback delayed, double response and transaction expiration.
- [ ] Daily reconciliation: local ledger vs PSP settlement and partner status, alarms on mismatches, support ticket and no blind duplicate retry.
- [ ] Payment dispute/refund workflow with receipt, amount, date and partner reference; KAREN is not a bank and cannot guarantee refund settlement speed.

### F09-04 — Booking outcome and follow-through

- [ ] Show exact live provider quote, restrictions, total, estimated processing and expiry before approval.
- [ ] Allow cancellation prior to provider dispatch when safe; after dispatch, apply provider-specific cancel/refund rules and show costs.
- [ ] Post-submit temporal workflow waits for callback or scheduled lookup; state and deadlines durable across restart.
- [ ] Verify booking/receipt/reference by authoritative partner response; independent status check on crucial/financial outcomes.
- [ ] Confirmation card with masked personal details, provider ID, order details, receipt/evidence, policy, support route and progress timeline.
- [ ] Track changes, cancellations, refund requested/accepted/settled distinctly; notify about significant verified changes.
- [ ] Human support queue for `UNKNOWN`, duplicate-payment suspicion, mismatch, provider outage, dispute; include redacted evidence and clear next step.

### F09-05 — First partner launch and chaos certification

- [ ] Select based on feasibility and high completion rate (e.g., authorized appointment scheduling or contracted commerce supplier—not necessarily flights).
- [ ] Complete full **sandbox** flow: quote, reprice, approval, provider submission, callback, read-back, cancellation/refund simulation.
- [ ] Run faults: callback before API response, duplicate callbacks, network timeout after successful booking, wrong amount, expired quote, owner changes, concurrent approval, rate limiting, PSP mismatch.
- [ ] Beta feature flag/cohort, support escalation, daily reconciliation report, controlled real-money canary only after commercial/legal approval.
- [ ] Instrument exact successful completion, unauthorized-action count, duplicate side effect count, unverified task backlog, refund/cancel resolution and cost per completed transaction.

**Gate 09:** contracted supplier access is active; pilot has real provider references and reconciliation; “verified completed” is proved by supplier state; no side effects without exact approval; risky failure states remain unresolved and visible until reconciled.

---

## PHASE 10 — Travel and mobility: flights, hotels, trains, buses, rides

**User journey:** “Plan and book a trip to Goa with these preferences” → research itinerary → compare live options → approve **each payable/irreversible transaction** → confirm supplier outcomes → manage trip changes, reminders and refunds.  
**Tech:** shared Phase 09 transaction kernel, Temporal workflows, authorized GDS/OTA APIs and supplier contracts, maps routing API, weather/schedule sources where permitted, notification engine, private encrypted document vault, verified currency/tax conversions.  
**External condition:** each subvertical may be `READ_ONLY`, `DEEPLINK`, `TRANSACT_SANDBOX`, `TRANSACT_PRODUCTION` or `UNAVAILABLE`. Never infer universal provider API access.

### F10-01 — Unified travel planning and trip workspace

- [ ] Trip record: destination(s), origin(s), dates, traveler IDs (internal), budget, timezone, preferences, transport legs, stays, commitments, notes and saved source links.
- [ ] Clarify one-way/return/multicity, date flexibility, number/age of travelers, bags, rooms, accessibility and payment currency.
- [ ] Research destination choices and seasonality from current sources; show “estimated” vs “verified live” separately.
- [ ] Combine multi-leg transport + lodging + local commute into itinerary, map, time buffers, total estimated landed cost and cancellation exposure.
- [ ] User can compare, modify and save planning scenarios; rank by total cost, transfer risk, timing, baggage, policy and preferences.
- [ ] Attach supplier confirmations to each leg, not to trip as a whole; track which legs booked, pending or only suggested.
- [ ] Checklist: travel documents, hotel check-in policy, local transport, calendar entries, reminders, insurance research and emergency contacts (opt-in).
- [ ] Trip share/export with explicit scope; personal identification/passenger details never auto-share with companions.

### F10-02 — Flights (contractual API required)

- [ ] Identify viable authorized supply (e.g., Duffel, Amadeus or airline direct via real contract); validate geography, inventory, ticketing authority and settlement.
- [ ] Search: IATA origin/destination lookup, dates, cabin, passenger age, stop count, fare class, bags, airline exclusions, nearby airports, flexible dates if API supports.
- [ ] Results: total payable fare with taxes, baggage/seat/change fees, connection time, terminals, overnight/visa self-transfer warnings and refundability.
- [ ] Clarify traveler legal names, DOB and document fields only when necessary and secure; verify user review, supplier validation and retention policy.
- [ ] Revalidate fare and seat inventory before checkout, show final time-limited quote, brand/cabin restrictions and cancellation terms.
- [ ] Provider booking/hold/ticket workflow with correct payment flow, ticket issuance and PNR/e-ticket number **verified** from authorized provider.
- [ ] Partial ticketing/booking timeout/price changed/passenger correction handling and manual escalation; never re-book blindly.
- [ ] Flight status, gate/schedule change alerts only from authoritative feed; avoid declaring status live when source delayed.
- [ ] Change/cancellation/refund workflow with fees, airline vs agency authority and final settlement reconciliation.

### F10-03 — Hotels and accommodation (contractual API required)

- [ ] Search by city/area/map radius, dates, rooms/occupancy/children, property amenities and accessibility features where source provides.
- [ ] Compare total taxes, resort/service fees, meal/board basis, deposit, refundable deadlines, breakfast, check-in rules and safety constraints.
- [ ] Distinguish property review content/source date; avoid unsupported safety or star claims.
- [ ] Check room/rate inventory, repricing, booking expiry, traveler identity requirements and guest policies.
- [ ] Book only through authorized partner; confirmation number read-back; explain partner vs hotel reference differences.
- [ ] Date modifications, no-show, cancellation window, refunds/penalties and partner outages tracked as separate tasks.
- [ ] Pre-arrival checklists, map directions, arrival/departure calendar events after appropriate permissions.

### F10-04 — Indian trains (IRCTC-authorized route only)

- [ ] Official/authorized partner feasibility and commercial authorization before enabling book or cancellation actions; no browser scraping or anti-bot bypass.
- [ ] Train search, station alias mapping, travel date, class/quota, departure/arrival, travel duration and current authorized seat availability source.
- [ ] Waiting list/RAC/confirmed status distinctions; quota, passenger age/gender/document and tatkal rules where verified.
- [ ] Live fare, taxes/charges, payment and cancellation rules; exact approval; never guarantee waitlist confirmation.
- [ ] Authorized booking PNR, passenger status, supplier confirmation and change/refund workflows if supported.
- [ ] If API access is not granted, provide planning information and lawful handoff to official channel, labelled as unbooked.

### F10-05 — Buses and intercity mobility

- [ ] Evaluate authorized bus provider APIs and regions; otherwise safe official handoff only.
- [ ] Route, stop and pickup location disambiguation, boarding point, seat class/availability, luggage, trip duration and fare/fee breakdown.
- [ ] Seat/offer expiry, user approval, ticket/QR reference verification; monitor cancellation/refund policies.
- [ ] Boarding reminders with map and verified location; avoid speculative real-time tracking.

### F10-06 — Cabs, taxis and last-mile rides

- [ ] Search viable authorized Uber/Ola/Rapido or regional partner API/deep-link capability; API permission explicitly recorded by feature.
- [ ] Pickup/drop-off confirmation from manual address or consented GPS; precise pin, landmark, passenger count and accessibility need.
- [ ] Compare quoted estimates, travel time, surge caveats, car category, airport surcharge, taxes, cancellation fees and ETA timestamp.
- [ ] If native booking API authorized: submit after approval and confirm actual ride ID/driver acceptance. Otherwise deep link and show “complete in provider app.”
- [ ] Ride changes, driver messages, live GPS and safety features ONLY where partner authorized; no unsupported continuous tracking.
- [ ] Delay monitoring and appointment/flight buffer suggestions with time-source labels.

### F10-07 — Travel post-booking concierge

- [ ] Central “My trips” dashboard with itinerary, verified refs, e-tickets, reminders, change requests and travel support tasks.
- [ ] Provider-specific schedule changes → review alternatives/compensation; rebooking always approval-bound.
- [ ] Compare cancellation fees vs future travel value, ask before initiating cancellation; refund follow-through until confirmed settled.
- [ ] Travel receipts and expense export, trip sharing with redaction and explicit consent.
- [ ] Safety/accessibility/localization information from official public sources with dated verification and clear uncertainty.

**Gate 10:** every purchasable travel provider is individually approved and tested; booking references authoritative; no PNR/Ticket claims from mocks; cross-provider itinerary never marks all legs booked if one leg remains pending or manual.

---

## PHASE 11 — Everyday commerce, dining, groceries, shopping and services

**User journey:** “Order my usual groceries,” “find dinner nearby,” “buy these exact headphones,” “book a haircut” → sources + matched options → quote/cart summary → final approval → supported checkout or handoff → delivery/status/refund follow-through.  
**Tech:** Phase 09 transaction kernel, provider-specific product/catalog APIs and authorized ecommerce/food/grocery partnerships, maps/geo, PostgreSQL carts and matching, AI extraction/ranking through Gateway, queues/webhooks, notifications, PSP where agreement permits.  
**Rule:** “I can search/recommend” does not mean “I can order”; each partner and action must pass commercial and legal access gates.

### F11-01 — Universal shopping list and product matching

- [ ] Create/edit/merge shopping lists by household/person; free-text and categorized items, quantity/unit/brand/variant, budget and priority.
- [ ] Match SKU exactly by variant (size/color/capacity/model) and pack count; warn on unit-price, substitution and incompatible specification.
- [ ] Manual barcode/photo/receipt capture only with supported scanners; do not invent item identity when uncertain.
- [ ] User-approved recurring staples and replenishment reminders; never auto-order from inferred need.
- [ ] Out-of-stock substitutes require configured user substitution rule or explicit per-order review.
- [ ] Price comparison accounts for taxes, delivery threshold, membership fees and store availability timestamp.

### F11-02 — Grocery orders and quick commerce

- [ ] Supplier capability discovery for approved grocery/quick-commerce partner APIs; city/pincode/coverage eligibility and API rights.
- [ ] Real-time catalog, per-store/pincode availability, variants, substitutions, delivery estimate, fulfillment constraints and offer expiry.
- [ ] Cart with item details and quantities, fees/taxes, coupons if authorized, saved delivery address and substitutions policy.
- [ ] Approval for exact total/max substitutions, delivery location and slot; required address/phone shared only with merchant.
- [ ] Place order, verify merchant order ID, poll/webhook updates, cancellation/short items/refund and proof of fulfillment if available.
- [ ] If only public website/app exists, provide a draft list or vendor handoff; never claim checkout completed.

### F11-03 — Food delivery

- [ ] Restaurant selection from eligible licensed partner or public search; live menu and order capability only where contract allows.
- [ ] Dietary preference/allergen flags as user-provided information; **never guarantee allergen safety** based on AI guess.
- [ ] Dish options, spice levels, modifiers, portions and item quantity; verify live availability and bill.
- [ ] Delivery address pin, instruction, schedule, contactless choice, coupons/fees, tip and total before approval.
- [ ] Provider-created order ID verified; track accepted/preparing/out-for-delivery/delivered/cancelled states only with appropriate feed.
- [ ] Missing item, wrong order, late delivery, merchant contact, refund request and settlement tracking.

### F11-04 — Restaurant reservations and experiences

- [ ] Search venue/party/date/time, cuisine, budget, neighborhood, dietary suitability and seating preference from authorized availability sources.
- [ ] Display **exact party/date/time** checked, cancellation/deposit terms, verified reservation availability and precise table slot.
- [ ] Reserve via authorized provider with final details and permission; verify booking reference/confirmation.
- [ ] Waitlist/requested/table held/confirmed distinguished; no invented table times or confirmation.
- [ ] If API unavailable, show known official reservation links or manual calling/handoff, not a fabricated reservation.
- [ ] Restaurant discovery can still function as read-only recommendations with source timestamp and map.
- [ ] Events/movie/experience tickets: separate provider availability, seat class, QR, policy, refund and authenticity checks.

### F11-05 — Ecommerce shopping and returns

- [ ] Product search and comparison using legally usable catalog/pricing feeds; affiliate disclosures and source freshness.
- [ ] Variant, model, warranty, seller/shipper, return window, official vs marketplace seller and regional compatibility matching.
- [ ] Basket or saved offers; tax/shipping/coupon/discount total and refund terms; explicit checkout review.
- [ ] Authenticated partner checkout if contracted; otherwise safe deep link to user's own checkout.
- [ ] Track orders, carrier status, invoice, warranty and delivery only from authorized merchant data or user-uploaded evidence.
- [ ] Return/RMA/refund workflow: eligibility, item condition, pickup label, provider accepted vs funds settled and final proof.
- [ ] Price alerts when authorized feed supports comparable item/variant and rate-limited polling.

### F11-06 — Local professionals, home services and appointments

- [ ] Nearby plumber, electrician, cleaner, salon and home-service discovery with geo, sourced reviews, availability and pricing caveats.
- [ ] Provider booking only if contractual API or explicit merchant scheduling mechanism permits.
- [ ] Address sharing scoped to selected service; appointment time verification; provider identity and terms source displayed.
- [ ] Reschedule, cancellation charges, appointment check-in and issue escalation with documented provider status.
- [ ] Do not guarantee professional quality, licensing or safety if no authoritative verification available.

**Gate 11:** item/variant accuracy, final cart price and delivery location verified before approval; fulfillment and refunds tracked from authorized evidence; every unsupported provider operation has honest handoff UX.

---

## PHASE 12 — Family collaboration, finance insights, health appointments and specialized personal workflows

**User journey:** create family workspace or specialized personal workflow → grant narrow scoped sharing → KAREN helps coordinate while maintaining each person's privacy, approval rights and regulatory safeguards.  
**Tech:** ABAC/relationship policy on NestJS, scoped PostgreSQL/RLS records, Temporal delegated tasks, consent engine, encrypt-at-rest/KMS, authorized API integrations only, privacy-preserving analysis with Gateway, audited access logs.  
**Rule:** shared household membership **never** implies permission to read another member's email, memories, payments or medical information.

### F12-01 — Household and family profiles

- [ ] Create household with display name, owner, invitation link with expiry and identity verification; reject duplicate/reused invite tokens.
- [ ] Roles: owner, adult member, invited guest, guardian/dependent only after age/compliance review; permissions server-authorized.
- [ ] Individual private profiles, memories, inboxes and payment approvals remain isolated; explicit `share` grants per goal/reminder/trip/task.
- [ ] Household shared lists, events and chores with item-level ownership, assignee, due date, comments, reminders and revision audit.
- [ ] Invite accept/decline, leave, remove, transfer ownership, revoke share and handle concurrent edits.
- [ ] Family travel coordination: passenger information collected separately, permission to share with supplier, each adult's explicit consent where required.
- [ ] No silent spouse/parent contact syncing, child profiling or inferred relationship claims.
- [ ] Cross-household authorization/RLS and role-change-at-execution tests; dependent controls must meet applicable legal requirements.

### F12-02 — Delegation and shared responsibility

- [ ] “Ask someone else to approve or complete” only if they have separately authenticated access and defined delegation scope.
- [ ] Approval rights bound to subject/transaction and spending limit; assignor cannot silently delegate privileged credentials or payment approval.
- [ ] Task assignment/invitation, accept/reject, deadline, notifications, comment, evidence and escalation to original owner.
- [ ] Delegation expiry, revocation, consent changes and actor audit; not-yet-approved actions invalidated when authority changes.
- [ ] Shared trip/shopping/appointment state shows which account owns provider reservation/payment.

### F12-03 — Personal expense and spending insights (non-regulated initial scope)

- [ ] Manual expense entry and import of user-supplied CSV/PDF statements with explicit consent, AV scan, retention choice and preview.
- [ ] Extract date, merchant, amount, currency, method and category, with user confirmation for uncertain fields and duplicate detection.
- [ ] Categorization rules + model suggestions; monthly budget/category dashboard, subscription/renewal schedule and optional alerts.
- [ ] Household shared budget is a new permissioned record, not a pooling of private card/account statements by default.
- [ ] Authorized Account Aggregator/banking feeds only after legal, license, data processor, partner and security review.
- [ ] Never claim bank balance/transaction completion from guessed email text; clearly distinguish user-provided expense from verified financial account data.
- [ ] Taxes/investments/lending: provide general research or referral only within applicable advice/regulated activity boundaries.

### F12-04 — Health and medical appointment coordination (strict safeguards)

- [ ] Directory of clinics/appointments from reliable/authorized providers; appointment time and price verification where source permits.
- [ ] Patient name/contact and minimal scheduling details with special-purpose consent; encrypted health-related notes and short retention.
- [ ] Appointment draft, booking confirmation, reminders, directions, prep instructions from provider and rescheduling/cancellation follow-up.
- [ ] Upload and organize user-provided lab/report for own understanding, with explicit permission and warnings about model limits.
- [ ] KAREN must not impersonate a doctor, diagnose definitively, prescribe restricted treatment or independently modify health appointments without consent.
- [ ] Emergency/critical symptoms: safe professional/emergency-care guidance; no false implication of emergency dispatch capability.
- [ ] Clinician message/email draft only with final user review and provider-supported delivery; no unauthorized health-record access.

### F12-05 — Documents, warranties, renewals and government services

- [ ] Personal document cabinet for invoice, policy, warranty, ID metadata and renewal dates; store original only with explicit choice.
- [ ] Encrypted classification/search and time-bound sharing links; audit every share/view; auto-expire and revoke access.
- [ ] Insurance policy expiry, claim document checklist and status tracking using user-provided/authorized insurer information; do not claim insurer acceptance without proof.
- [ ] Government service checklist/application draft from official instructions; **no unapproved automation**, CAPTCHA bypass or misleading “submitted” status.
- [ ] DigiLocker or other government document access only with valid official partnership/API scope, consent and permitted use; no assumptions.
- [ ] Claim/case tracking from user-entered reference, approval-bound communications and verified status when partner feed exists.

### F12-06 — Advanced personalization and user choice

- [ ] User-defined decision priorities such as time, cost, convenience, refundability, sustainability and accessibility.
- [ ] Scenario planning (“what if I move the trip a day later?”) with clear impact on live vs estimated items.
- [ ] Cross-domain recommendations only when permissioned sources are current (e.g., meeting end → taxi suggestion, never silent booking).
- [ ] Preference feedback and correction propagates into ranking without overriding individual shared members’ choices.
- [ ] Explain “what KAREN remembered, knew, inferred, could not verify and could not access” on significant recommendations.

**Gate 12:** independent family members cannot inspect one another; delegated approvals obey exact scope; financial/health/vendor integrations pass review before activation; exports/deletions honor shared ownership without violating another person's rights.

---

## PHASE 13 — Premium growth, operating excellence, global readiness and scale

**Objective:** Run KAREN as a sustainable premium global product—fast, trustworthy, accessible, resilient and measurably useful—not simply a feature collection.  
**Tech:** existing AWS/Terraform, GitHub CI, Cloudflare, ECS autoscaling, RDS/RDS Proxy/PgBouncer as measured, Redis, Temporal Cloud/OSS, SQS/EventBridge, OTel, Sentry, Langfuse, privacy-aware PostHog, k6/Locust, OpenFeature and documented experimentation.  
**This phase matures capabilities that began in Phase 00–05; security, analytics and support never wait until Phase 13.**

### F13-01 — Premium experience and accessibility

- [ ] Cohesive deep-space design system across web/mobile/admin: tokens, theme, buttons, inputs, forms, toasts, skeletons, sheets, dialogs, safe-area and dark/light variants.
- [ ] Fast home screen, universal search/command bar, recent tasks, goal progress, in-app notifications, message composer, actionable approval card.
- [ ] Motion quality: reduced-motion support, consistent easing, animations at measured smooth frame rate on midrange Android, no heavy orb animation on low-power mode.
- [ ] Accessible typography, dynamic text sizes, WCAG 2.2 AA-inspired web/mobile audits, contrast, keyboard, screen readers, focus management and error messages.
- [ ] Hindi/English language QA, Indian currency/dates/numbers, later languages from real demand; RTL and global locale planned when applicable.
- [ ] Offline shell and queued **safe drafts**; never present a queued offline action as executed.
- [ ] Startup, app size, battery, crash-free sessions, Android memory and image/network traffic budgets; protect low-end devices.
- [ ] First-run onboarding and user-permission education A/B tests, but no dark patterns to obtain sensitive data or paid purchase.

### F13-02 — Plans, pricing, referrals and sustainable economics

- [ ] Final plans with quota examples, fair-use policy, model budget safety caps, voice-minute limits, premium integrations and optional family seat counts.
- [ ] Server-side entitlements and trial abuse prevention; feature flags and pricing version; no unsupported “unlimited” advertising.
- [ ] Renewal, restore, retry, downgrade, grace, cancellation, refund/chargeback, receipt, tax invoice and app-store review flows.
- [ ] Multi-currency web receipts where legal/PSP supported; localized display vs settlement currency separated.
- [ ] Referral codes and rewards with fraud throttles and app-store compliant promotions; no incentive to spam contacts.
- [ ] Cost dashboards: inference by route/model, voice per minute, partner call, verification, notification, storage, support, total cost per **verified task** and gross margin.
- [ ] Experiment conversion, 7/30/90-day retention, activation, tasks completed, user trust and satisfaction; exclude sensitive content from unconsented analytics.

### F13-03 — Admin, customer support and trust operations

- [ ] Admin SSO + staff RBAC/ABAC, MFA, JIT elevated access, reason codes and immutable access logs.
- [ ] Support cases: task ID, status, redacted event timeline, latest provider checks, customer communications, SLA priority and resolution owner.
- [ ] Operator actions with dual approval for high-risk changes, no direct arbitrary SQL or unauthorized provider retries.
- [ ] Safe reconcile, pause provider, freeze compromised account, reissue notification, route to human and mark outcome with evidence.
- [ ] Incident management: statuses, escalation, on-call runbooks, customer communication templates and postmortem action tracker.
- [ ] AI quality console: prompt/model versions, redacted traces, user feedback, groundedness, accuracy and cost by cohort; secure access controls.
- [ ] Abuse and fraud tooling: suspicious login, excessive model spend, provider call burst, mass-send attempts, chargebacks and anomalous approvals.
- [ ] Transparency center: what connectors/actions are live, service availability, privacy and retention choices, known issues and terms.

### F13-04 — Performance engineering and capacity

- [ ] Derive traffic profile from DAU/peak QPS, requests/active-minute, concurrent voice sessions, average messages/turn and provider rate limits.
- [ ] p50/p95/p99 for auth, simple API, chat TTFT, full response, memory recall, AI Gateway overhead, provider quote, task verification and voice first audio.
- [ ] Benchmark AWS Mumbai ↔ Vercel Gateway path; tune connection pooling/HTTP keep-alive, streaming relay, context token budget and model tier.
- [ ] Index review and query plans for user+timestamp, task status/deadline, provider op ref, notification schedules; use pagination and read replicas when justified.
- [ ] Load and soak tests at realistic concurrency; saturation monitors for DB pool, Redis, queues, Temporal worker slots, CPU/memory and connection limits.
- [ ] Horizontal autoscale ECS services independently; apply bounded concurrency/backpressure to noisy providers and expensive gateway models.
- [ ] Cache safe public search/metadata only with versioned TTL and accurate timestamp; never serve outdated fare/seat as live.
- [ ] Test synthetic regional loss, gateway 429/outage, IdP outage, Temporal worker crash, DB failover, lost webhook, concurrent duplicate order and expense budget breach.
- [ ] Consider Qdrant, OpenSearch, ClickHouse, Kafka/MSK, gRPC, Go hot-path worker or EKS only if benchmark/operational evidence and ADR justify.

### F13-05 — Privacy, security, compliance and disaster recovery

- [ ] Periodic data-flow/processor review for AI Gateway, upstream model providers, voice, maps, email, payments and partner suppliers.
- [ ] Legal review India's DPDP rules and their phase-in dates; applicable notice/rights/breach requirements, cross-border handling and data retention.
- [ ] SOC 2 / ISO 27001 readiness as commercial needs justify; regular external penetration test and mobile/web/API VAPT.
- [ ] SAST/DAST/SCA/SBOM, secrets rotation, access key inventory, encrypted backups, private subnets, egress policy, build provenance and vuln remediation SLA.
- [ ] Quarterly access reviews for staff/partners, user consent audit, deletion verification, RLS isolation and re-identification risk checks.
- [ ] RPO/RTO objectives set by business; regularly test PITR restoration, queue replay, multi-AZ failover and DR runbooks.
- [ ] Regional deployment/data residency plans for new markets; assume AI inference location depends on actual gateway/provider and contract, not AWS DB region.
- [ ] Third-party terms matrix: Gmail restricted data, WhatsApp templates, payments, app-store billing, maps licensing, IRCTC/merchant access and user-directed browser access.

### F13-06 — Global rollout and extensible integrations

- [ ] Localization framework for new languages, time zones, currencies, address formats, phone validation and data retention notices.
- [ ] Per-country provider registry and feature flags; no globally uniform booking/payment availability assumptions.
- [ ] Multi-region disaster recovery with authoritative transaction writer, not casually active-active booking/payment.
- [ ] Partner onboarding SDK/templates, test harness, contract fixtures, audit/consent schema and operations certification checklists.
- [ ] Marketplace/community integration capabilities only after trust, privacy, revenue and permission model maturity.
- [ ] Open API / developer ecosystem only with OAuth delegated permissions, per-app scopes, rate limits, audit and external security review.
- [ ] Evaluate custom small models/fine-tuning only for measured extraction/classification economics, not as a prerequisite to product quality.

**Gate 13:** tested SLOs and incident processes, sustainable per-task unit economics, no outstanding critical security findings, stable paid subscription/account deletion, partner certification, credible support response and DR exercise.

---

## 4. Cross-cutting engineering specifications — required for EVERY feature

### 4.1 Definition of Ready (before coding)

- [ ] Business user outcome, feature ID, phase, audience, geography, priority and acceptance criteria documented.
- [ ] Capability declared `INTERNAL_ONLY`, `MOCK`, `READ_ONLY`, `DEEPLINK`, `SANDBOX_WRITE` or `VERIFIED_PRODUCTION_WRITE`.
- [ ] Auth/role/ownership/scoped consent and data retention defined, including deletion and export propagation.
- [ ] External provider, contract, geography, endpoint, quota, sandbox, approval/settlement ownership and fallback confirmed if needed.
- [ ] APIs and typed contracts specified; migration, keys, constraints, indexes, audit and data ownership reviewed.
- [ ] Risk and approval policy, cancel/retry/idempotency/timeout/reconciliation described for side effects.
- [ ] UI has loading/empty/success/error/offline/expired/permission-denied/unsupported paths and accessibility design.
- [ ] Target p95 latency, provider/cost budget, logging/trace plan, eval set, E2E/fault-injection scenarios drafted.

### 4.2 Definition of Done (before marking feature released)

- [ ] Implementation behind feature flag with working **web + mobile** paths if applicable; admin support visibility for actions.
- [ ] Updated migrations, RLS policies, scope/role checks, API contracts/generated clients, Python mirror when AI interfaces change.
- [ ] Unit/contract/integration/device or Playwright tests, adversarial permission tests, predictable fixtures and fault injection.
- [ ] No leaked PII, credentials or raw sensitive prompts; secrets accessed server-side; documented consent and retention.
- [ ] Load profile and p50/p95/p99 at expected traffic; model eval quality with regression baseline; inference and partner cost measured.
- [ ] Observability: OTel trace, metrics, error classification, audit events and alert conditions; on-call instructions for failures.
- [ ] External state verified via partner sandbox/production test as appropriate; no claim of production write without real evidence.
- [ ] Product copy, translations, keyboard/screen reader behavior and error messages reviewed; accessibility checklist passed.
- [ ] Staging deployment, canary/rollback, release notes, tests and evidence linked to task ID; PR approved.

### 4.3 Minimum test matrix

| Test class            | Required scenarios                                                                                               | Recommended tools                                      |
| --------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Domain/unit           | input validation, state transition invariants, policy decisions, timers/timezones, pricing arithmetic            | Vitest/Jest, Pytest, property-based testing            |
| API contract          | Zod → OpenAPI/generated TS client → Python Pydantic shape equality and backward compatibility                    | Existing contract checks, Pact/fixture tests if needed |
| Authorization         | no session, invalid issuer, wrong audience, revoked token, suspended account, cross-user IDs, admin restrictions | Supertest/Fastify inject, RLS DB integration           |
| DB migration          | fresh DB, upgrade existing data, backfill, rollback/expand-contract, repeat migration                            | Prisma migration CI + real Postgres 17                 |
| Concurrency           | same approval twice, two devices, duplicate send, provider duplicate callback, state race                        | parallel integration + DB unique constraints           |
| Network/worker fault  | timeout after write, 429, 500, short disconnect, worker kill, gateway failover, circuit open                     | fault-injection integration + Temporal test env        |
| Frontend/mobile       | login, denied permission, stale session, app background, low network, empty and failure UI, accessibility        | Playwright, Maestro/Detox, physical Android/iOS        |
| AI quality            | groundedness, instruction following, tool proposal safety, Hindi slots, wrong date/amount, prompt injection      | Pytest eval harness + human-calibrated graders         |
| Voice                 | WER and exact slot accuracy, interruptions, wrong city/amount, poor microphones, slow cellular                   | Annotated speech samples + device testing              |
| Provider verification | quote change, cancelled/partly paid, duplicate webhooks, callback-before-response, refund lag                    | Partner sandbox contract test + reconciliation         |
| Privacy               | memory deletion, token revocation, vector/cache purge, export, retention, operator audit                         | DB/queue/S3/Redis integrated suites                    |
| Load/SLO              | expected peak and burst QPS, voice concurrent sessions, DB pool, model quotas, hot paths, cost                   | k6/Locust, dashboards                                  |

### 4.4 Observability event schema and metrics

- Common trace attributes: `trace_id`, `request_id`, `user_id_hash`, `conversation_id`, `task_id`, `workflow_id`, `approval_id`, `provider`, `provider_operation_ref_hash`, `model_requested`, `model_served`, `model_route`, `consent_policy_version`, `feature_flag_version`.
- Events: `user.onboarded`, `consent.granted`, `consent.revoked`, `chat.message.accepted`, `model.call.completed`, `memory.fact.confirmed`, `task.transitioned`, `approval.signed`, `provider.operation.submitted`, `provider.outcome.verified`, `notification.delivered`, `billing.entitlement.changed`, `support.case.escalated`.
- **Never** put email addresses, full phone numbers, names, payment payloads, raw transcripts, access tokens or complete user memories in high-cardinality metric tags.
- AI efficiency measures: TTFT, full response time, total tokens, prompt/context tokens, cached-token fraction (when reported), correct-answer rate, retries and **cost per accurate outcome**.
- Agent quality measures: verified-task completion %, user-requested action success %, missing-data clarification %, unauthorized side effects (must be 0), ambiguous provider outcomes, mean-time-to-reconcile.
- Product measures: signup→first useful response, consent opt-in by purpose, task creation→verification, reminder usefulness, search→action conversion, trust/satisfaction, support cases per 1,000 tasks and retention.

### 4.5 Product-safe model routing policy

| Request class                                | Default route                 | Output / verification                          | Optimization                                         |
| -------------------------------------------- | ----------------------------- | ---------------------------------------------- | ---------------------------------------------------- |
| UI navigation, status, reminder countdown    | `NO_MODEL`                    | deterministic DB/time functions                | avoid LLM cost and delay                             |
| Intent/slot extraction, categorization       | `ECONOMY`                     | Pydantic schema + ambiguity checks             | shortest prompt; batch when safe                     |
| Ordinary conversation, draft, general answer | `BALANCED`                    | streaming and optional trusted-source checks   | TTFT and contextual precision                        |
| Complex multi-constraint plan                | `REASONING` only if justified | explicit constraints, source freshness, review | cost per correct plan; cap reasoning budget          |
| Receipt/vision/document                      | `VISION` validated modality   | field-level confidence and user review         | deterministic parsing before costly vision           |
| Semantic memory                              | `EMBEDDING` verified model    | strict user filters, correct version/dimension | batch asynchronous writes, cache permitted retrieval |
| Voice                                        | `AUDIO` / composable pipeline | exact slot confirmation for sensitive action   | optimize end-of-turn→first audio                     |
| Provider booking/payment status              | `NO_MODEL`                    | provider ledger/read-back/PSP status           | deterministic truth, no hallucinated completion      |

**Fallback rules:** explicit compatible ordered models, same allowed tool schema, same retention/privacy/residency eligibility, total deadline, no replay of acknowledged side effects. A second model's agreement is not authoritative evidence of a transaction or fact. Verify current model pricing, endpoint support and provider policies in the live Vercel catalog; do not hardcode “best” forever.

### 4.6 Availability, reliability and SLOs (targets, not promises)

| Workload                             | Starting target                                          | How verified                                        |
| ------------------------------------ | -------------------------------------------------------- | --------------------------------------------------- |
| Simple in-region API read            | p95 < 250 ms                                             | production-like load and tracing                    |
| Cached/local navigation              | p95 < 200 ms                                             | real device instrumentation                         |
| Fast chat TTFT                       | p50 < 0.8 s, p95 < 2 s on eligible warm path             | end-user network + gateway traces                   |
| Modest per-user memory retrieval     | p95 < 150 ms warm path                                   | permissioned retrieval load test                    |
| Voice first audio                    | p50 ~1 s after speech end as aspirational target         | real Hindi/Hinglish sessions; measure p95 too       |
| Task accepted into system            | immediate acknowledged task ID before slow external work | transactional create test                           |
| Business API availability            | 99.9% initial goal; raise after operating experience     | correctly scoped uptime probes                      |
| Unauthorized irreversible actions    | zero tolerance                                           | policy bypass, red-team and audit tests             |
| Duplicate external financial effects | zero target; never claim mathematical exactly-once       | provider reconciliation + injected ambiguous states |
| Acknowledged task silently lost      | zero target                                              | DB/workflow reconciliation and crash recovery       |

**Performance methodology:** collect baseline; isolate client vs API vs context vs gateway vs upstream model vs third-party latency. Optimize the dominant stage. Prefer small deterministic tools and fast model paths; cap context, parallelize independent authorized reads, keep streaming responsive and avoid synchronous long-running workflows in the request path.

### 4.7 Security and data governance requirements

- [ ] Scope permissions by **user × resource × purpose × provider × action × expiry × amount/risk** and check at every tool boundary.
- [ ] Deploy least-privilege DB/IAM/service-to-service identity; rotate keys/tokens; allowlisted outbound domains; signed internal requests with clock skew/replay tests.
- [ ] Treat external email/web/doc text as untrusted; no dynamic shell, unrestricted fetch or arbitrary plugin/tool discovery executing on model instructions.
- [ ] Enforce GDPR/regional obligations only when applicable and separately reviewed; India's DPDP framework needs current phased-rule analysis and legal sign-off.
- [ ] Privacy-by-design: optional analytics, explicit memory controls, restricted admin access, opt-in audio retention, transparent data processors.
- [ ] Support account export/deletion and per-source revocation across Postgres, pgvector, Redis, S3, jobs and linked services within documented retention constraints.
- [ ] No storing OTP, UPI PIN, card CVV, bank password or unnecessary government ID numbers.
- [ ] No scraping partner websites or bypassing authentication, CAPTCHA, bot protections, APIs/ToS or commercial controls to claim transaction capability.

---

## 5. Service-by-service implementation map for Claude

| Existing location             | What it should own in later phases                                                                                   | Explicitly must NOT own                                                        |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `apps/web`                    | marketing, account, chat, memory, goals/tasks, approvals, settings, product billing UI                               | gateway API keys, provider secrets, authoritative approval state               |
| `apps/mobile`                 | onboarding, mic, camera, native push, auth, chat, task center, secure confirmation/StoreKit/Play Billing             | direct vendor payment credentials, admin role claims                           |
| `apps/admin`                  | support console, SLO/cost/eval dashboards, restricted reconcile, staff audit                                         | unrestricted user data browsing, unaudited production edits                    |
| `apps/api`                    | OIDC, profile, consent, conversations, task and approval APIs, policies, connection management, billing entitlements | autonomous LLM provider purchase logic outside approval engine                 |
| `apps/ai-service`             | model routing, prompt/context, extraction, planning, recommendations, evaluation and limited proposal generation     | provider payment dispatch, arbitrary SQL mutations in other domains            |
| `apps/temporal-worker`        | task workflow, approval waiting, reminders, retries, long-lived follow-up, reconciliation orchestration              | treating retry as exactly-once external side effect                            |
| `apps/provider-worker`        | typed partner adapters, webhooks, provider status verification, connector-specific quotas and dispatch               | unconstrained external HTTP tool for LLM, unauthorized scraping                |
| `apps/voice-agent`            | LiveKit rooms/turns/audio pipeline, streaming transcripts, safe calls to shared APIs                                 | separate parallel authorization system or direct unapproved action execution   |
| `packages/api-contracts`      | Zod schemas, OpenAPI generator, typed TS client, contract changes                                                    | hand-maintained drifting API/client types                                      |
| `packages/ai-model-contracts` | model route schemas, tool proposal types, Python mirrored contracts and schema version                               | a hardcoded assumed universal provider feature set                             |
| `packages/domain`             | pure state machines, transitions, invariants, types                                                                  | network and DB access, model prompt logic                                      |
| `packages/config`             | validated env variables, secret references, feature flags                                                            | checked-in secrets or browser-exposed backend key                              |
| `packages/ui`                 | tokens and compatible component standards                                                                            | a single runtime component shared unsafely across incompatible native/web APIs |
| `packages/observability`      | trace correlation, redaction, metrics and errors                                                                     | logging sensitive user content by default                                      |
| `infra/terraform`             | isolated AWS environments, roles, secrets, DB, networking, deploy, scaling                                           | default broad IAM/network access                                               |
| `evals/`                      | datasets, golden cases, graders, languages, tool/accuracy/voice and privacy benchmarks                               | unconsented raw user messages copied into open test assets                     |
| `docs/`                       | ADRs, capabilities, implementation plans, DPA/consent maps, runbooks, verified vendor list                           | unsupported product promises                                                   |

**Suggested NestJS module structure** (add incrementally, respecting existing modules; not eight new microservices):

```text
apps/api/src/modules/
  identity/ consent/ profile/ conversation/ memory/
  goals/ reminders/ responsibility/ approvals/ policies/
  connections/ notifications/ billing/ providers/
  support/ administration/
```

**Suggested Python AI service internals** (reuse current package layout where equivalent):

```text
apps/ai-service/
  app/model_router/        # gateway adapter, model capability/price registry, fallback
  app/conversations/       # context builder, streaming, response schema
  app/agents/              # bounded LangGraph workflows and typed tools
  app/memory/              # retrieval, scoring, extraction proposals
  app/evals/               # offline/online quality and safety tests
```

**Event delivery pattern:** domain DB transaction writes domain row + outbox event; publisher asynchronously fanouts to queue; worker consumes with idempotent inbox dedupe; Temporal manages durable process state; provider-worker only performs allowed operations after approval; verification callback/readback is recorded and reconciled. Keep request/response schema and event schema versioned.

---

## 6. Suggested public API / event contracts by phase

**These are target designs, not claims of existing endpoints. Check existing paths and use versioned Zod contracts; do not blindly duplicate endpoints.**

| Phase | API namespaces / outputs                                                                  | Durable business events                                             |
| ----- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 00    | `/health`, `/ready`, `/metrics` (restricted), staging deployment diagnostics              | `platform.deployment.verified`                                      |
| 01    | `/v1/identity/*`, `/v1/me/*`, `/v1/consent/*`, `/v1/data-rights/*`                        | `identity.created`, `consent.revoked`, `account.deletion.requested` |
| 02    | `/v1/conversations`, `/v1/conversations/:id/messages`, `/v1/model-usage` (scoped)         | `message.completed`, `model.request.attributed`                     |
| 03    | `/v1/memory/*`, `/v1/preferences`                                                         | `memory.fact.confirmed`, `memory.fact.deleted`                      |
| 04    | `/v1/tasks/*`, `/v1/approvals/*`, `/v1/goals/*`, `/v1/reminders/*`, `/v1/notifications/*` | `task.transitioned`, `approval.granted`, `reminder.due`             |
| 05    | `/v1/connections/*`, `/v1/calendar/*`, `/v1/email/*`, `/v1/contacts/*`, `/v1/billing/*`   | `connection.revoked`, `email.sent.verified`, `entitlement.changed`  |
| 06    | `/v1/voice/sessions`, `/v1/voice/sessions/:id`                                            | `voice.session.ended`, `voice.transcript.confirmed`                 |
| 07    | `/v1/automations/*`, `/v1/briefings`, `/v1/watches/*`                                     | `automation.run.completed`, `watch.condition.met`                   |
| 08    | `/v1/attachments/*`, `/v1/research/*`, `/v1/places/*`                                     | `attachment.processed`, `research.evidence.updated`                 |
| 09    | `/v1/commerce/quotes/*`, `/v1/commerce/operations/*`, `/v1/refunds/*`                     | `offer.expired`, `provider.outcome.verified`, `refund.settled`      |
| 10    | `/v1/trips/*`, `/v1/travel/*`                                                             | `trip.leg.verified`, `travel.change.detected`                       |
| 11    | `/v1/lists/*`, `/v1/orders/*`, `/v1/reservations/*`, `/v1/returns/*`                      | `order.verified`, `order.refund.verified`                           |
| 12    | `/v1/households/*`, `/v1/delegations/*`, `/v1/expenses/*`, `/v1/documents/*`              | `share.revoked`, `delegation.expired`                               |
| 13    | `/v1/support/*` (staff/private), `/v1/billing/*`, `/v1/entitlements/*`                    | `support.case.closed`, `billing.plan.changed`                       |

**Wire-level standards:**

- Request IDs and idempotency keys are separate. Public APIs return predictable `application/problem+json` errors with error codes, safe messages and trace ID, not internal stacks.
- Prefer UUID opaque resource IDs, cursor pagination, timestamp in ISO 8601 with timezone semantics, money as integer minor units + ISO currency, strong validation and explicit optional vs required fields.
- SSE stream supports event IDs and terminal states; uncertain provider state is surfaced as `PENDING_VERIFICATION`/equivalent, never coerced to success.
- All mutations enforce optimistic concurrency/version or DB uniqueness where conflicting edits matter; all owner-scoped reads enforce explicit permission + tested RLS.
- Never copy third-party raw OAuth refresh tokens into an AI model, event bus or frontend state.

---

## 7. External partner capability and blocker ledger (must be kept live)

| External area                            | Initial allowed product mode                                 | What unblocks real execution                                                                                | Safe fallback                                                              |
| ---------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **Vercel AI Gateway**                    | mock only in current repo; enable real calls after P00 smoke | paid key/credits, verified model IDs and modalities, limits, data policy and billing review                 | transparent unavailable/degraded response; deterministic features continue |
| **OIDC/identity**                        | scaffold verifier only today                                 | signed ADR, hosted login/PKCE and devices tested, issuer/JWKS configured, security review                   | no unauthorized partial login; public landing only                         |
| **LiveKit**                              | worker shell only today                                      | LiveKit account, tokens, session pilot and Gateway audio path validation                                    | text chat                                                                  |
| **Google Calendar**                      | not connected today                                          | OAuth scopes, user consent, API test account, verification if applicable                                    | draft event/manual open                                                    |
| **Gmail**                                | not connected today                                          | approved scopes; restricted-scope verification/security assessment where applicable; backend token controls | copyable draft/manual email client                                         |
| **Microsoft Graph**                      | not connected today                                          | app registration, scope/admin consent as required, test account and tenant policy                           | draft/export/manual open                                                   |
| **WhatsApp Business**                    | not connected today                                          | business verification, opt-in, templates, policy-compliant API integration                                  | in-app push/email notification                                             |
| **Flight/hotel**                         | research/read-only until source and rights verified          | ticketing/booking partner contract, inventory/quote/settlement access, webhook/PNR verification             | supplier booking link with “complete externally”                           |
| **IRCTC trains**                         | planning/links only                                          | authorized IRCTC partner channel, production credentials, payment/ticketing rights                          | official website/app handoff                                               |
| **Buses/cabs**                           | source-dependent read-only/deep link                         | official partner API permits booking in target region and live status                                       | official app handoff; no fictitious ride                                   |
| **Food/grocery/ecommerce**               | list/search/deep link only until contract                    | approved catalog/cart/order/payment/status access and refund processes                                      | shopping list + merchant link                                              |
| **Restaurant/events**                    | discovery/known reservations page                            | real inventory and confirmed booking/seat API contract                                                      | official reservation page/call route                                       |
| **UPI/PSP**                              | user-mediated redirect/intent only where compliant           | PSP contract, webhooks/status readback, merchant-of-record and refund ownership                             | ask user to pay directly in partner app                                    |
| **Financial account aggregation**        | manual import and explain only                               | regulated licensed partner/account aggregator, user consent and legal review                                | private manual budget tracking                                             |
| **Government/DigiLocker/health systems** | documents/checklists/manual coordination                     | official API partnership and appropriate consent/regulated handling                                         | guide to authoritative portal/provider                                     |

**Universal partner rule:** if ability is not verified, use `UNAVAILABLE` or `DEEPLINK`, never silently web-scrape or present a mock as actual integration. Provider documents, statuses and redirects are inputs to KAREN; authoritative completion must still be independently established.

---

## 8. End-to-end scenario acceptance checklist

The following E2E scenarios should ultimately work across the relevant phases. Each must be tested using real services where marked “production verified”; mocked tests are useful but not equivalent.

1. **New-user journey:** open mobile → signup via real IdP → verify → accept only selected purposes → skip optional fields → ask question → answer streams → logout → resume → export/delete.
2. **Hindi/Hinglish:** “Kal subah 9 baje yaad dilana” → interpret locale/time zone → confirm ambiguity if present → save verified reminder → OS push → snooze/edit → no duplicate occurrence.
3. **Memory control:** user tells preference → optional memory candidate/confirmation → next relevant chat uses fact → user edits → answer immediately reflects correction → deletes → future context cannot retrieve it.
4. **Goal ownership:** create “plan weekend trip” → editable milestones → KAREN gathers live sourced options → user picks one → task status timeline remains accurate through restart.
5. **Approval integrity:** prepare calendar event → change attendee after approving → old approval rejected → reapprove exact new payload → event created and read back.
6. **Gmail security:** disconnected Gmail → no API read; connected scoped account → summarize user-selected thread → prepare email draft → user changes recipient → forced new approval → verify send using external message ID.
7. **Task crash recovery:** provider accepts task but network times out → task `AWAITING_PROVIDER/VERIFYING` → worker restart → reconcile by reference → no duplicate booking/payment.
8. **Voice ambiguity:** “Send fifteen thousand to Amit” misheard as ₹1,500 or different Amit → no payout → screen confirmation/step-up → only allowed provider capability executes after proper approval.
9. **Proactive behavior:** opt in to watch → alert threshold met with fresh source → notification respects quiet hours → dismiss + mute prevents repeats → disconnect stops future checks.
10. **Private attachment:** user uploads receipt → scan/extract → correct field → save as optional expense → remove file + vectors → another user cannot retrieve it.
11. **Partner booking:** actual certified supplier quote → exact terms → reprice → approve → dispatch once → signed callback → authoritative read-back → receipt → user sees `COMPLETED_VERIFIED`.
12. **Refund:** cancellation requested → provider acknowledges → refund initiated → payment settlement pending → only mark verified refunded after reliable source confirms funds return.
13. **Incomplete supply:** no IRCTC/food/ride booking rights → show honest source/planning info, partner link and manual steps → no “booked” claim.
14. **Household isolation:** parent shares grocery list, not Gmail/memories → other member sees only list → delegation revoked → pending action blocked.
15. **Payment entitlement:** user purchases monthly subscription in app → server notification verifies → plan unlocked across devices → restore, cancel, refund and expired grace period handled accurately.
16. **Provider outage:** Vercel unavailable → error/degraded deterministic features; supplier down → task remains safely pending; user gets timely factual status without fabricated outcomes.
17. **Data rights:** user revokes memory/analytics/connection purpose → new processing blocked → export/deletion job status visible → derived copies cleared per documented policy.
18. **Staff support:** agent can view scoped redacted case but not general chat; access is ticket-audited; dangerous reconcile needs approved staff permission and emits immutable event.

**Proof format per scenario:** test case ID, phase, environment, provider account/sandbox/production capability, timestamp, anonymized input, expected outcome, actual observed evidence, metrics, known limitation, reviewer and release commit.

---

## 9. First execution backlog after your current two commits

> **Do these IN ORDER** for first user-facing milestone. Steps after the setup gate can be split into independently reviewable PRs. Don't rush into payment/flight/voice before real auth + chat + policy work.

### Work package A — Production-quality source and staging platform

- [ ] A01: create remote, push `main`, protect branch and require CI; reproduce foundation tests on hosted runners.
- [ ] A02: ADR-0015 compare Cognito/Auth0/Clerk using real Expo + Next.js login prototype, decide provider and record total-cost/UX rationale.
- [ ] A03: write IdP Terraform variables/secrets, webhook/callback allowlists and staff identity plan.
- [ ] A04: implement minimal DB app roles, RLS + `FORCE` policy review; negative tests and pooled connection reset.
- [ ] A05: GitHub Actions SHA pinning, remote Terraform state, IAM OIDC and staging deploy, rollback smoke test.
- [ ] A06: Live Vercel AI Gateway **test** key/models/budgets and capability ledger; keep production model calls disabled.

### Work package B — Real user identity and first home

- [ ] B01: user auth contract + external identity mapping migration; test subject-to-local-UUID invariant.
- [ ] B02: web sign-in/onboarding/recovery, then mobile sign-in using native PKCE; signed-out/expired/suspended flows.
- [ ] B03: profile and consent DB/APIs plus receipts, onboarding choices and first-run tutorial.
- [ ] B04: full-data read isolation and RLS property tests; admin SSO restricted route and audit.
- [ ] B05: account deletion/export workflow skeleton; notification channel choice and locale settings.
- [ ] B06: completion E2E: new user can sign in, configure profile, see protected `/v1/me`, revoke consent and log out across devices.

### Work package C — First real AI conversation

- [ ] C01: conversation/message persistence and ownership-migration indexes; Zod/OpenAPI generated client.
- [ ] C02: connect existing ModelRouter to tested Vercel Gateway, with an isolated live smoke; no hardcoded model IDs.
- [ ] C03: streaming SSE events, client reconnection/cancel, request idempotency, partial response semantics and mobile draft persistence.
- [ ] C04: basic English/Hindi/Hinglish prompt, ambiguity/amount/date extraction schema; eval fixtures.
- [ ] C05: budget/usage ledger, gateway fallbacks, observability and limits by user/tier.
- [ ] C06: premium chat UI desktop/mobile; history, rename, regenerate, delete, feedback and errors.
- [ ] C07: measure baseline TTFT from real devices, fix p95 bottleneck, complete privacy/safety eval before public beta.

### Work package D — Differentiation: memory and responsibility

- [ ] D01: memory facts/preferences/events and confirmation UX; exact-delete capability and Postgres vector/FTS retrieval.
- [ ] D02: task/approval/operation/evidence tables, canonical transitions, transaction outbox and Temporal idempotent start.
- [ ] D03: reminder and goal APIs + UI; notification push/SES delivery state and timezone suite.
- [ ] D04: first non-financial connector in a sandbox (e.g., approved test-account calendar create) using exact proposal/approval and verification.
- [ ] D05: worker restart, provider duplicate callback, stale approval and consent revoked-in-flight suites.
- [ ] D06: finish **first believable “KAREN did this” demo** with a real verified action, not a fake provider success.

### Controlled parallel work after A01–A03

- [ ] Start partnership outreach for first bookable transaction and Gmail verification early; these are external lead-time risks.
- [ ] Set up LiveKit dev credentials and prototype audio compatibility with Gateway; do not gate text MVP on voice supplier.
- [ ] Run market/user validation, design research, support workflows and pricing experimentation without implying an API contract already exists.

**FIRST PR recommended now:** `feat(identity): adopt ADR-0015 and implement OIDC-backed account bootstrap + consent contract`, but split ADR/POC, migrations, auth endpoints and frontend into separate PRs if review size grows. Do **not** merge real auth until issuer/audience configuration, ownership isolation, account recovery and tests are proven.

---

## 10. Instruction template for Claude Code — feature-by-feature delivery

Paste this roadmap into the repo as `docs/product/KAREN_COMPLETE_PHASED_FEATURE_ROADMAP_v1.0.md`. For each selected feature use the following operational instruction:

```text
You are implementing KAREN, a premium India-first AI life agent.
Use docs/product/KAREN_COMPLETE_PHASED_FEATURE_ROADMAP_v1.0.md as
feature scope and delivery sequence. Start from the actual repository state.

Feature ID: <Fxx-yy>
Target phase: <number>
Current PR goal: <one independently testable vertical slice>

1. Inspect the existing code, packages, migrations, contracts, ADRs and tests.
   Do not assume every listed route/module exists, and do not duplicate any
   implementation already present.
2. Identify dependencies, security and data-consent obligations. If an
   external supplier feature is unsupported/unverified, implement the
   contract+mock/disabled fallback only and label it clearly. Never invent
   provider credentials, model IDs, pricing, live booking capability or API.
3. Before code, propose a concise file-change plan, API/domain schema,
   permission matrix, data classification, idempotency/retry policy,
   UI states, telemetry, evaluation plan and acceptance tests.
4. Implement end-to-end across the smallest required existing apps/packages:
   backend + migrations + RLS + contracts + AI/worker as relevant + web/mobile
   + staff visibility + automated tests.
5. Preserve strict TS/Python typing, existing domain task state machine,
   observed architectural boundaries and operational controls. Use
   Vercel AI Gateway only through KAREN ModelRouter, not from clients.
6. For side effects, enforce exact approval, expiry, capability, audit,
   unique external op reference, safe recovery and provider read-back.
7. Run relevant unit, Python, integration, contract, lint, Playwright,
   threat/permission and eval checks; add negative/failure cases.
8. Report files changed, commands run, passing/failing evidence, migration
   notes, manual secrets/provider onboarding needed, security limitations,
   production validation missing and exact next PR.
9. Do not mark VERIFIED_PRODUCTION unless you have real authorized
   provider proof. Never execute Terraform apply or costly external
   provider calls without explicit project authorization.

Work on ONE feature ID / vertical slice per PR, not all phases in one pass.
```

### Feature PR output example (recommended)

```markdown
## Feature delivery: F02-02 — Low-latency streaming pipeline

- Status: DONE_LOCAL (not production verified)
- User story: ...
- API contracts / migration: ...
- Auth/consent and data retention: ...
- UI states: happy / loading / empty / error / partial / offline
- Metrics: TTFT p50=measured, p95=measured; benchmark details ...
- Unit, contract, integration, E2E and adversarial tests: ...
- Real vendor verification: blocked until approved Gateway key ...
- Rollback procedure / flags: ...
- Evidence (CI, logs, screenshots, trace): ...
- Remaining risks and next milestone: ...
```

---

## 11. Roadmap change governance — avoid feature creep and hidden blockers

- Maintain weekly roadmap status by feature ID, with release environment evidence and a **single owner**.
- Every new public capability must have an explicit support matrix by provider/geography/action; “global” branding doesn't mean global booking rights.
- An external blocker is not an engineering task to “just code around”; mark `BLOCKED_EXTERNAL`, begin approved contract/onboarding and ship a truthful manual fallback.
- Model choices are benchmark-led. Keep Vercel AI Gateway as the single default AI inference billing provider while supported; direct model SDK only with a documented exception and independent cost tracking.
- Prioritize frictionless **trusted daily utility** over broad unfinished verticals; measure real completed tasks per active customer and repeat usage.
- No feature may skip auth, audit, consent, risk policy and acceptance criteria solely because it is “only a prototype.” Test-only mock modes must be impossible to mistake for real actions.
- Proposed future ideas should be separate `BACKLOG_DISCOVERY` items, not commitments: on-device models, offline speech, always-listening wake word, custom LLM training, open third-party agent marketplace, autonomous financial delegation, ubiquitous browser-action automation.

---

## 12. Reference links and verification notes

**Checked for this roadmap on 20 November 2026. These are documentation starting points, not evidence of KAREN deployment or guaranteed vendor access. Recheck releases, availability, prices and terms before coding.**

- Vercel AI Gateway overview and model catalog: https://vercel.com/docs/ai-gateway and https://vercel.com/ai-gateway/models
- Vercel AI Gateway supported realtime/audio announcement (29 Jun 2026): https://vercel.com/changelog/realtime-voice-speech-and-transcription-now-supported-on-ai-gateway
- Amazon Cognito OIDC, managed login, passkeys and plan limitations: https://docs.aws.amazon.com/cognito/latest/developerguide/authentication.html and https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-authentication-flow-methods.html
- LiveKit turn handling/interruptions: https://docs.livekit.io/agents/logic/turns/
- Temporal idempotent activities/retries: https://docs.temporal.io/activity-definition and https://docs.temporal.io/workflow-definition
- PostgreSQL row security and owner bypass: https://www.postgresql.org/docs/17/ddl-rowsecurity.html
- Gmail API restricted scopes: https://developers.google.com/workspace/gmail/api/auth/scopes
- Google user data policies: https://developers.google.com/workspace/workspace-api-user-data-developer-policy
- DPDP Rules notification / phased timeline: https://www.pib.gov.in/PressReleasePage.aspx?PRID=2190655
- App Store Review Guidelines: https://developer.apple.com/app-store/review/guidelines/
- Google Play payments policy: https://support.google.com/googleplay/android-developer/answer/9858738
- pgvector: https://github.com/pgvector/pgvector
- OWASP LLM excessive agency: https://genai.owasp.org/llmrisk/llm062025-excessive-agency/
- OpenTelemetry documentation: https://opentelemetry.io/docs/

---

## 13. Final project success criteria

KAREN is succeeding when a new user can sign up securely, understand what data is being used, converse naturally in their language, have KAREN retain only permitted information, turn intent into a durable task, approve an exact high-impact action, see trustworthy execution evidence, receive follow-through until completion or explicit escalation, and correct/delete their data without hidden surprises.

**Strategic priority:** accuracy of intent + trustworthy memory + verifiable execution + respectful proactivity + premium speed/UX + economic sustainability. Model choice is an implementation decision. The enduring product is the **Responsibility Engine** and the trust users place in a task being actually finished.

**Next implementation action:** complete **Phase 00** release blockers and begin **Phase 01 / ADR-0015 (identity)**. Do not start by integrating 20 transaction providers, adding more microservices, or training a custom foundation model.
