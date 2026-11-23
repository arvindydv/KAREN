# Phase 02 technical proposal — real AI conversations and premium chat

- **Date:** 2026-11-21. **Status:** **APPROVED by the owner on 2026-11-21** (instruction to implement Phase 02); implemented locally — see `docs/PHASE_02_REPORT.md`.
- **Roadmap:** `karen_phases.md` Phase 02 (F02-01 … F02-04, Gate 02).
- **Architecture:** `karen_architecture.md` §1–2, §12; ADR-0006 (wire contracts), ADR-0008 (gateway and router), ADR-0013 (fail-closed coordination); `docs/gateway/openrouter.md` (was `vercel-ai-gateway.md`).
- **Amendment 2026-11-21:** the gateway changed from Vercel AI Gateway to **OpenRouter** (ADR-0025). Read "Vercel AI Gateway", `VercelGatewayClient` and `gateway/vercel.py` below as OpenRouter, `OpenRouterGatewayClient` and `gateway/openrouter.py`. E5 now means an OpenRouter non-production key with a hard credit limit.
- **Constraints kept:** no new deployable (the 8 existing apps), no new vendor or dependency without a recorded reason, no model IDs or prices in code, the gateway key stays in ai-service, the LLM never authorises or executes side effects.

## 1. Goal and Gate 02

A signed-in user who has granted `AI_PROCESSING` consent can hold a real, streamed, multilingual (English / Hindi / Hinglish) text conversation, served through the live Vercel AI Gateway, with durable history, safe recovery from interrupted streams, and per-user cost limits.

**Gate 02 (roadmap):** the real paid gateway serves tested prompts; streaming recovers safely; no secrets leak; Hindi/Hinglish slot evals pass a threshold set from a measured baseline; budget refusal and failover are tested; no unauthorised tool execution.

## 2. Entry criteria (all needed before implementation starts)

| #   | Criterion                                                                                                                          | Why                                                                        |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| E1  | **Owner approval** of this proposal                                                                                                | Explicit instruction: no Phase 02 implementation without approval          |
| E2  | PR #29 merged and the auth flows re-tested on merged `main` (Phase 01 checklist C1, C2)                                            | Chat UI builds on the web BFF and the mobile session manager in #29        |
| E3  | Branch protection on `main` (Phase 00 P0-3)                                                                                        | Phase 02 adds a paid external dependency; every merge must pass the checks |
| E4  | Security P0 items S-01 … S-04 done; S-02 merged                                                                                    | Do not stack new features on known identity gaps                           |
| E5  | Vercel AI Gateway non-production account, separate key, **hard budget** and low-balance alert; spend cap approved (Phase 00 P0-19) | Gate 02 needs live calls; no paid call is made before the cap exists       |
| E6  | ASVS decisions recorded (Phase 01 checklist C7)                                                                                    | Phase 02 inherits the consumer assurance level                             |

Phase 01 external items (staging, legal, independent review) continue **in parallel** and do not block E1–E6. They still block launch.

## 3. What already exists (reuse; do not rebuild)

| Component                                                                                         | Where                                                            | State                                                               |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------- |
| `ModelRouter`, tiers (`NO_MODEL` … `AUDIO`), capability registry from `KAREN_MODEL_REGISTRY_PATH` | `apps/ai-service/src/karen_ai/model_router`                      | Built, tested with the mock gateway                                 |
| `VercelGatewayClient` (complete + stream, error mapping, retries, fallback)                       | `apps/ai-service/src/karen_ai/gateway/vercel.py`                 | Coded; **never run against the live gateway**                       |
| Internal `POST /internal/v1/completions` and `/completions/stream` (SSE `start/delta/done/error`) | `apps/ai-service/.../api/routes.py`, `@karen/ai-model-contracts` | Built; signed internal calls with replay protection                 |
| Shared daily AI budget in Redis                                                                   | `apps/ai-service/src/karen_ai/core/redis_store.py`               | Built (service-wide, not per user)                                  |
| Prompt catalog, golden eval harness (mock)                                                        | `karen_ai/prompts`, `karen_ai/evaluation`, `evals/`              | Built, mock only                                                    |
| `AI_PROCESSING` consent purpose, `@RequireConsent`                                                | `packages/domain/src/privacy.ts`, `apps/api/src/consent`         | Built in Phase 01 M6                                                |
| RLS pattern, outbox, idempotency records, audit                                                   | `apps/api/prisma/schema.prisma` (`platform`, `audit`)            | Built                                                               |
| Export / deletion workflows                                                                       | `apps/temporal-worker/src/workflows/data-rights.workflow.ts`     | Built for `identity` and `consent`; must be extended to new schemas |
| Web BFF (cookie session, CSRF, CSP), mobile session manager                                       | PR #29                                                           | Not yet on `main`                                                   |

**Missing:** a `conversation` module and schema in `apps/api`; a public chat API and SSE endpoint; chat UI on web and mobile; per-user budgets and a usage ledger; verified model registry entries; live evals; Hindi/Hinglish eval data.

## 4. Proposed architecture

