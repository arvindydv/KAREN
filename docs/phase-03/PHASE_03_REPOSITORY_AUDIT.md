# KAREN — Phase 03 (Personal Memory) — Task 01: Repository Audit

- **Date:** 2026-11-23 · **Baseline:** `main` @ `e5ff562` (clean working tree)
- **Type:** audit only. No application code, migrations, tests, workflows, ADRs or dependencies were changed. This file is the only addition.
- **Scope:** the state of the monorepo before Phase 03 (Personal Memory, `karen_phases.md` §PHASE 03, F03-01…F03-03), and where memory should plug in.

### Evidence labels used in this document

| Label    | Meaning                                                                                                                                                                      |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[V]**  | **Verified** by reading the code or config at the cited path in this audit (static inspection).                                                                              |
| **[D]**  | **Documented**: stated in a repo document (report, ADR, plan). The code was not re-checked or the claim cannot be checked statically, e.g. test pass counts and live probes. |
| **[A]**  | **Assumption**: inference not proven by code.                                                                                                                                |
| **[R]**  | **Recommendation** for Phase 03 design. Not a decision.                                                                                                                      |
| **[NV]** | **Not verified**: needs a command, a live call, GitHub settings or owner input.                                                                                              |

No tests, builds or live calls were run in this task. Pass counts below are quoted from reports **[D]**.

---

## 1. Executive summary

1. **Phase 03 starts from zero memory code, but the scaffolding is ready.** **[V]**
   - The memory stubs are docstrings only: `apps/ai-service/src/karen_ai/memory/__init__.py` and `retrieval/__init__.py`.
   - Several pieces already exist:
     - the consent purposes `MEMORY_STORAGE` and `PERSONALIZATION` (`apps/api/prisma/schema.prisma:337-351`);
     - the pgvector extension, pgvector 0.8.7 on PostgreSQL 17 (`20261119173616_foundation/migration.sql:4`; image in `docker-compose.yml`);
     - the raw-SQL vector helper (`apps/api/src/infrastructure/database/vector.ts`);
     - an `EMBEDDING` route tier (`packages/ai-model-contracts/src/index.ts:23`, `contracts.py:36`);
     - a per-transaction RLS scope helper (`prisma.service.ts` `withUserScope`).
2. **The chat path has one clear injection point.**
   - The API builds the model context in `GenerationService.load()` (`apps/api/src/conversation/generation.service.ts:125-165`) and `buildContextWindow` (`chat-policy.ts:23-45`). **[V]**
   - The ai-service builds the system prompt in `prompts/catalog.py` (`chat.v4`), and that prompt currently tells the model _"you don't yet remember other conversations"_ (`catalog.py:57`). **[V]**
   - The ai-service has no database access, and it should stay that way. **[V]** Retrieval should therefore run in `apps/api`, with the result passed over the signed internal contract. **[R]**
3. **The biggest external blocker is that no embedding model is pinned or verified.**
   - `KAREN_MODEL_EMBEDDING` is unset and `KAREN_FEATURE_EMBEDDING_ENABLED=false` (`core/settings.py:85,98`). **[V]**
   - The router refuses non-text tiers (`model_router/router.py:185-188`). **[V]**
   - The gateway client has no embeddings call (`gateway/openrouter.py`). **[V]**
   - Whether OpenRouter serves embeddings for a model that is acceptable for Hindi/Hinglish is **[NV]**. Finding out needs the owner's approval for a paid probe.
4. **Isolation is strong but has gaps to close before memory data lands.**
   - RLS plus a least-privilege runtime role are real and integration-tested (`apps/api/test/rls.int.test.ts`). **[V]**
   - However, `FORCE ROW LEVEL SECURITY` is missing on several tables (§13). **[V]**
   - The background generation runner does not re-check consent. **[V]**
   - Some Redis keys carry raw user UUIDs. **[V]**
5. **There is no async write path to reuse as-is.**
   - The outbox table exists but has no writer or relay. **[V]**
   - There is no queue or cron. **[V]**
   - Temporal is wired but runs only data-rights workflows. **[V]** Their pattern (workflow → HMAC-signed internal callback into the API) is the proven template for asynchronous memory extraction and deletion. **[R]**
6. **Governance items need owner decisions before Task 02** (§18):
   - Phase 02 Gate 02 is recorded **NO-GO** (`docs/PHASE_02_REPORT.md` §7). **[D]**
   - There is a stale, conflicting `docs/PHASE_03_MULTIMODAL_PLAN.md`. **[V]**
   - Branch protection on `main` is **[NV]**.

---

## 2. Current repository structure

### 2.1 Git state (commands: `git status`, `git branch -a`, `git log`, `git stash list`, `git worktree list`)

- **Branch and status [V]:** current branch `main`, up to date with `origin/main`, working tree clean.
- **HEAD [V]:** `e5ff562`, which merges #45, the dependency batch.
- **Last feature merge [V]:** `9180029`, PR #43 `phase-02/conversations`. That merge includes the voice removal (`e7c31ab`, ADR-0035).
- **No Phase 03 branch exists** locally or on `origin`. **[V]**
- **Other state to leave alone [V]:**
  - `stash@{0}` on `phase-01/m10-hardening` ("mobile M9 work").
  - Extra worktrees: `/home/arvind/code/karen-m9-test` (`local/m9-phone-test`), two `.claude/worktrees/agent-*`, and two scratchpad worktrees.
  - Archived voice work on `archive/phase-02-voice`.
  - Open Dependabot branches on `origin`.
- **Stray directory [V]:** an untracked `apps/ai-service/src/karen_ai/speech/` exists that contains only `__pycache__`, left over from the voice removal. It is harmless; deleting it is local hygiene.

### 2.2 Applications (`apps/`)

