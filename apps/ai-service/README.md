# KAREN AI service (`apps/ai-service`)

Python 3.12 / FastAPI service that owns model routing and inference for KAREN.

```
API (NestJS) --signed--> /internal/v1/completions[/stream]
                         -> ModelRouter (task_kind -> tier [+ task route] -> registry model)
                         -> policy + budget (per-request cap, daily budget)
                         -> GatewayClient (MockGatewayClient | OpenRouterGatewayClient)
                         -> ModelInvocationRecord sink (metadata only)
```

- `GET /health/live`, `GET /health/ready` — unauthenticated; readiness never calls the paid gateway.
- `POST /internal/v1/completions` — `CompletionRequest` → `CompletionResponse` (contract `2026-11-22.v3`).
- `POST /internal/v1/completions/stream` — SSE (`start`, `delta`…, then exactly one `done` or `error`).
- Errors use the contract envelope: 422 validation, 401 signature, 403 budget, 429 rate limit,
  503 tier disabled / capability unavailable, 504 timeout, 502 provider / invalid response / fallback exhausted.

Quick start: `cp .env.example .env && uv sync && uv run karen-ai-dev` (mock gateway, no secrets).
Evals: `pnpm evals` from the repo root (mock only; says nothing about model accuracy).

Phase 02 chat (ADR-0022/0023): CHAT requests without a system message get the catalogued
`chat.v2` prompt (language matching for English/Hindi/Hinglish, Indian conventions, honesty
about missing live data, no claimed actions, injection resistance) with the caller's `locale` and
`timezone` hints; exact date/time questions are answered by code (`NO_MODEL`, zero gateway calls).
The app's mock gateway returns a labelled reply ("[mock] … no AI model was called") and, for
local/QA testing only, honours `[[mock:slow]]`, `[[mock:long]]`, `[[mock:fail=CODE]]` and
`[[mock:fail_after=N]]` in the latest user message. The live gateway never parses these.

## Status
| Area | State |
| --- | --- |
| Router, budget, mock gateway, SSE, internal auth, LangGraph skeleton | implemented + tested |
| `OpenRouterGatewayClient` | tested against a fake OpenAI-compatible endpoint using OpenRouter's documented shapes, incl. the app wired in live mode (`tests/test_live_gateway_integration.py`) — **live gateway NOT VERIFIED**: no key used, SP-1 probe not run (see below) |
| Task-based routing | least expensive qualified model per `task_kind` (quality floor, latency, capability, budget); pins optional; image input on the flag-gated VISION tier (ADR-0026) |
| Voice | STT/TTS behind provider protocols; OpenRouter + mock adapters; voice catalog + language/accent voice selection; `/internal/v1/audio/*` (flag `KAREN_FEATURE_VOICE_ENABLED`) — **live speech NOT VERIFIED** |
| Daily budget | in-memory locally; shared atomic Redis store required when deployed (ADR-0013) |
| Langfuse | not a dependency; integrate as an `InvocationSink` |
| OTel / Sentry | activate only when `OTEL_EXPORTER_OTLP_ENDPOINT` / `SENTRY_DSN` are set |
| Memory, retrieval, vision/embedding/reranking/audio tiers | not implemented (tiers feature-flagged off) |

See `CLAUDE.md` for rules and the contract sync procedure.

## Live gateway: OpenRouter (ADR-0025)

Mock stays the default for tests and local dev. Live mode is fail-closed: it refuses to start
unless `OPENROUTER_API_KEY` is set, `OPENROUTER_BASE_URL` is https, and every configured model has
`verified_at` in `config/model-registry.live.json`. Every request carries the provider data policy
`{data_collection: deny, zdr: true}` (configurable; production refuses `data_collection=allow`).

Task routing: `CHAT` → BALANCED, `COMPLEX_PLANNING`/`COMPARISON` → REASONING, `CODING` →
REASONING on `KAREN_MODEL_CODING`, `DOCUMENT_ANALYSIS`/`SUMMARY` → BALANCED on
`KAREN_MODEL_DOCUMENT_ANALYSIS`, `EXTRACTION`/`INTENT_CLASSIFICATION`/`SHORT_REWRITE` → ECONOMY.
Details: `docs/gateway/openrouter.md`.

1. Put the non-production key in the untracked `.env` (`OPENROUTER_API_KEY=...`). Never commit it.
2. Probe the candidates (manual, budget-capped; tests never do this). The committed registry was
   produced by this command **without** `--confirm-paid-calls` (public catalog only, no key):
   ```
   uv run karen-ai-probe \
     --assign ECONOMY=<slug> --assign ECONOMY=<economy-fallback> \
     --assign BALANCED=<slug> --assign BALANCED=<balanced-fallback> --assign BALANCED=<documents-slug> \
     --assign REASONING=<slug> --assign REASONING=<reasoning-fallback> --assign REASONING=<coding-slug> \
     --assign VISION=<vision-slug> \
     --route CODING=<coding-slug> --route DOCUMENT_ANALYSIS=<documents-slug> \
     --fallback <balanced-fallback> --write-registry config/model-registry.live.json
   # add --confirm-paid-calls (needs the key and the owner's spend approval) to verify live
   ```
   The slugs used are the ones in the registry. Only models that pass every check get
   `verified_at`. Review the report (it never contains the key, prompts or output text).
3. In `.env`: `KAREN_AI_GATEWAY_MODE=live`, `KAREN_MODEL_REGISTRY_PATH=config/model-registry.live.json`,
   and each `KAREN_MODEL_*` from the `Suggested env:` note of its registry entry.
4. `uv run karen-ai-dev`; the API (`AI_SERVICE_URL`) and its per-user limits stay unchanged.