### 4.1 Request flow

```
client ──HTTPS──► BFF (web) / API (mobile bearer)
                    │  auth guard → @RequireConsent(AI_PROCESSING) → rate limit → per-user budget check
                    ▼
            apps/api  conversation module
                    │  1. persist user message (idempotency key) + assistant message (status=accepted)
                    │  2. build a bounded context window from this thread only (no memory in Phase 02)
                    │  3. signed internal call, user_ref only (no user id, no e-mail)
                    ▼
            apps/ai-service  /internal/v1/completions/stream
                    │  ModelRouter → VercelGatewayClient (live) → upstream model
                    ▼
            apps/api  maps internal events → public events with a monotonic seq,
                    persists deltas in batches, writes usage to the ledger,
                    marks the message completed / incomplete / failed / canceled
                    ▼
client ◄──SSE── public events: accepted, token_delta, status, usage, complete, error
```

- **Ownership:** `apps/api` owns all conversation state. `ai-service` stays stateless for conversations and never writes to `conversation.*` (architecture §7, service boundaries).
- **No tools in Phase 02.** The roadmap's `tool_proposed` event is defined in the contract but not emitted. No tool registry is exposed to the model until Phase 04's approval engine exists.
- **No memory writes.** Phase 03 owns memory. Phase 02 context is the current thread only.

### 4.2 Data model (new `conversation` schema, plus `platform` additions)

| Table                         | Key columns                                                                                                                                                                                                                   |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `conversation.threads`        | `id` (UUID), `user_id`, `title`, `locale`, `mode` (`standard` / `ephemeral`), `pinned`, `archived_at`, `last_message_at`, `version`, timestamps                                                                               |
| `conversation.messages`       | `id`, `user_id`, `thread_id`, `seq` (per thread), `role` (`user` / `assistant`), `status` (`pending` … `canceled`), `content`, `client_idempotency_key`, `request_id`, `parent_message_id` (for regenerate / fork), `version` |
| `conversation.message_events` | `message_id`, `user_id`, `event_seq`, `type`, payload — for stream resume and audit of status changes. Short retention                                                                                                        |
| `conversation.feedback`       | `message_id`, `user_id`, `rating`, `category`, optional comment                                                                                                                                                               |
| `platform.ai_invocations`     | `request_id`, `user_id`, `message_id`, `route_tier`, `requested_model`, `served_model`, `gateway_request_id`, `prompt_version`, tokens, `estimated_cost_minor`, latency, `fallback_used`, `error_code`                        |
| `platform.usage_ledger`       | `user_id`, `period`, `cost_minor`, `tokens` — authoritative for reporting; Redis holds the fast counter                                                                                                                       |

Conventions from `docs/database/`: user-scoped RLS with the non-owner runtime role and negative tests for every table; `user_id`-leading indexes; `timestamptz`; money in minor units (USD micro-units for model cost, decided in ADR-0023); reviewed SQL migrations. `conversation.sources` is deferred until grounded search exists (Phase 08).

**Data rights:** the export workflow includes threads and messages; the deletion workflow erases the `conversation` schema and the user's `ai_invocations` (keeping only anonymised cost aggregates, subject to the legal retention schedule). This is required by Phase 01's controls and is part of Phase 02 DoD.

### 4.3 Streaming and recovery rules

1. The user message is committed before any model call. A retried `POST` with the same idempotency key returns the existing message, never a second generation.
2. Public events carry `id: <message_id>:<seq>`. A reconnect with `Last-Event-ID` replays persisted events after that point, then continues live if the generation is still running.
3. **Client disconnect:** generation continues up to its token and cost caps and is stored, so the user sees the full answer on return. An explicit `POST …/cancel` stops it. (Alternative — stop on disconnect — is in ADR-0022 for decision.)
4. **Upstream interruption after partial output:** the message becomes `incomplete`. It is never silently replayed. "Regenerate" creates a new assistant message with a new `request_id` (architecture §2.5).
5. Fallback to another model only before the first delta, and only to a model with a verified compatible capability entry.
6. Heartbeats every 15 s; server timeout and max tokens bounded by config.

### 4.4 Cost and abuse controls

- Per-user daily and monthly limits: atomic Redis counters (fail closed, ADR-0013), reconciled to `platform.usage_ledger`.
- Per-request caps (`max_output_tokens`, `KAREN_AI_MAX_REQUEST_COST_USD`), per-user concurrency limit of one active generation per thread.
- The service-wide daily budget stays as a second layer. The gateway's own hard budget is the last backstop.
- Budget refusal is a normal, tested UI state ("limit reached, resets at …"), not an error page.

### 4.5 Privacy and observability

- `ai-service` receives `user_ref` (HMAC), never a user id or e-mail. No prompt or completion text in logs or metrics.
- OpenTelemetry spans carry ids and timings only. **Langfuse or any content-capturing tracing is not added in Phase 02** unless an ADR approves the vendor, retention and redaction; this keeps the vendor list unchanged.
- Upstream data-processing terms for each approved model are reviewed before that model is enabled (architecture §9: hosting in Mumbai does not mean inference in India). The AI disclosure text shown to users must be legally approved before launch.
- Ephemeral mode: the thread is deleted after a short retention window. Copy says what is still processed; it never claims the server did not see the text.