| App               | Stack                                        | Responsibility                                                                                                                                      | Phase 03 relevance                                                             |
| ----------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `api`             | NestJS 12 + Fastify, Prisma 7                | BFF and every business domain: identity, auth, consent, data-rights, conversation, policy, staff, health, audit (`src/app.module.ts:80-96`) **[V]** | **Primary**: new `memory` module and schema, retrieval, CRUD API, export/erase |
| `ai-service`      | Python 3.12, FastAPI, uv                     | ModelRouter, OpenRouter gateway, chat prompt, budget, evals. **No database access** **[V]**                                                         | Embedding endpoint, extraction (Pydantic), prompt memory block, evals          |
| `temporal-worker` | Temporal TS                                  | `actionExecutionWorkflow`, `dataExportWorkflow`, `accountDeletionWorkflow` (`src/workflows/`) **[V]**                                               | Async extraction, embedding and deletion-propagation workflows **[R]**         |
| `provider-worker` | Temporal TS + webhook server                 | Provider adapter registry; only `MockSandboxAdapter` **[V]**                                                                                        | None                                                                           |
| `voice-agent`     | Python, Phase 00 skeleton (ADR-0035) **[D]** | Phase 06                                                                                                                                            | None                                                                           |
| `mobile`          | Expo SDK 58 + Expo Router                    | Auth, onboarding, settings, chat (`app/(app)/chat/*`, `src/features/chat/*`, `src/lib/chat-*.ts`) **[V]**                                           | Memory list/edit/forget UI, provenance, consent prompts                        |
| `web`             | Next.js 16                                   | BFF auth, chat, settings (`src/app/...`) **[V]**                                                                                                    | Keep CI green only (owner instruction: mobile-first)                           |
| `admin`           | Next.js 16                                   | Staff console with WebAuthn and a BFF allowlist; pages are thin **[V]**                                                                             | None for P03, unless support tooling is requested                              |

### 2.3 Packages (`packages/`) **[V]**

