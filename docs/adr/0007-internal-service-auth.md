# 0007 — Internal service authentication

- Status: Accepted · Date: 2026-11-19

## Decision

Service-to-service HTTP calls (API → ai-service, voice-agent → ai-service) carry `x-karen-signature: t=<unix>,v1=<hex>` where hex = HMAC-SHA256(`INTERNAL_SERVICE_HMAC_SECRET`, `"<t>.<METHOD>\n<path?query>\n<sha256(body)>"`), plus `x-karen-caller` and `x-request-id`. Tolerance 300 s; constant-time compare. Cross-language test vectors live in `packages/test-fixtures/fixtures/internal-auth/` and both implementations are tested against them.

The secret is mandatory (≥32 chars) in dev/staging/production (fail-fast config). In local/test it may be unset, in which case the AI service accepts unsigned calls (documented local convenience).

## Consequences / follow-ups

Replay _within_ the window is possible for idempotent reads; ~~add a nonce cache if non-idempotent internal endpoints appear~~ → done: ADR-0013 adds a one-time-use signature cache (Redis, fail-closed) for POST/PUT/PATCH/DELETE and a previous-key rotation window. `x-karen-caller` is **not** covered by the signature (shared secret), so it identifies but does not authenticate the caller. Long-term options: per-caller secrets, mTLS via service mesh, or IAM-signed requests. Network policy (security groups) remains the first boundary.
