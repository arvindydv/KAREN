# Environment variable reference (canonical)

Each service reads **its own** `apps/<service>/.env` locally (`pnpm setup:env` copies every `.env.example`). Deployed environments inject variables from ECS task definitions and AWS Secrets Manager (see infra/terraform). Columns: **L** = needed for local dev, **P** = required in dev/staging/production, **S** = secret (Secrets Manager only).

## Shared

| Variable                                  | Services                       | L               | P             | S       | Notes                                                                             |
| ----------------------------------------- | ------------------------------ | --------------- | ------------- | ------- | --------------------------------------------------------------------------------- |
| `APP_ENV`                                 | all                            | default `local` | ✓             |         | `local\|test\|dev\|staging\|production`; **must be explicit** in container images |
| `KAREN_DEPLOYED_ARTIFACT`                 | all (baked into images)        |                 | set by image  |         | `true` ⇒ missing `APP_ENV` fails startup (ADR-0013)                               |
| `INTERNAL_SERVICE_HMAC_SECRET_PREVIOUS`   | ai-service (verifier)          |                 | rotation only | ✓       | also accepted during key rotation (runbook)                                       |
| `LOG_LEVEL`                               | all                            |                 |               |         | default `info`                                                                    |
| `INTERNAL_SERVICE_HMAC_SECRET`            | api, ai-service, voice-agent   | optional        | ✓ (≥32 chars) | ✓       | ADR-0007                                                                          |
| `LOG_PSEUDONYMIZATION_KEY`                | api (+ accepted by ai-service) | optional        | ✓             | ✓       | HMAC key for `user_ref`                                                           |
| `OTEL_EXPORTER_OTLP_ENDPOINT`             | all                            | optional        | recommended   |         | absent → tracing off                                                              |
| `OTEL_SERVICE_NAME`                       | python services                |                 |               |         | defaults per service                                                              |
| `SENTRY_DSN`, `SENTRY_TRACES_SAMPLE_RATE` | TS services, python            | optional        | recommended   | ✓ (DSN) | absent → off                                                                      |

## api

| Variable                                                                                                | L                             | P                       | S       | Notes                                                                                                             |
| ------------------------------------------------------------------------------------------------------- | ----------------------------- | ----------------------- | ------- | ----------------------------------------------------------------------------------------------------------------- |
| `API_PORT`                                                                                              |                               |                         |         | 4100                                                                                                              |
| `API_PUBLIC_BASE_URL`                                                                                   |                               | ✓                       |         |                                                                                                                   |
| `API_CORS_ALLOWED_ORIGINS`                                                                              | ✓                             | ✓                       |         | comma list; `*` forbidden when deployed                                                                           |
| `API_BODY_LIMIT_BYTES`                                                                                  |                               |                         |         | default 1 MiB                                                                                                     |
| `API_RATE_LIMIT_PER_MINUTE`                                                                             |                               |                         |         | per client, Redis-backed, ≤ 10000; degrades to per-process if Redis is down                                       |
| `API_SENSITIVE_RATE_LIMIT_PER_MINUTE`                                                                   |                               |                         |         | default 10; `@SensitiveRateLimit()` routes; **fails closed** (503) if Redis is down                               |
| `API_TRUSTED_PROXY_HOPS`                                                                                |                               | ✓                       |         | default 1 (ALB); 2 for Cloudflare → ALB (Terraform sets 2)                                                        |
| `API_DOCS_ENABLED`                                                                                      |                               |                         |         | must be false in production                                                                                       |
| `DATABASE_URL`, `DATABASE_POOL_MAX`                                                                     | ✓                             | ✓                       | ✓ (URL) | per-service DB role in AWS                                                                                        |
| `MIGRATION_DATABASE_URL` (api, Prisma CLI only; schema-owner role — never given to the running service) | ✓                             | ✓ (migration task)      |         | runtime `DATABASE_URL` is the non-owner RLS-bound role                                                            |
| `SHADOW_DATABASE_URL`                                                                                   | for drift check               |                         |         | never a real DB                                                                                                   |
| `REDIS_URL` **or** `REDIS_HOST`/`REDIS_PORT`/`REDIS_TLS`/`REDIS_AUTH_TOKEN`                             | ✓                             | ✓                       | token ✓ | ADR-0011                                                                                                          |
| `AUTH_MODE`                                                                                             | `local-dev`                   | `first-party`           |         | `local-dev` (adds `POST /dev/auth/token`) refused outside local/test                                              |
| `ACCESS_TOKEN_SIGNING_KEYS` (secret), `ACCESS_TOKEN_CURRENT_KID`                                        | ephemeral key                 | ✓ (Secrets Manager)     |         | JSON array of EC P-256 private JWKs; keep the previous kid for one access-token lifetime when rotating (ADR-0016) |
| `ACCESS_TOKEN_TTL_SECONDS`, `REFRESH_TOKEN_TTL_DAYS`                                                    | `600`, `30`                   |                         |         | mobile access/refresh lifetimes                                                                                   |
| `WEB_SESSION_IDLE_HOURS`, `WEB_SESSION_ABSOLUTE_DAYS`                                                   | `24`, `30`                    |                         |         | web session idle (sliding) and absolute lifetimes                                                                 |
| `LOGIN_MAX_FAILURES`                                                                                    | `10`                          |                         |         | failed sign-ins per e-mail per 15 min before a cool-down (Redis, fail closed)                                     |
| `PASSWORD_PEPPERS` (secret), `PASSWORD_PEPPER_CURRENT_ID`                                               | unset                         | ✓ (Secrets Manager)     |         | `id:base64url` list, each ≥ 32 bytes; required when deployed (ADR-0015)                                           |
| `OTP_HMAC_KEY` (secret)                                                                                 | unset (local key)             | ✓ (Secrets Manager)     |         | ≥ 32 chars; HMAC for one-time-code verifiers (ADR-0018)                                                           |
| `EMAIL_TRANSPORT`                                                                                       | `memory`                      | `brevo-smtp` (enforced) |         | `memory` refused when deployed                                                                                    |
| `BREVO_SMTP_LOGIN`, `BREVO_SMTP_KEY` (secret), `EMAIL_FROM`                                             |                               | ✓ (Secrets Manager)     |         | required when `EMAIL_TRANSPORT=brevo-smtp`; `EMAIL_FROM` must be a Brevo-verified sender                          |
| `BREVO_SMTP_HOST`, `BREVO_SMTP_PORT`                                                                    | `smtp-relay.brevo.com`, `587` |                         |         | STARTTLS required (465 = implicit TLS)                                                                            |
| `EMAIL_SEND_LIMIT_PER_HOUR`                                                                             | `5`                           |                         |         | auth e-mails per address per hour (Redis, fail closed)                                                            |
| `PASSWORD_HASH_MAX_CONCURRENCY`, `PASSWORD_HASH_MAX_QUEUE`, `PASSWORD_HASH_QUEUE_TIMEOUT_MS`            | `4`, `64`, `2000`             |                         |         | Argon2id DoS bound per process; saturation → retryable 503                                                        |
| `AI_SERVICE_URL`                                                                                        | ✓                             | ✓                       |         | internal DNS in AWS                                                                                               |
| `KAREN_EXECUTION_PAUSED`                                                                                |                               |                         |         | global kill switch for new executions                                                                             |