| Package                                       | Responsibility                                                                                                                                                                         |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api-contracts`                               | Zod DTOs → OpenAPI (`openapi/karen-api.v1.json`) → generated client. Memory endpoints go here.                                                                                         |
| `ai-model-contracts`                          | API↔AI wire contract (`CONTRACT_VERSION = '2026-11-23.v4'`, `src/index.ts:14`) plus shared fixtures; mirrored in `apps/ai-service/src/karen_ai/contracts.py`.                          |
| `domain`                                      | Pure business rules: task state machine, policy, approvals, privacy purposes (`src/privacy.ts`), idempotency, workflow names and queues (`src/workflows.ts`), HMAC signing (`./node`). |
| `config`                                      | Fail-fast zod env loader.                                                                                                                                                              |
| `observability`                               | Logger, `REDACT_PATHS` (`src/redaction.ts:7-31`), `user_ref` HMAC (`:51-53`), OTel/Sentry.                                                                                             |
| `ui`                                          | Tokens and safe Markdown parser.                                                                                                                                                       |
| `test-fixtures`                               | Synthetic shared JSON fixtures (users, HMAC vectors, webhooks).                                                                                                                        |
| `types`, `eslint-config`, `typescript-config` | Shared types and tooling.                                                                                                                                                              |

### 2.4 Infrastructure, documentation, evals **[V]**

- **Infrastructure:**
  - `docker-compose.yml`: Postgres `pgvector/pgvector:0.8.7-pg17` on port 5442, Redis 7.4 on 6390, Temporal 1.10.1, otel-collector.
  - `infra/database/roles.sql`: least-privilege roles and grants.
  - `infra/docker/`: Dockerfiles and the test-DB init.
  - `infra/terraform/`: dev, staging and production environments, plus modules for rds-postgres, redis, sqs, eventbridge, kms, s3, ecs and others.
- **Documentation:**
  - `docs/adr/` holds ADR 0001–0035.
  - `docs/architecture/`, `docs/database/` (`conventions.md`, `future-entities.md`, `pgvector.md`), `docs/security/`, `docs/runbooks/` (includes `data-deletion-failures.md`).
  - Phase reports and the product blueprint (`docs/product/instinct-reference-blueprint.md`).
- **Evals:**
  - `evals/golden-cases/` has about 26 JSON cases.
  - `evals/datasets/` and `evals/graders/` contain only a README each.

---

## 3. Existing architecture (verified against code)

- **Planes:** an interactive plane (API ⇄ ai-service SSE), a durable plane (Temporal), and an ephemeral coordination plane (Redis). PostgreSQL is authoritative. **[V]**
- **Deployables:** 8 container images are built in CI (`.github/workflows/ci.yml`, `containers` job). This matches the CLAUDE.md principle of 5–7 deployables plus clients. **[V]**
- **The blueprint is out of date on the gateway.** `docs/product/instinct-reference-blueprint.md` §7.4–7.5 names **Vercel AI Gateway**, but ADR-0025 replaced it with **OpenRouter** (Vercel account blocked; `docs/PHASE_02_REPORT.md` §9). Phase 03 design must follow ADR-0025. **[V]**
- **Architecture intent for memory** (`karen_architecture.md` §5, around lines 320-331) **[D]**:
  - a deterministic user filter → FTS/BM25 plus vectors → rank fusion → freshness and consent checks → minimal context injection;
  - asynchronous write _proposals_;
  - deleting a memory deletes its embeddings and caches.
- **Planned tables** in `karen_phases.md` PHASE 03: `memory.facts`, `preferences`, `suggestions`, `episodes`, `embeddings`, `conflicts`, `deletion_jobs`, `access_events`. **[D]**

---

## 4. Backend architecture (`apps/api`)

- **Modules** (`src/app.module.ts:80-96`) **[V]**:
  - `config`, `infrastructure/{database,redis,mail,ai,temporal}`, `audit`, `security`, `identity`, `auth`, `consent`, `onboarding`, `data-rights`, `conversation`, `policy`, `staff`, `health`.
  - `app.module.ts:32` comments that memory is a planned domain module.
- **Layering rules** (`apps/api/.dependency-cruiser.cjs`, run in `lint`) **[V]**:
  - no cycles;
  - `infrastructure` and `security` are leaves;
  - no cross-module controller imports;
  - controllers cannot import the Prisma client.
  - These are api-local only; there are no monorepo-wide boundary rules.
- **Validation** **[V]**:
  - `ZodBody` / `ZodQuery` (`src/common/zod.ts:14-46`) use schemas from `@karen/api-contracts`.
  - The error envelope is `{error:{code,message,correlation_id,retryable,next_options?,details?}}` (`packages/api-contracts/src/common.ts:40-54`).
  - A global filter is in `src/common/http-exception.filter.ts:39-91`.
- **Transactions** **[V]:** `PrismaService.withUserScope(userId, fn)` validates that the id is a UUID, then runs `set_config('karen.user_id', $1, true)` inside the transaction (`src/infrastructure/database/prisma.service.ts:86-104`). `withTransaction` uses ReadCommitted with a 10 s timeout (`docs/database/conventions.md`).
- **Idempotency** **[V]:** implemented separately in each place it is needed.
  - Conversations: `Idempotency-Key` → `messages.client_idempotency_key`, unique per user (`conversation.service.ts:41-61,391-427`).
  - Consent receipts and data-export open requests have their own unique constraints.
  - `platform.idempotency_records` exists and has RLS, but **no code uses it** (grep finds 0 uses).
- **Audit** **[V]:**
  - `AuditService.record` (`src/audit/audit.service.ts:34-85`) writes `audit.audit_events`.
  - Triggers block UPDATE, DELETE and TRUNCATE (foundation migration :195-209), and the role has an INSERT-only grant (`roles.sql`).
  - Metadata is scrubbed and reason codes are required.
- **AI client** **[V]:** `src/infrastructure/ai/ai-service.client.ts` makes HMAC-signed calls (`:52-71`), validates every SSE frame with `streamEventSchema`, and never retries.
- **Policy** **[V]:** `src/policy/execution-policy.service.ts:35` (`decide`) is the action gate for Phase 04. It is not relevant to memory reads, but memory writes proposed by the LLM must not bypass a server-side decision. **[R]**

---

## 5. AI service architecture (`apps/ai-service`)

- **Endpoints** (`api/routes.py`) **[V]:** `/health/live`, `/health/ready`, `/internal/v1/completions` (`:75`), `/internal/v1/completions/stream` (`:81-91`).
  - Internal HMAC auth with a 300 s tolerance, a constant-time compare and secret rotation (`core/internal_auth.py`).
  - Redis replay guard (`api/dependencies.py:49-84`).
- **Flow** (`model_router/service.py`) **[V]:**
  1. `prepare` (`:144-201`) runs the deterministic `NO_MODEL` date/time fast path (`agents/fast_path.py`).
  2. It injects the system prompt through `_with_chat_prompt` (`:122-142`) and picks a tier with `ModelRouter`.
  3. It reserves budget (`policies/budget.py`) and builds a `GatewayRequest`.
  4. `stream_events` (`:244-320`) emits start, delta, done and error events.
- **Routing** **[V]:**
  - Tiers: `NO_MODEL, ECONOMY, BALANCED, REASONING, VISION, EMBEDDING, RERANKING, AUDIO` (`contracts.py:30-39`).
  - `FEATURE_TIERS` (VISION, EMBEDDING, RERANKING, AUDIO) are gated by `KAREN_FEATURE_*_ENABLED` (`core/settings.py:45,98,178`).
  - Model IDs come only from `KAREN_MODEL_*` and `config/model-registry.{live,mock}.json`. All 9 live entries cover ECONOMY, BALANCED, REASONING and VISION only, with `verified_at: 2026-11-22` (ADR-0028). **No EMBEDDING entry exists.**
- **Gateway** (`gateway/openrouter.py`) **[V]:** the OpenAI SDK pointed at OpenRouter. It always sends the provider data policy `data_collection=deny`, `zdr=true` (`:67-68`). It has no `tools` and no embeddings method.
- **LangGraph** **[V]:** a classify→respond graph exists (`agents/conversation.py:46-99`), but **only tests use it**. Production chat goes straight through `CompletionService`.
- **Tools** **[V]:** `tools/registry.py` is proposal-only, and only evals and tests use it. The model is offered no tools.
- **Evals** **[V]:** `evaluation/run_golden.py` runs in CI with the mock gateway. It has a reply-language grader. There is no memory or retrieval grader.

---

## 6. Database architecture

- **Single Prisma schema** at `apps/api/prisma/schema.prisma`, with Postgres schemas `identity, consent, staff, audit, platform, conversation`. **[V]**
- **16 migrations** in `apps/api/prisma/migrations/`. The latest is `20261121120000_identity_reply_language`. **[V]**
  - `scripts/check-migrations.mjs` enforces a `BEGIN;…COMMIT;` wrapper.
  - CI applies every migration from scratch and runs a drift check (`ci.yml`, `integration` job).
  - Production deploys never apply migrations automatically (`deploy.yml`).
- **pgvector** **[V]:**
  - The extension is created in the foundation migration.
  - No `vector` columns exist yet.
  - `src/infrastructure/database/vector.ts` holds only `pgvectorVersion` and `vectorL2Distance` helpers, and nothing in `src` uses them.
  - The convention for vector columns is set out in `docs/database/pgvector.md`: `Unsupported("vector(N)")`, HNSW indexes written in SQL, raw SQL with the user filter in the same query, and per-row `embedding_model` / `embedding_version`.
- **Conversation data** (`schema.prisma:695-860`) **[V]:**
  - `conversation.threads` has `mode` = `standard | ephemeral` with `expires_at` (`:706-711`).
  - `messages` stores content as plain text. Unique keys are `(thread_id, seq)` and `(user_id, client_idempotency_key)`.
  - `message_events` (resume and audit, short retention), `feedback`.
  - `platform.ai_invocations` and `usage_ledger` (metadata only).
- **Conventions** (`docs/database/conventions.md`) **[V]:** UUID PKs from `gen_random_uuid()`, `timestamptz(3)`, `version` for compare-and-set, an index leading on `user_id`, and one schema per owning module.

---

## 7. Authentication and authorization

- **Global guard chain** (`src/auth/auth.module.ts:190-195`, `app.module.ts:99`) **[V]:** IP throttler → `AuthGuard` → `PermissionsGuard` → `ConsentGuard`.
- **AuthGuard** (`src/auth/auth.guard.ts:33-82`) **[V]** accepts two kinds of token:
  - `kss_…` opaque web sessions, resolved through a SECURITY DEFINER lookup;
  - ES256 `at+jwt` access tokens (`src/security/access-token.ts:111-150`), with audience `karen-api`, a configured issuer, `realm=consumer`, `sub`/`sid` UUIDs and a known `kid`.
- **Session and account checks on every request** (`identity.service.ts:47-88`, `session.service.ts:213-236`) **[V]:**
  - The session must be live: not revoked, not idle-expired, not absolutely expired.
  - The account must be ACTIVE. `DELETION_REQUESTED` accounts reach only `@AllowDeletionPending` routes.
- **Identity in handlers** **[V]:** the principal is read with `@CurrentPrincipal()` (`src/auth/decorators.ts:24-30`). `principal.userRef` is an HMAC pseudonym, `usr_` plus 24 hex chars (`packages/observability/src/redaction.ts:51-53`). The ai-service only ever receives `user_ref` (`generation.service.ts:220`).
- **Authorization model** **[V]:**
  - Consumer roles are hard-coded to `['user']` (`identity.service.ts:75-76`).
  - **No route declares `@RequirePermissions`**: the only match is the guard's own comment (`auth.guard.ts:84`). For consumer routes, "deny by default" therefore means _authenticated, live session and ACTIVE account_, plus explicit per-query ownership.
  - Staff use a separate realm and guard (`src/staff/`).
- **Public routes** are marked with `@Public()`: auth, consent notices, health, staff sign-in, dev-auth, and the internal data-rights controller, which uses HMAC `InternalAuthGuard`. **[V]**
- **Local dev auth** **[V]:**
  - `DevAuthController` is registered only when `AUTH_MODE=local-dev` (`auth.module.ts:190`).
  - Config refuses that mode unless `APP_ENV=local|test` (`config/env.ts:184-185`).
  - The controller re-checks this itself (`dev-auth.controller.ts:48-53`).

---

## 8. Consent and privacy

- **Purposes** (`packages/domain/src/privacy.ts:6-18`; enum `schema.prisma:337-351`) **[V]:** `AI_PROCESSING, MEMORY_STORAGE, CONNECTOR_ACCESS, PROACTIVE_SUGGESTIONS, COMMUNICATIONS, ACTION_EXECUTION, PRODUCT_ANALYTICS, PERSONALIZATION, PRECISE_LOCATION, AUDIO_RETENTION, FAMILY_SHARING`. Statuses are `ACTIVE, REVOKED, EXPIRED, DENIED`.
- **Storage** **[V]:**
  - `consent.consent_grants` is unique per (user, purpose, scope) and versioned.
  - `consent.consent_receipts` is append-only and hash-chained with a server MAC (trigger in `20261120210100_consent_notices_receipts/migration.sql:122-131`).
  - `notices` are immutable once approved.
- **Enforcement** **[V]:**
  - `@RequireConsent(...)` with `ConsentGuard` (`src/consent/consent.guard.ts:17-55`) returns 403 `CONSENT_REQUIRED` with `next_options: ['GRANT_CONSENT:<PURPOSE>']`.
  - `ConsentService.hasActiveConsent` and `requireConsent` (`consent.service.ts:75-104`) are available inside services.
  - Today they are used only for `AI_PROCESSING` on send, fork and regenerate (`conversation.controller.ts:154,170,262`).
  - A test already exercises `MEMORY_STORAGE` (`consent.guard.test.ts:36-44`, `test/database.int.test.ts:84-90`).
- **Data rights** **[V]:**
  - **Export:** `DataRightsService.collect()` (`src/data-rights/data-rights.service.ts:381-413`) gathers user, email, preferences, places, onboarding, devices, sessions, grants, receipts, legal acceptances, threads with messages and feedback, and the usage ledger. It is triggered by `dataExportWorkflow`.
  - **Deletion:** password re-check → `DELETION_REQUESTED` → all sessions revoked → `accountDeletionWorkflow` (grace period) → `identity.erase_user()` SECURITY DEFINER function. The latest definition is `20261121100000_conversation_phase02/migration.sql:336-400`.
  - `erase_user` deletes the identity, consent-grant, conversation and usage rows, and keeps receipts, legal acceptances and audit rows as recorded retention exceptions.
  - **Neither export nor erasure knows about memory yet.**
- **Logging privacy** **[V]:**
  - `REDACT_PATHS` covers `prompt`, `messages`, `content`, `email`, `phone`, tokens, OTP, UPI PIN, card and CVV fields.
  - ADR-0024 forbids prompt and completion text in logs. API chat logs carry only ids, error classes and statuses.

---

## 9. Chat integration points (verified flow)

1. **Send** — `POST /v1/conversations/:id/messages`, handled by `conversation.controller.ts:152-166`:
   - requires `@RequireConsent('AI_PROCESSING')` and an `Idempotency-Key`;
   - in the service: rate limit, then active-generation cap, then one `withUserScope` transaction that inserts the user message and an `accepted` assistant message (`conversation.service.ts:291-332,443-475`);
   - finally `generation.start(...)` (`:489`). **[V]**
2. **Load context** — `GenerationService.load()` (`generation.service.ts:125-165`) runs in `withUserScope` and reads:
   - the assistant message row;
   - the thread;
   - `timezone`, `preferredName` and `displayName` from users;
   - `replyLanguage` from preferences;
   - this thread's history, up to `2 × CHAT_CONTEXT_MAX_MESSAGES`. **[V]**
   - **This is the memory retrieval injection point [R].** It already runs in the user's RLS scope, after consent was checked at the HTTP layer.
3. **Window** — `buildContextWindow` (`chat-policy.ts:23-45`) keeps at most 40 messages and 24,000 chars (`env.ts:155-157`). It counts characters, not tokens. **[V]** Memory needs its own explicit budget, kept separate from history. **[R]**
4. **Wire** — `completionRequestSchema` (`packages/ai-model-contracts/src/index.ts:115`) carries `messages`, `locale`, `timezone`, `reply_language` and `user_name`. **[V]** It has **no field for memory context.**
   - Adding one is a contract bump to v5: TS schema, Python mirror and fixtures. **[R]**
   - It should be a structured field, not extra `system` messages. The ai-service skips its catalogue prompt when the first message is `system` (`service.py:124`). **[V]**
5. **Prompt** — `chat_system_prompt` (`prompts/catalog.py:40-119`, `CHAT_PROMPT_VERSION`) **[V]**:
   - the line at `:57` must change;
   - the injection-resistance rules at `:63-66` must extend to memory content, which must be treated as data and delimited. **[R]**
6. **Finalize** — `finalize` (`generation.service.ts:421-517`) writes the terminal event, `ai_invocations` and the ledger in one transaction. **[V]**
   - This is the natural hook for **enqueueing memory extraction** once a turn completes. It must exclude `ephemeral` threads and threads without `MEMORY_STORAGE` consent. **[R]**
   - It is also where to record which memory ids were used in the turn (`memory.access_events`). **[R]**
7. **Mobile** — chat screens `apps/mobile/app/(app)/chat/{index,[id],new}.tsx`; streaming `src/lib/{sse,chat-stream,chat-state,chat-queries}.ts`. **[V]** Memory UI belongs under settings or profile, plus in-chat "saved/forgotten" chips. **[R]**

---

## 10. Background processing

- **Temporal** **[V]:**
  - Task queues are `karen-tasks` and `karen-provider-ops` (`packages/domain/src/workflows.ts:10-15`).
  - The API starts workflows through `src/infrastructure/temporal/workflow-starter.ts` with `REJECT_DUPLICATE` ids (`data-rights.service.ts:331`).
  - The worker **never touches the database**. Its activities make HMAC-signed POSTs to `/internal/v1/data-rights/...` (`apps/temporal-worker/src/activities/data-rights-activities.ts`), and the API re-derives the user from the request row.
  - **This is the pattern to copy for memory extraction, embedding and deletion jobs [R].** Workflow inputs carry ids only, never personal data.
- **In-process interval** **[V]:** `src/conversation/maintenance.service.ts:39` uses `setInterval` with a Redis `SET NX` lock. It reaps stale generation leases and purges expired ephemeral threads and old events through SECURITY DEFINER functions.
- **Outbox** **[V]:** `platform.outbox_events` (`schema.prisma:661-675`) has **no writer and no relay**. SQS and EventBridge exist in Terraform modules only.
- **Not present** **[V]:** BullMQ, `@nestjs/schedule`, cron.

---

## 11. Existing reusable components

| Need in Phase 03         | Reuse                                                                | Path                                                                                                              |
| ------------------------ | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| User isolation           | `withUserScope`, RLS policy template on `karen.user_id`              | `prisma.service.ts:86-104`; `20261120090000_user_isolation_rls/migration.sql`                                     |
| Consent gate             | `@RequireConsent('MEMORY_STORAGE')`, `ConsentService.requireConsent` | `src/consent/consent.guard.ts`, `consent.service.ts:75-104`                                                       |
| Validation and contracts | `ZodBody/ZodQuery`, `ApiZodResponse`, OpenAPI generation             | `src/common/zod.ts`, `packages/api-contracts`                                                                     |
| Errors                   | `ApiError(code, safeMessage)`                                        | `src/common/api-error.ts`                                                                                         |
| Audit                    | `AuditService.record` (in-transaction)                               | `src/audit/audit.service.ts`                                                                                      |
| Optimistic concurrency   | `If-Match` / `version` CAS pattern from threads                      | `conversation.controller.ts:112`, `conversation.service.ts`                                                       |
| Idempotent create        | `Idempotency-Key` pattern                                            | `conversation.service.ts:41-61,391-427`                                                                           |
| Vector SQL               | raw-SQL helper module                                                | `src/infrastructure/database/vector.ts`                                                                           |
| AI calls                 | signed `AiServiceClient`                                             | `src/infrastructure/ai/ai-service.client.ts`                                                                      |
| Durable async jobs       | data-rights workflow + internal HMAC callback                        | `apps/temporal-worker/src/workflows/data-rights.workflow.ts`, `src/data-rights/data-rights.controller.ts:109-133` |
| Deletion and export      | `erase_user()`, `collect()`                                          | migration `…_conversation_phase02:336-400`; `data-rights.service.ts:381-413`                                      |
| Pseudonymous id          | `user_ref` HMAC                                                      | `packages/observability/src/redaction.ts:51-53`                                                                   |
| Structured LLM output    | Pydantic strict models (`extra="forbid"`)                            | `apps/ai-service/src/karen_ai/contracts.py`                                                                       |
| Usage limits             | reserve/settle spend                                                 | `src/conversation/usage-limits.service.ts`                                                                        |
| Evals                    | golden runner and graders                                            | `apps/ai-service/src/karen_ai/evaluation/`, `evals/`                                                              |
| Content-free logging     | redaction, ADR-0024                                                  | `packages/observability`, `core/redaction.py`                                                                     |

---

## 12. Missing capabilities (to be built in Phase 03) **[V] absent**

1. `memory` Postgres schema, tables, RLS with FORCE, grants in `roles.sql`, HNSW index.
2. `apps/api/src/memory/` module: CRUD, confirm, forget, clear, export, suggestions; retrieval (FTS + vector + fusion); context assembly with a budget.
3. Public contracts `/v1/memory*` in `@karen/api-contracts`. The paths are planned in `karen_phases.md`: `/v1/memory`, `/suggestions`, `/{id}`, `/export`, `/clear`, `/preferences`.
4. An AI contract field for memory context, plus extraction and embedding request/response schemas (contract bump to v5).
5. ai-service: an embeddings gateway method; an `EMBEDDING` registry entry (after a paid probe); a Pydantic extraction task; sensitivity classification; a prompt memory block.
6. An async pipeline: extraction → dedupe/conflict → consent re-check → candidate or store → embed. Deletion fan-out to embeddings and caches.
7. A per-conversation memory switch. Today there is only `mode = standard|ephemeral`; F02-04 and F03-01 call for "explicitly memory-enabled" conversations.
8. Memory in export (`collect()`) and erasure (`erase_user()`, which needs a new migration version).
9. Evals: recall@k, wrong-person recall, false-memory persistence, deletion propagation, memory prompt injection. `evals/datasets` and `evals/graders` are empty.
10. Mobile memory screens and in-chat provenance.
11. Embedding model selection and verification (owner-approved paid probe).

---

## 13. Security risks (actual findings)

| #   | Finding                                                                                                                                                                                                                                                                                                   | Evidence                                                                                                                                                                | Severity for P03                    | Recommendation                                                                                                                                                                                                                                            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | `FORCE ROW LEVEL SECURITY` is missing on `conversation.threads/messages/message_events` and several identity tables. RLS is ENABLEd, but FORCE is only on some tables. The runtime role is not the owner and has `NOBYPASSRLS` (`roles.sql:20-30`), so the exposure is limited to owner-role connections. | `20261121100000_conversation_phase02/migration.sql:225-253` (FORCE only on feedback, ai_invocations, usage_ledger); grep of `FORCE ROW LEVEL` across migrations **[V]** | Medium (defence in depth)           | Every `memory.*` table gets ENABLE + FORCE. Raise backfilling FORCE on the conversation tables as a separate, owner-approved item.                                                                                                                        |
| S2  | The generation runner does not re-check consent. `AI_PROCESSING` is checked only at the HTTP layer; `generation.service.ts` has no consent call.                                                                                                                                                          | grep `consent` in `generation.service.ts` (0 hits) **[V]**                                                                                                              | Medium for memory                   | Memory **writes** happen asynchronously, so extraction and storage must re-check `MEMORY_STORAGE` at write time. Retrieval must re-check it at read time. Revoking consent must stop pending jobs.                                                        |
| S3  | Per-user Redis keys contain the raw user UUID: `karen:chat:rate:{userId}:…` and `karen:ai:usage:{d,m}:{userId}:…`. Erasure does not clear them; they expire by TTL.                                                                                                                                       | `conversation.service.ts:292`; `usage-limits.service.ts:48,95-100` **[V]**                                                                                              | Low now; higher if memory is cached | Any memory cache must be keyed by `user_ref` or the UUID, be TTL-bounded, and be **explicitly invalidated** on edit, forget and erasure. Prefer no memory content in Redis at all.                                                                        |
| S4  | No consumer route uses `@RequirePermissions`. Authorization relies on authentication plus per-query ownership.                                                                                                                                                                                            | grep **[V]**; `identity.service.ts:75-76`                                                                                                                               | Low                                 | Keep explicit `userId` filters in addition to RLS in every memory query. Some current queries rely on RLS alone, e.g. `generation.service.ts:141` (history by `threadId`).                                                                                |
| S5  | Memory is a new prompt-injection surface: stored text gets replayed into future system context. The current defences are prompt rules (`catalog.py:63-66`), sanitising `user_name` and `locale`, and no tools.                                                                                            | **[V]**                                                                                                                                                                 | High                                | Store memories as normalised, typed values. Delimit them as data in the prompt. Never let model output write memory directly: extraction output becomes a **candidate** that server code validates (schema, sensitivity, consent). Add adversarial evals. |
| S6  | If the leading message has `role=system`, the ai-service skips its own system prompt.                                                                                                                                                                                                                     | `model_router/service.py:124` **[V]**                                                                                                                                   | Low (the API never sends one)       | Memory must use a dedicated contract field, never a caller-supplied system message.                                                                                                                                                                       |
| S7  | LLM output cannot reach privileged operations today: no tools, and `tool_proposed` is never emitted.                                                                                                                                                                                                      | `generation.service.ts:70`, ADR-0022 **[V]**                                                                                                                            | Must be preserved                   | Memory extraction is the **first** path where model output persists user data. Treat it like a proposal: validation plus policy plus consent, with an audit row.                                                                                          |
| S8  | `_logger.exception` tracebacks in the ai-service could carry content if an exception message includes it.                                                                                                                                                                                                 | `model_router/service.py:316`, `api/errors.py:50` **[V]**; content exposure **[NV]**                                                                                    | Low                                 | Extraction code must not raise with content in the message. Add a log-content test for the memory paths.                                                                                                                                                  |
| S9  | Deletion completeness: nothing derived exists yet, but memory adds embeddings, candidates, caches and pending workflows.                                                                                                                                                                                  | `erase_user` list **[V]**                                                                                                                                               | High                                | Write the deletion design first: cascade in SQL, cancel Temporal jobs, invalidate caches, and test that _edit/forget shows in the next response_ (Gate 03).                                                                                               |
| S10 | No SAST (CodeQL or Semgrep) in CI.                                                                                                                                                                                                                                                                        | `.github/workflows/ci.yml` **[V]**                                                                                                                                      | Low                                 | Owner decision; not a P03 blocker.                                                                                                                                                                                                                        |
| S11 | Branch protection on `main` is unverified (Phase 01 checklist C10 is open).                                                                                                                                                                                                                               | `docs/PHASE_01_CLOSURE_CHECKLIST.md:38` **[D]**; current state **[NV]**                                                                                                 | Process                             | Owner to confirm.                                                                                                                                                                                                                                         |

**Known open Phase 02 defects** (`docs/PHASE_02_REPORT.md` §10) **[D]**:

- The reaper does not settle Redis reservations.
- The per-user active-generation cap can be exceeded across threads.
- A retry after a network error can duplicate the first message.
- The OpenRouter stream is not closed on early exit.
- The fast path ignores `reply_language`.

None of these block memory, but the duplicate-first-message defect could create duplicate extraction candidates. Dedupe on `(user_id, source_message_id)`. **[R]**

---

## 14. Testing capabilities

- **Frameworks** **[V]:**
  - Vitest: api, workers, web, admin, packages.
  - Jest with `jest-expo`: mobile (`apps/mobile/jest.config.js`).
  - Playwright: web and admin.
  - pytest: Python, with the `integration` marker excluded by default (`apps/ai-service/pyproject.toml:89-93`).
- **Conventions** **[V]:**
  - Unit tests are colocated as `src/**/*.test.ts`.
  - API integration tests are `apps/api/test/*.int.test.ts` (vitest `integration` project, `fileParallelism: false`).
- **Integration database** **[V]:**
  - Uses docker-compose Postgres (`karen_test`, `karen_shadow` from `infra/docker/postgres/init/001-test-database.sql`); there is no testcontainers.
  - `test/global-setup.ts` runs `migrate deploy` and `scripts/db-roles.mjs`.
  - The app under test connects as the **least-privilege runtime role**, so RLS is exercised.
  - Isolation between tests comes from unique data per test, not resets.
- **Security tests** **[V]:**
  - `apps/api/test/rls.int.test.ts` covers: unscoped reads return 0 rows, cross-user reads and writes are blocked, `WITH CHECK` holds, scope resets after the transaction, and audit is insert-only.
  - Cross-user 404 tests are in `conversations.int.test.ts` and others.
  - An AI stub validates the contract (`test/ai-stub.ts`).
  - ai-service `tests/conftest.py` blocks non-loopback DNS, so tests cannot make paid calls (per `apps/ai-service/CLAUDE.md`).
- **Contracts** **[V]:** `tests/contract/test_shared_fixtures.py` plus the TS tests on `packages/ai-model-contracts/fixtures/*`.
- **Evals** **[V]:** `pnpm evals` and the CI `python` job run golden cases on the mock gateway. Live-only cases are reported as `NOT_EVALUATED`.
- **CI jobs** (`.github/workflows/ci.yml`) **[V]:**

  | Job           | What it runs                                                                                                               |
  | ------------- | -------------------------------------------------------------------------------------------------------------------------- |
  | `typescript`  | format, public-env guard, migration check, lint with depcruise, typecheck, Vitest, Jest (mobile), build, `contracts:check` |
  | `integration` | compose Postgres, Redis and Temporal; migrate from scratch; drift check; `pnpm test:integration`                           |
  | `web-e2e`     | Playwright smoke tests                                                                                                     |
  | `mobile`      | expo config and export, android and ios                                                                                    |
  | `python`      | ruff, mypy and pytest for both Python apps, plus golden evals                                                              |
  | `terraform`   | fmt, validate and mock tests                                                                                               |
  | `security`    | gitleaks, `pnpm audit`, licenses, SBOM, osv-scanner                                                                        |
  | `containers`  | 8 image builds, no push                                                                                                    |

  `deploy.yml` is manual and gated by `vars.DEPLOYMENTS_ENABLED`. `.github/dependabot.yml` exists.

- **Last recorded results** (`docs/PHASE_02_REPORT.md` §2, on the Phase 02 branch) **[D]:**
  - API: 92 unit and 170 integration tests.
  - AI service plus voice agent: 174 + 61 pytest.
  - Mobile: 55 tests.
  - Evals: 31 PASS, 17 NOT_EVALUATED.
  - These numbers were not re-run on `main` in this audit **[NV]**.

---

## 15. Technical dependencies

- **Already present and sufficient** **[V]:** PostgreSQL 17 + pgvector 0.8.7 (`pg_trgm` and FTS are built in; whether the `pg_trgm` extension is enabled is **[NV]**), Prisma 7 raw SQL, Redis, Temporal, Zod/OpenAPI, Pydantic, the OpenAI SDK (used against OpenRouter).
- **No new npm or Python dependency is required in principle** **[A]**:
  - Embeddings can use the existing OpenAI SDK client against OpenRouter, _if_ OpenRouter serves embeddings **[NV]**.
  - Vector SQL goes through Prisma `$queryRaw`.
  - If a library is needed later, ADR-0010 applies (pin, 7-day release age).
- **External blockers:**
  1. An embedding model on OpenRouter that supports Hindi, Hinglish and English, with known dimensions, price and data policy. Needs an owner-approved paid probe (`gateway/probe.py` pattern, ADR-0028). **[NV]**
  2. Whether the ECONOMY-tier models can do extraction-quality structured output (JSON or Pydantic) is **[NV]**.
  3. RDS pgvector minor version is **[NV]** (`docs/database/pgvector.md`).

---

## 16. Recommended integration boundaries **[R]**

1. **Ownership:**
   - `apps/api` owns the `memory` schema and every read and write.
   - The ai-service stays database-less and does three things: (a) embed text, (b) extract candidate memories from a turn, (c) render a memory block into the prompt.
   - This matches CLAUDE.md principle 4 (no new deployable) and `service-boundaries.md`.
2. **Retrieval runs in the API** inside `GenerationService.load()` under `withUserScope`:
   - re-check `MEMORY_STORAGE` and `PERSONALIZATION` consent;
   - apply the user filter in the same SQL as FTS and vector search;
   - use rank fusion and a fixed item and character budget;
   - send structured `memory_context[]` (id, type, normalised value, source date, confidence) over contract v5.
   - The query embedding needs an ai-service call. That adds latency, and an FTS-only fallback should be measured.
3. **Writes are proposals:**
   - Model extraction → API validation (schema, sensitivity denylist, consent, dedupe, conflict) → `suggested` or `stored`, according to the user's UI choice → audit row.
   - The model never chooses ids, user or status.
4. **Async work runs through Temporal**, using the data-rights pattern: ids-only inputs and HMAC-signed internal API callbacks. Do not introduce BullMQ or a second scheduler. Starting the outbox relay is optional and would need its own ADR.
5. **Deletion is first-class:**
   - deleting a memory cascades to its embedding rows;
   - forgetting cancels or no-ops pending jobs;
   - `erase_user()` gets a new migration version;
   - `collect()` exports memories with provenance.
6. **Ephemeral threads never produce memory.** A per-thread memory toggle is added only if the owner approves it (contract and UI change).
7. **Clients:** mobile only (owner instruction). Web gets no memory UI and only keeps CI green.
8. **Record an ADR** (next free number: 0036) for the memory data model, retrieval and extraction boundary, and embedding model selection.

---

## 17. Files and modules likely to change in Phase 03 **[R]** (forecast, not a commitment)

| Area            | Files                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DB              | `apps/api/prisma/schema.prisma` (new `memory` schema); new migrations (tables, RLS + FORCE, HNSW, new `identity.erase_user` version); `infra/database/roles.sql` grants; `docs/database/{future-entities,pgvector}.md`                                                                                                                                                                                                                            |
| API             | new `apps/api/src/memory/*` (module, controller, service, retrieval, repository); `src/app.module.ts`; `src/conversation/generation.service.ts` (`load`, `finalize`); `src/conversation/chat-policy.ts` (budget); `src/config/env.ts` (`MEMORY_*` limits); `src/data-rights/data-rights.service.ts` (`collect`); `src/infrastructure/database/vector.ts`; `src/infrastructure/ai/ai-service.client.ts` (embed/extract); `.dependency-cruiser.cjs` |
| Contracts       | `packages/api-contracts/src/memory.ts` + OpenAPI regen; `packages/ai-model-contracts/src/index.ts` (v5) + fixtures; `packages/domain/src/workflows.ts` (workflow names)                                                                                                                                                                                                                                                                           |
| AI service      | `karen_ai/contracts.py`; `memory/`, `retrieval/`; `gateway/{base,openrouter,mock}.py` (embeddings); `model_router/*` (EMBEDDING enablement); `prompts/catalog.py` (`chat.v5`); `api/routes.py`; `config/model-registry.*.json` (after probe); `evaluation/*`                                                                                                                                                                                      |
| Worker          | `apps/temporal-worker/src/workflows/memory*.ts`, `src/activities/memory-activities.ts`, `src/main.ts`                                                                                                                                                                                                                                                                                                                                             |
| Mobile          | `apps/mobile/app/(app)/settings/memory*`, `src/features/memory/*`, chat provenance chips, consent prompt                                                                                                                                                                                                                                                                                                                                          |
| Tests and evals | `apps/api/test/memory*.int.test.ts`, `rls.int.test.ts` additions, `data-rights.int.test.ts`; ai-service tests; `evals/golden-cases/memory-*.json`, `evals/graders/`                                                                                                                                                                                                                                                                               |
| Docs            | ADR-0036; `docs/architecture/service-boundaries.md`; `docs/development/environment-variables.md`; Phase 03 report                                                                                                                                                                                                                                                                                                                                 |

---

## 18. Open questions requiring owner approval

1. **Gate status:** Phase 02 Gate 02 is recorded NO-GO (`docs/PHASE_02_REPORT.md` §7). ADR-0028 records a live SP-1 probe passing on 2026-11-22, but the SP-3 Hindi baseline and the SP-2 device run are open. Is Phase 03 implementation approved while Gate 02 remains open? The blueprint §23 and the Phase 01 governance require written approval.
2. **Conflicting plan document:** `docs/PHASE_03_MULTIMODAL_PLAN.md` labels multimodal work as "Phase 03", while `karen_phases.md` defines Phase 03 as Personal Memory. Should that file be renamed or marked superseded? It was not changed in this task.
3. **Embedding model:** do you approve a capped paid probe to select and verify an OpenRouter embedding model for Hindi, Hinglish and English? Until then, should Phase 03 ship FTS-only retrieval behind the `KAREN_FEATURE_EMBEDDING_ENABLED` flag?
4. **Consent model:**
   - Is `MEMORY_STORAGE` alone enough for both storing and using memory, or is `PERSONALIZATION` also required for use in answers?
   - What happens to existing memories when consent is revoked: hide them, or delete them?
5. **Write policy:** should every extracted memory need user confirmation, or may "user-explicitly-stated" facts be stored directly with provenance, as F03-01 allows "per UI choice"?
6. **Per-conversation memory toggle:** should a `memory_enabled` flag be added on threads, beyond `standard/ephemeral`?
7. **Sensitive categories:** approve a denylist (health, financial credentials, religion/caste, sexual orientation, family-member facts, secrets) that is rejected outright versus routed to a special explicit flow.
8. **Async mechanism:** confirm Temporal (data-rights pattern) for extraction and deletion jobs, rather than activating the unused outbox relay.
9. **Defence-in-depth fixes:** may Phase 03 include backfilling `FORCE RLS` on the existing conversation and identity tables (S1) and the consent re-check in the generation runner (S2)? Or should they be tracked separately?
10. **Retention:** what are the default TTLs per memory type (episodic versus preference versus task context)? Legal review is still pending for the existing retention defaults (`PHASE_02_REPORT.md` §5).
11. **Branch strategy:** confirm a branch name such as `phase-03/memory`, and confirm whether branch protection on `main` is now enabled.

---

_End of Task 01. No implementation has started; Task 02 awaits explicit approval._
