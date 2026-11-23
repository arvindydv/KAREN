# 0023 — Live gateway activation, per-user usage limits and cost units

- Status: Accepted (limits, units, ledger) · Live activation **BLOCKED_EXTERNAL** · Date: 2026-11-21
- Related: ADR-0008 (gateway/router), ADR-0013 (fail closed), ADR-0022.
- Roadmap: Phase 02 F02-03. Entry criterion E5 (non-production gateway key + hard budget).

## Decision

1. **Cost unit**: USD **micro-units** (1e-6 USD) as `BIGINT`, rounded **up**.
2. **Three layers of spend control**, all checked before any model call:
   - per user (API): daily and monthly limits (`CHAT_DAILY_LIMIT_USD`, `CHAT_MONTHLY_LIMIT_USD`).
     Each generation **reserves** `CHAT_REQUEST_RESERVE_USD` atomically in Redis (Lua: both
     windows or nothing) and settles to the actual cost. The same value is sent to the AI
     service as `max_cost_usd`, so a request whose worst case exceeds the reservation is refused
     upstream;
   - service wide (AI service): the shared atomic daily budget (ADR-0013);
   - the gateway's own hard budget and low-balance alert (operator setting, E5).
3. **Ledger**: `platform.usage_ledger` (user, UTC day) is authoritative and is written **in the
   same transaction** as the message's terminal state and its `platform.ai_invocations` row
   (requested/served model, gateway request id, prompt version, tokens, cost, TTFT, latency,
   fallback flag, `is_mock`, error class — never content). Missing Redis counters are re-seeded
   from the ledger before any decision, so a Redis restart cannot reset a user's limits.
4. **Fail closed**: Redis unavailable → no generation starts (`DEPENDENCY_UNAVAILABLE`).
   Limit reached → `429 USAGE_LIMIT_REACHED` with `next_options: ["RESETS_AT:<iso>"]`; clients
   show a normal "limit reached, resets at …" state. `GET /v1/me/ai-usage` exposes ratios and
   reset times only — never money.
5. **What is charged**: actual cost for completed answers; nothing for mock or deterministic
   (`NO_MODEL`) answers or failures without output; the reserved worst case for failures after
   partial output (the upstream may have billed it).
6. **Rate and concurrency**: `CHAT_MESSAGES_PER_MINUTE` per user (Redis, fail closed); one
   active generation per thread (DB unique index); `CHAT_MAX_ACTIVE_GENERATIONS_PER_USER`.
7. **Model registry source** stays the versioned JSON file (`KAREN_MODEL_REGISTRY_PATH`) with
   `verified_at` per entry; a `platform.model_registry` table is deferred until models change
   without deploys. **No live slug is configured until spike SP-1** (catalog probe list in
   `docs/gateway/openrouter.md`) records verified capabilities, prices and TTFT.
8. **Mock labelling**: every assistant message stores `is_mock`; clients badge mock answers so
   they can never be mistaken for real model output (principle 7).
9. **Prompt**: the AI service owns the catalogued `chat.v1` system prompt (English/Hindi/Hinglish,
   Indian conventions, honesty about missing live data, no claimed actions, injection-resistant).
   The API sends only `user`/`assistant` turns of the current thread plus `locale`/`timezone`
   hints (internal contract `2026-11-21.v2`). Exact date/time questions are answered by code
   (`NO_MODEL`) without a model call.

## Consequences

- Limits are engineering defaults (0.50 USD/day, 5 USD/month) until product defines plans.
- Live gateway behaviour, real costs, TTFT and failover remain **NOT VERIFIED**; Gate 02 cannot
  pass until the owner provides E5 and SP-1/SP-3 are run.

## Update 2026-11-21

E5 partly met: a non-production key with a $5 testing budget exists. The gateway rejects model
calls with `403 customer_verification_required` until a credit card is on the Vercel team, so
activation stays **BLOCKED_EXTERNAL**. SP-1 tooling (`karen-ai-probe`) and a candidate registry
(`apps/ai-service/config/model-registry.live.json`, all `verified_at: null`) are in place; see
the former Vercel gateway guide (now `docs/gateway/openrouter.md`).

## Update 2026-11-21 (later) — gateway moved to OpenRouter

ADR-0025 replaces Vercel AI Gateway with OpenRouter. Limits, cost units, the ledger and fail-closed
behaviour in this ADR are unchanged. Layer 3 is now an OpenRouter per-key credit limit. The
candidate registry was regenerated from OpenRouter's public catalog (all `verified_at: null`);
live activation now waits on an OpenRouter key with a hard limit and a passed SP-1 probe
(`docs/gateway/openrouter.md`). No paid call has been made.
