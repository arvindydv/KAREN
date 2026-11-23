# apps/ai-service — rules for agents

Python 3.12 FastAPI service: KAREN ModelRouter (least-cost task routing, ADR-0026), OpenRouter text
gateway client (ADR-0025), LangGraph agents, evals. Voice/speech is out of scope for this service
(removed from Phase 02; archived on branch `archive/phase-02-voice`).
Architecture source of truth: `/karen_architecture.md` §2 (gateway, router, spend), §10, §11.

## Hard rules
- **Never hardcode a model ID** in code, tests or docs. Tiers map to IDs only via `KAREN_MODEL_*`
  env + the capability registry. Tests use `mock/*` or obviously fake `test-creator/*` slugs.
- **Never expose `OPENROUTER_API_KEY`**: no logging, no error messages, no responses, no client bundles.
  It is a `SecretStr`; keep it that way.
- **Never replay a stream** after any delta was delivered. A mid-stream failure ends with one `error`
  event; the caller starts a new `request_id`.
- Retries: only timeout / 429 / 5xx, bounded, jittered, inside `OpenRouterGatewayClient` (SDK `max_retries=0`).
- Every refusal (tier, capability, per-request budget, daily budget) happens **before** the gateway call.
- No prompt/response content in logs, invocation records or error messages. Redaction is a backstop.
- The LLM never executes side effects. Side-effecting tools are proposal-only (`tools/registry.py`).
- `KAREN_AI_ALLOW_DIRECT_PROVIDER_FALLBACK=true` must keep failing startup until a direct path is approved.
- Live gateway: the SP-1 probe passed on 2026-11-22 for every model in `config/model-registry.live.json`
  (ADR-0028). Model IDs live only in that file ("Suggested env" notes say which `KAREN_MODEL_*` each
  serves); tests read slugs from it, never hardcode them. ECONOMY/BALANCED/VISION send
  `reasoning: {"enabled": false}`; never put a `reasoning=mandatory` model on those tiers.
- Every request sends the provider data policy (`data_collection`, `zdr`); never drop it.
  Production must keep `OPENROUTER_DATA_COLLECTION=deny`.
- Paid calls and credit purchases need the owner's explicit approval.
- Automated tests must never make paid calls; `tests/conftest.py` blocks non-loopback DNS.

## Contract sync (`packages/ai-model-contracts`)
`src/karen_ai/contracts.py` mirrors `packages/ai-model-contracts/src/index.ts`. On any wire change:
1. Change the Zod schema and bump `CONTRACT_VERSION` there (owned by the TS side).
2. Mirror it in `contracts.py` (strict, `extra="forbid"`, optional ≠ nullable) incl. the version literal.
3. Update `packages/ai-model-contracts/fixtures/*.json`; if the example registry changes, copy it to
   `config/model-registry.mock.json` (a test asserts byte equality).
4. `tests/contract/test_shared_fixtures.py` and the TS tests must both pass.

## Commands (run from apps/ai-service)
```
uv sync                      # install (uv.lock is committed; use --frozen in CI)
uv run karen-ai-dev          # reload server on AI_SERVICE_PORT (default 8100), mock gateway
uv run karen-ai-serve        # production entry (0.0.0.0, no reload)
uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run pytest
uv run python -m karen_ai.evaluation.run_golden ../../evals/golden-cases
docker build -t karen/ai-service:dev .
```
