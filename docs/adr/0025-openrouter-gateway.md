# 0025 — OpenRouter replaces Vercel AI Gateway; task-based model routing

- Status: Accepted · Date: 2026-11-21
- Supersedes: the gateway-vendor parts of ADR-0008 ("Vercel AI Gateway", "No LiteLLM/OpenRouter").
  Router, mock-default, verified-registry and retry rules from ADR-0008 stay in force.
- Related: ADR-0013 (fail closed), ADR-0023 (usage limits), ADR-0024 (content policy).
- Architecture: `karen_architecture.md` §2 still names Vercel AI Gateway as the locked gateway.
  **This ADR overrides §2.1–2.3 for the gateway vendor, base URL and key name.** The owner must
  amend §2 (or authorise that edit); until then this ADR is the source of truth for the vendor.

## Context

Live activation on Vercel AI Gateway was blocked (`403 customer_verification_required`, ADR-0023
update). The owner decided to move inference to OpenRouter. `GatewayClient` was designed as the
migration seam (architecture §2.1 "documented migration path"), so the change is contained in
`apps/ai-service`.

## Decision

1. **Gateway**: OpenRouter's OpenAI-compatible Chat Completions API,
   `OPENROUTER_BASE_URL=https://openrouter.ai/api/v1`, key `OPENROUTER_API_KEY` (ai-service only,
   `SecretStr`, Secrets Manager `ai-service/OPENROUTER_API_KEY`). Implemented by
   `OpenRouterGatewayClient` (`apps/ai-service/src/karen_ai/gateway/openrouter.py`); the Vercel
   adapter is removed. Mock remains the default mode.
2. **Data policy on every request**: `provider: {data_collection: "deny", zdr: true}` by default
   (`OPENROUTER_DATA_COLLECTION`, `OPENROUTER_ZDR`). Production refuses `data_collection=allow`.
3. **Fallback**: OpenRouter's `models` array (primary first). Fallback candidates must be
   registry-equivalent (no capability downgrade) and fit the request; every text tier may now have
   one (`KAREN_MODEL_{ECONOMY,BALANCED,REASONING}_FALLBACK`).
4. **Task-based routing**: two task kinds are added to the (unreleased) `2026-11-21.v2` internal
   contract: `CODING` (REASONING tier) and `DOCUMENT_ANALYSIS` (BALANCED tier). They, and
   `SUMMARY`, may run on a task-specific model (`KAREN_MODEL_CODING`,
   `KAREN_MODEL_DOCUMENT_ANALYSIS`) that keeps its tier's budget class; its fallbacks are the tier
   model, then the tier fallback. Workloads map as: general chat → BALANCED, reasoning →
   REASONING, extraction → ECONOMY, coding → CODING route, document analysis → DOCUMENT_ANALYSIS
   route, vision → VISION tier (feature-flagged; must have `supports_vision`).
5. **Cost**: budgets (per request, per user in the API, service daily) keep using registry prices
   from the live catalog. Catalog price bands (`pricing.overrides` with `min_prompt_tokens`) are
   not representable in the flat registry, so the probe caps `max_context_tokens` at the band
   threshold and the router refuses requests that would enter the higher band. OpenRouter's
   in-response `usage.cost` is recorded as `gateway_reported_cost_usd` for reconciliation only.
6. **Retries**: unchanged policy (timeouts, 408, 429, 5xx; bounded, jittered, never after a
   delta). `Retry-After` up to 5 s is honoured; a longer one ends the attempt with a retryable
   error. Mid-stream error chunks (HTTP 200 + `error`) are classified by their numeric code.
7. **Registry**: generated from the public catalog by `karen-ai-probe` (no key, no cost in
   catalog-only mode). Each entry's notes carry `Suggested env: KAREN_MODEL_…` so model IDs live
   only in `config/model-registry.live.json`. `verified_at` is set only by a paid probe run.

## Consequences

- No database, public API, SSE or frontend change. The internal AI contract stays `2026-11-21.v2`
  (main is still on v1; v2 ships with Phase 02), extended additively with two task kinds.
- Terraform renames the secret container: `ai-service/AI_GATEWAY_API_KEY` →
  `ai-service/OPENROUTER_API_KEY` (the old container is scheduled for deletion on apply).
- Billing moves to OpenRouter credits. Purchase fees, credit expiry and per-provider data terms
  are **NOT VERIFIED** here and must be reviewed by the owner before buying credits.
- Live behaviour (streaming usage, generation ids, `models` fallback on Chat Completions, error
  bodies) is documented by OpenRouter but **NOT VERIFIED** until the SP-1 probe passes.
- Rejected: keeping Vercel (blocked account); LiteLLM proxy (another deployable to run);
  direct provider SDKs (breaks the single-gateway bill, needs per-provider adapters).
