# Vercel AI Gateway — routing, budgets and verification

Implementation: `apps/ai-service` (see its CLAUDE.md). Decision: ADR-0008.

## Tiers

`NO_MODEL, ECONOMY, BALANCED, REASONING, VISION, EMBEDDING, RERANKING, AUDIO`. Callers send a `task_kind`; the router maps it to a tier. VISION/EMBEDDING/RERANKING/AUDIO are behind `KAREN_FEATURE_*_ENABLED` flags (default off).

## Configuration

| Variable                                                                                 | Purpose                                                                 |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `KAREN_AI_GATEWAY_MODE`                                                                  | `mock` (default, no network) or `live`                                  |
| `AI_GATEWAY_BASE_URL`                                                                    | `https://ai-gateway.vercel.sh/v1`                                       |
| `AI_GATEWAY_API_KEY`                                                                     | backend-only; Secrets Manager in AWS; ai-service task role only         |
| `KAREN_MODEL_<TIER>` (+ `_BALANCED_FALLBACK`)                                            | exact catalog slugs — **never** in code                                 |
| `KAREN_MODEL_REGISTRY_PATH`                                                              | JSON registry: capabilities + USD/MTok prices + `verified_at` per model |
| `KAREN_AI_MAX_OUTPUT_TOKENS`, `KAREN_AI_REQUEST_TIMEOUT_SECONDS`, `KAREN_AI_MAX_RETRIES` | per-call rails                                                          |
| `KAREN_AI_MAX_REQUEST_COST_USD`, `KAREN_AI_DAILY_BUDGET_USD`                             | KAREN-side budget layer (gateway budgets are a separate backstop)       |

## Enabling live traffic — checklist (all currently NOT DONE)

1. Vercel team/project + AI Gateway key created; credits purchased; gateway budgets and low-balance alerts configured.
2. Pick candidate models per tier from the live catalog; record slug, price, context/output limits.
3. For each candidate, verify with a scripted probe: chat completion, streaming + usage in final chunk, JSON-schema output, tool calls (if used), fallback via `providerOptions.gateway.models`, error shapes for 429/timeouts, request-id header.
4. Write results into the production registry file with `verified_at`; review data-processing/retention terms per upstream provider (AWS Mumbai hosting ≠ in-India inference).
5. Set `KAREN_AI_GATEWAY_MODE=live` in dev first; run golden evals in live mode; compare cost per correct task.
6. Move the AI daily budget tracker to Redis before running >1 replica.

## Outage playbook (summary)

Gateway errors surface as typed `GATEWAY_*` / `FALLBACK_EXHAUSTED` errors; the action plane (Temporal/provider-worker) keeps working without inference. Do not enable direct-provider fallback without an approved ADR. Stream interruptions are shown to the user; never silently replayed.