### 4.6 Clients

- **Web:** chat page behind the existing BFF; the BFF proxies SSE with the session cookie, CSRF on `POST`, and the nonce CSP. Virtualised message list, Markdown without raw HTML, screen-reader announcements, reduced motion.
- **Mobile:** streaming over `fetch` with a readable body is assumed but **NOT VERIFIED** on Expo SDK 58 / Hermes on physical devices. Spike SP-2 decides between that and a small SSE client. No dependency is added before the spike result.

## 5. ADRs to write before code (planning deliverables)

| ADR  | Topic                                                                                                                                 |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 0021 | Conversation data model, retention, ephemeral mode, export / deletion coverage                                                        |
| 0022 | Public chat streaming protocol: events, sequence ids, resume, disconnect and cancel semantics                                         |
| 0023 | Live gateway activation: model registry source (keep the JSON file vs a DB table), per-user budgets, cost units, fallback eligibility |
| 0024 | AI observability content policy (whether any content tracing vendor is used, and on what terms)                                       |

## 6. Spikes (need approval; SP-1 needs E5)

| Spike | Question                                                                                                                                                                                                    | Output                                                                                                |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| SP-1  | Which catalog models pass the `docs/gateway/vercel-ai-gateway.md` probe list (streaming + usage, JSON schema, error shapes, request id)? TTFT from the dev machine now, from AWS Mumbai once staging exists | Registry entries with `verified_at`, measured TTFT, cost per golden case. No slug is used before this |
| SP-2  | Does streaming `fetch` work on Expo SDK 58 on a physical Android and iOS device, including background / foreground and network change?                                                                      | Recorded device run; client approach chosen                                                           |
| SP-3  | Hindi / Hinglish / English eval baseline: build the dataset (synthetic, no real user data), run candidate models                                                                                            | Baseline scores that set the Gate 02 threshold                                                        |

## 7. Milestones (after approval)

| #     | Scope                                                                                                                               | Acceptance tests                                                                                                                         |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| P2-M0 | ADRs 0021–0024, contracts in `@karen/api-contracts` (public) and `@karen/ai-model-contracts` (internal, + Python mirror + fixtures) | `pnpm contracts:check`; contract fixture tests in TS and Python                                                                          |
| P2-M1 | `conversation` schema, migrations, RLS, repository layer                                                                            | RLS negative tests per table with the runtime role; migration review                                                                     |
| P2-M2 | Thread and message APIs (create, list, get, rename, pin, archive, delete), idempotent message create                                | Cross-user 404s; duplicate idempotency key → same message; stale `If-Match` → 412                                                        |
| P2-M3 | Streaming endpoint with the mock gateway: persistence, resume, cancel, regenerate, incomplete state                                 | Disconnect / reconnect / duplicate-event tests; interrupted stream never replayed; integration test with ai-service mock                 |
| P2-M4 | Per-user budgets, usage ledger, rate and concurrency limits                                                                         | Budget exhaustion refusal; Redis outage fails closed; ledger reconciliation test                                                         |
| P2-M5 | Web chat UI                                                                                                                         | Unit + Playwright against the real API with the mock gateway: stream, cancel, regenerate, offline, budget-reached, a11y checks           |
| P2-M6 | Mobile chat UI (after SP-2)                                                                                                         | jest tests + recorded physical-device run                                                                                                |
| P2-M7 | Live gateway in non-production (after SP-1): registry, fallback, error drills                                                       | Live smoke within the approved cap; 429 / timeout / dropped-stream / depleted-credit drills; `is_mock=false` recorded; no prompt in logs |
| P2-M8 | Evals and Gate 02 evidence: Hindi/Hinglish thresholds, latency (p50/p95 TTFT), cost per request, data-rights coverage of new tables | Gate 02 report with every criterion linked to evidence                                                                                   |

## 8. Risks

| Risk                                   | Mitigation                                                                             |
| -------------------------------------- | -------------------------------------------------------------------------------------- |
| Live gateway cost overrun              | Hard gateway budget (E5), per-request and per-user caps, budget drills before any user |
| Model behaviour or catalog changes     | Pinned, verified slugs with `verified_at`; re-probe on change; no hardcoded IDs        |
| Upstream data processing outside India | Per-model terms review before enabling; legal approval of the AI disclosure            |
| Streaming on mobile networks           | SP-2; resume by `Last-Event-ID`; tested offline and network-change states              |
| Prompt injection through user text     | No tools in Phase 02; output rendered as text/Markdown without HTML; no side effects   |
| Phase 01 gaps carried forward          | Entry criteria E2–E4, E6                                                               |

## 9. Explicitly not in Phase 02

Memory and retrieval (Phase 03); tools, approvals and actions (Phase 04); attachments and grounded web search (Phase 08); voice (Phase 06); billing (Phase 04/05 track); a second model gateway or direct-provider fallback (needs an ADR).
