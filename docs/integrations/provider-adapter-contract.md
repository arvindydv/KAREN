# Provider adapter contract

Code: `packages/domain/src/provider.ts` (descriptor schema), `apps/provider-worker/src/adapters/` (contract, registry, SANDBOX mock).

## Descriptor (validated at registration — invalid adapters cannot be loaded)

`id, displayName, environment (SANDBOX|PRODUCTION), legalAccess (CONTRACTED|PUBLIC_API_TERMS|SANDBOX_ONLY|NOT_APPROVED), capabilities[{capability, idempotencySupport, requiredApproval, userActionRequired}], supportedGeographies, allowedAuthMethods, dataResidency, rateLimitPerMinute, webhookSignature`.
Rules enforced: side-effecting capabilities (`reserve|confirm|cancel|refund`) must require approval and declare an idempotency strategy, and are forbidden for `NOT_APPROVED` providers; `webhook` requires signature validation; no duplicate capabilities; unknown fields rejected. Sandbox adapters are refused outside `local|test|dev`.

## Runtime rules

- The registry only dispatches **declared and implemented** capabilities (`ProviderCapabilityUnavailableError` otherwise). Search-only providers can never confirm.
- Side-effecting calls are idempotent on the workflow-supplied key. Ambiguous outcomes throw `ProviderAmbiguousError` → workflow reconciles via `status`.
- Responses carry provenance (`fetchedAt`, `ttlSeconds`, `source`, `legalAccess`, `environment`). SANDBOX references start with `SANDBOX-`.
- Webhooks: raw-body HMAC verification → replay guard → sink. A webhook is a hint; completion still needs the status API.

## Adding a real provider (gate checklist, architecture §15)

Legal/API access, sandbox, documented API, quotas, SLA, webhook + idempotency semantics, failure codes, refund handling, data retention, commercial terms, escalation contact. Then: descriptor + adapter + contract tests against the provider sandbox (separate from mock tests) + ADR.
