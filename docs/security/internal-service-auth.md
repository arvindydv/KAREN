# Internal service authentication

See ADR-0007 for the decision. Implementation:

- Signer (TS): `@karen/domain/node` → `internalRequestSigningString`, `signTimestamped`; used by `apps/api/src/infrastructure/ai/ai-service.client.ts`.
- Verifier (Python): `apps/ai-service/src/karen_ai/core/internal_auth.py`, applied to every `/internal/*` route.
- Shared vectors: `packages/test-fixtures/fixtures/internal-auth/signature-vectors.json` (TEST-ONLY secret).

Headers: `x-karen-signature: t=<unix seconds>,v1=<hex>`, `x-karen-caller: <service>`, `x-request-id`.
Signed message: `<t>.<METHOD>\n<path?query>\n<sha256 hex of raw body bytes>`; tolerance 300 s.

Replay protection (ADR-0013): after a signature verifies, POST/PUT/PATCH/DELETE requests claim it in Redis (`SET NX EX 601`, key `karen:internal-auth:seen:<sig>`); a second use is rejected with 401. If Redis is unreachable the request is refused (503, retryable). Callers re-sign every attempt, so retries are unaffected.

Limitations: one shared secret for all callers — `x-karen-caller` is informational, not authenticated. Per-caller keys (or mTLS / IAM-signed requests) are the follow-up when a caller with lower trust appears.

## Rotation runbook (zero downtime)

1. Generate a new ≥32-char random secret (e.g. `openssl rand -hex 32`). Never paste it into tickets or chat.
2. ai-service (verifier): set `INTERNAL_SERVICE_HMAC_SECRET_PREVIOUS` = old value and `INTERNAL_SERVICE_HMAC_SECRET` = new value; deploy. It now accepts both keys.
3. Callers (api, voice-agent): update `shared/INTERNAL_SERVICE_HMAC_SECRET` to the new value; redeploy.
4. Confirm no `internal_auth_rejected` spikes; after ≥ 10 minutes remove `INTERNAL_SERVICE_HMAC_SECRET_PREVIOUS` and redeploy ai-service.
5. Record the rotation (date, operator) in the audit/ops log. Rotate on staff departure, suspected exposure, or at least every 180 days.

Note: in Terraform the verifier and callers currently share one Secrets Manager entry (`shared/INTERNAL_SERVICE_HMAC_SECRET`); during step 2 the ai-service task definition must inject the previous value from a temporary secret. Splitting into a verifier-side secret is a small Terraform change to make before the first rotation.
