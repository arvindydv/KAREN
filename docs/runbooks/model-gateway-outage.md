# Runbook: AI model / OpenRouter outage or cost spike

Scope: ai-service ↔ OpenRouter (ADR-0025). The **action plane is independent**: Temporal workflows,
approvals and provider operations keep working without inference.

## Signals

- ai-service errors with codes `GATEWAY_TIMEOUT` (504), `GATEWAY_RATE_LIMITED` (429),
  `GATEWAY_PROVIDER_ERROR` / `GATEWAY_INVALID_RESPONSE` (502), `FALLBACK_EXHAUSTED`.
- Invocation records with `status=failed` and rising `error_class`; TTFT regression.
- Budget refusals `BUDGET_EXCEEDED` (expected behaviour when the daily cap is reached).

## Built-in behaviour (no action needed)

- Retries: only timeout / 429 / 5xx, bounded and jittered inside `OpenRouterGatewayClient` (a `Retry-After` above 5 s is not waited out).
- Model fallback: `KAREN_MODEL_BALANCED_FALLBACK` (catalog-verified slug) via the gateway.
- Streams are never replayed after a delta; the client gets one `error` event and may retry
  with a new `request_id`.
- All budget checks happen **before** the gateway call; Redis unavailable ⇒ refuse (fail closed).

## Actions

| Situation                        | Action                                                                                                                                                                                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Upstream provider/model degraded | Confirm on the OpenRouter status page and activity dashboard. If one model is affected, point the tier at another **catalog-verified** slug in `KAREN_MODEL_<TIER>` (+ registry entry with `verified_at`) and redeploy ai-service. Never invent a slug. |
| Whole gateway down               | Nothing to fail over to by design (direct providers need an approved ADR; `KAREN_AI_ALLOW_DIRECT_PROVIDER_FALLBACK=true` refuses to start). Users see typed "assistant temporarily unavailable" errors; communicate status.                             |
| Rate limited (429)               | Lower concurrency/traffic; check gateway account limits; do not raise retries.                                                                                                                                                                          |
| Cost spike / abuse               | Lower `KAREN_AI_DAILY_BUDGET_USD` and `KAREN_AI_MAX_REQUEST_COST_USD`, redeploy; gateway hard budget is the backstop; disable optional tiers (`KAREN_FEATURE_*_ENABLED=false`). Review per-`user_ref` spend in invocation records.                      |
| Suspected key exposure           | Revoke the key in OpenRouter, create a new one (with a credit limit), update Secrets Manager `ai-service/OPENROUTER_API_KEY`, redeploy ai-service only. The key never leaves ai-service, so no other service changes.                                   |

## After the incident

Record start/end, affected tiers, error codes, spend impact, and whether fallbacks behaved as
designed. Live gateway behaviour is **NOT VERIFIED** until the Phase 00 gateway trial.
