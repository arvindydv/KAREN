# Public API

- Contract source: zod schemas in `packages/api-contracts/src`.
- Generated OpenAPI 3.0 document (committed): `packages/api-contracts/openapi/karen-api.v1.json`.
- Generated TypeScript client: `createKarenApiClient` from `@karen/api-contracts/client` (used by web, admin, mobile).
- Interactive docs (local only): http://localhost:4100/docs.

| Endpoint                      | Auth                | Notes                                                              |
| ----------------------------- | ------------------- | ------------------------------------------------------------------ |
| `GET /health/live`            | public              | process liveness only                                              |
| `GET /health/ready`           | public              | 200 when PostgreSQL + Redis up; reports ai-service as non-critical |
| `GET /v1/me`                  | bearer              | resolves/provisions the identity mapping; roles from DB            |
| `GET /v1/admin/system/status` | bearer + `ops:read` | audited                                                            |
| `POST /dev/auth/token`        | local/test only     | not in OpenAPI; refused by config elsewhere                        |

Errors always use `{ "error": { code, message, correlation_id, retryable, next_options?, details? } }`; `correlation_id` equals the `x-request-id` response header.