## ai-service (see apps/ai-service/.env.example for defaults)

`AI_SERVICE_PORT`, `AI_GATEWAY_BASE_URL`, `AI_GATEWAY_API_KEY` (S, live only), `KAREN_AI_GATEWAY_MODE` (`mock` locally), `KAREN_MODEL_{ECONOMY,BALANCED,BALANCED_FALLBACK,REASONING,VISION,EMBEDDING,RERANKING,AUDIO}`, `KAREN_MODEL_REGISTRY_PATH`, `KAREN_AI_MAX_OUTPUT_TOKENS`, `KAREN_AI_REQUEST_TIMEOUT_SECONDS`, `KAREN_AI_MAX_RETRIES`, `KAREN_AI_MAX_REQUEST_COST_USD`, `KAREN_AI_DAILY_BUDGET_USD`, `KAREN_AI_ALLOW_DIRECT_PROVIDER_FALLBACK` (must stay false), `KAREN_AI_BUDGET_STORE` (`memory` default in local/test; **`redis` required** in dev/staging/production), `REDIS_URL` **or** `REDIS_HOST`/`REDIS_PORT`/`REDIS_TLS`/`REDIS_AUTH_TOKEN` (S) (shared daily budget + replay cache, required when deployed), `KAREN_FEATURE_{VISION,EMBEDDING,RERANKING,AUDIO}_ENABLED`, `LANGFUSE_PUBLIC_KEY`/`LANGFUSE_SECRET_KEY` (S)/`LANGFUSE_HOST` (accepted; SDK not yet wired).
**Where to get real values:** Vercel dashboard → AI Gateway → API keys; model slugs and prices from https://vercel.com/ai-gateway/models after verification (docs/gateway).

## voice-agent

`LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` (S; from LiveKit Cloud project settings), `VOICE_AGENT_HEALTH_PORT`, `KAREN_FEATURE_AUDIO_ENABLED`, `KAREN_MODEL_AUDIO`, `KAREN_MODEL_REGISTRY_PATH`, `AI_SERVICE_URL`.

## temporal-worker / provider-worker

`TEMPORAL_ADDRESS` (`localhost:7233` locally; Temporal Cloud endpoint deployed), `TEMPORAL_NAMESPACE`, `TEMPORAL_TLS_ENABLED` (must be true in staging/production), `TEMPORAL_API_KEY` (S, Temporal Cloud), `TEMPORAL_WORKER_HEALTH_PORT` (4300), `TEMPORAL_MAX_CONCURRENT_ACTIVITIES`, `TEMPORAL_MAX_CONCURRENT_WORKFLOW_TASKS`; provider-worker also `PROVIDER_WORKER_PORT` (4200), Redis vars, `MOCK_PROVIDER_WEBHOOK_SECRET` (local/test/dev only; real providers get their own per-provider secrets).

## web / admin / mobile (PUBLIC — compiled into bundles)

`NEXT_PUBLIC_APP_ENV`, `NEXT_PUBLIC_API_BASE_URL`, `EXPO_PUBLIC_APP_ENV`, `EXPO_PUBLIC_API_BASE_URL`, `APP_VARIANT` (mobile build flavour). `pnpm check:env-public` fails CI if a public variable name looks secret.

## docker-compose (local only)

Postgres `karen` / `karen_local_only` — a fixed, local-only credential bound to 127.0.0.1.
