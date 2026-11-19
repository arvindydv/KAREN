# KAREN AI service (`apps/ai-service`)

Python 3.12 / FastAPI service that owns model routing and inference for KAREN.

```
API (NestJS) --signed--> /internal/v1/completions[/stream]
                         -> ModelRouter (task_kind -> tier -> registry model)
                         -> policy + budget (per-request cap, daily budget)
                         -> GatewayClient (MockGatewayClient | VercelGatewayClient)
                         -> ModelInvocationRecord sink (metadata only)
```

- `GET /health/live`, `GET /health/ready` — unauthenticated; readiness never calls the paid gateway.
- `POST /internal/v1/completions` — `CompletionRequest` → `CompletionResponse` (contract `2026-11-19.v1`).
- `POST /internal/v1/completions/stream` — SSE (`start`, `delta`…, then exactly one `done` or `error`).
- Errors use the contract envelope: 422 validation, 401 signature, 403 budget, 429 rate limit,
  503 tier disabled / capability unavailable, 504 timeout, 502 provider / invalid response / fallback exhausted.

Quick start: `cp .env.example .env && uv sync && uv run karen-ai-dev` (mock gateway, no secrets).
Evals: `pnpm evals` from the repo root (mock only; says nothing about model accuracy).

## Status
| Area | State |
| --- | --- |
| Router, budget, mock gateway, SSE, internal auth, LangGraph skeleton | implemented + tested |
| `VercelGatewayClient` | tested against a fake OpenAI-compatible endpoint only — **live gateway NOT VERIFIED** (fallback `providerOptions`, `stream_options.include_usage`, request-id header, fallback-exhaustion signalling) |
| Daily budget | in-memory, single process — production needs a shared store (Redis) |
| Langfuse | not a dependency; integrate as an `InvocationSink` |
| OTel / Sentry | activate only when `OTEL_EXPORTER_OTLP_ENDPOINT` / `SENTRY_DSN` are set |
| Memory, retrieval, vision/embedding/reranking/audio tiers | not implemented (tiers feature-flagged off) |

See `CLAUDE.md` for rules and the contract sync procedure.
