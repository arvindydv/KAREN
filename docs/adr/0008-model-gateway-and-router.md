# 0008 — Model gateway and router

- Status: Accepted · Date: 2026-11-19 · **Gateway vendor superseded by ADR-0025 (OpenRouter)** on 2026-11-21.
  Router, mock-default, verified-registry, budget and retry rules below remain in force.

## Decision

Architecture §2 is implemented as `API → ai-service ModelRouter → policy + budget → GatewayClient → Vercel AI Gateway`.

- Callers state a `task_kind`; the router maps it to a tier (`NO_MODEL` makes no gateway call). Callers cannot choose a raw model ID (strict schema rejects it).
- Model IDs come only from `KAREN_MODEL_*` env vars plus a capability/price registry file. **`KAREN_AI_GATEWAY_MODE=mock` is the default**; live mode refuses to start without the API key, https, a non-mock registry, and `verified_at` set for every enabled tier's model.
- Budget checks (per-request cap and daily cap) run before any gateway call using registry prices.
- `AsyncOpenAI(base_url=AI_GATEWAY_BASE_URL, max_retries=0)`; KAREN owns bounded, jittered retries for timeout/429/5xx; streams are never replayed after the first delta.
- No LiteLLM/OpenRouter. `KAREN_AI_ALLOW_DIRECT_PROVIDER_FALLBACK=true` fails startup (no approved direct path exists).

## Not verified

Live gateway behaviour (fallback `providerOptions`, usage fields, request-id header, error shapes) — no credentials. Superseded: see ADR-0025 and docs/gateway/openrouter.md for the current gateway and verification checklist.
