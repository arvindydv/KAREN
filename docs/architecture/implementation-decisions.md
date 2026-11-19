# Implementation decisions, inconsistencies and blockers

## Inconsistencies found between the source documents

| #   | Finding                                                                                                                                                     | Resolution                                                                                                                                                                            |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Two different task-state vocabularies (architecture §4 vs product §10).                                                                                     | One canonical machine in `@karen/domain` (ADR-0003) with an alias map. Three gap resolutions need product confirmation.                                                               |
| 2   | Repository layouts differ (architecture §13 `packages/api-contracts`, `domain`…; product §39 `packages/contracts`, `agent`, `provider-adapters`, `tests/`). | Followed the architecture layout (the brief's layout matches it). Provider adapters live in `apps/provider-worker` (one deployable owns them); agent code lives in `apps/ai-service`. |
| 3   | Product §25 suggests "Redis + durable job queue"; architecture mandates Temporal + outbox/SQS.                                                              | Temporal for durable work; outbox table created; Redis is never a queue of record.                                                                                                    |
| 4   | Architecture lists Prisma **or** Kysely.                                                                                                                    | Prisma (brief), with raw-SQL module for pgvector (ADR-0005).                                                                                                                          |
| 5   | File names in the brief differ from the repo (see architecture-summary).                                                                                    | Used the files present; recorded.                                                                                                                                                     |
| 6   | Architecture's audit fields include `user_id_hash` for model invocations; product spec has `usage_ledger`.                                                  | ai-service emits `ModelInvocationRecord` with pseudonymous `user_ref`; persistence table deferred to the AI-usage feature.                                                            |
| 7   | API idempotency (`client_request_id`) and provider idempotency are distinct concepts in the spec.                                                           | `platform.idempotency_records` (API) vs provider idempotency keys (`buildIdempotencyKey`).                                                                                            |

## Implementation blockers (external)

- **IdP not chosen** → no real sign-in (local-dev issuer only).
- **No Vercel AI Gateway credentials / verified model IDs** → live inference NOT VERIFIED; mock mode only.
- **No LiveKit credentials / devices** → realtime voice NOT VERIFIED.
- **No AWS account/credentials** → Terraform validated offline only; nothing planned/applied.
- **No approved provider contracts** → only the SANDBOX mock adapter exists.
- **Temporal Cloud namespace** not provisioned → only the local dev server is tested.

## Complexity deliberately avoided

No Kubernetes, Kafka, Qdrant, Neo4j, GPU, LiteLLM/OpenRouter, service mesh, or dedicated policy engine. Shared packages are limited to ones with real contents.

## Notable engineering decisions (details in ADRs)

- All-ESM TS, NestJS 12, TypeScript 6.0 pinned (ADR-0002).
- Wire format snake_case; zod-first OpenAPI generation; shared AI fixtures for TS↔Python (ADR-0006).
- HMAC-signed internal calls with cross-language vectors (ADR-0007).
- Readiness gates only on PostgreSQL + Redis; the AI service is reported as non-critical (most API routes work without it).
- Rate limiting is Redis-backed (multi-replica safe) and fails **open** on Redis errors; abuse-critical endpoints must add fail-closed limits.
- Sentry configured privacy-first (no bodies, cookies, user info, query strings, AI inputs/outputs) — Sentry v11 defaults are permissive.
- Supply chain: 7-day minimum release age (ADR-0010).

## Known gaps to close early

- `recordTaskTransition` logs only — real `task_events` persistence comes with the Tasks feature.
- AI daily budget tracker is per-process (needs Redis before scaling ai-service).
- Provider webhooks are verified and de-duplicated but only logged (`LoggingInboundEventSink`); inbox table + workflow signalling come with the Responsibility Engine.
- API image is ~750 MB (full `@prisma/client` + Nest deps); optimise later (prune, distroless).
