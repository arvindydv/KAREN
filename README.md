# KAREN

**Your life. Understood. Taken care of.** — a permission-based, accountable personal AI life agent (India-first).

This repository is the engineering foundation: a pnpm/Turborepo TypeScript monorepo plus two uv-managed Python services, local infrastructure, contracts, security boundaries, CI and Terraform. Product features (auth UI, conversations, memory, Responsibility Engine endpoints) are built on top of it next.

- Architecture (source of truth): [karen_architecture.md](karen_architecture.md) · Product spec: [karen.md](karen.md)
- Summary & decisions: [docs/architecture/architecture-summary.md](docs/architecture/architecture-summary.md), [docs/adr](docs/adr/README.md)
- Onboarding: [docs/development/onboarding.md](docs/development/onboarding.md) · Env vars: [docs/development/environment-variables.md](docs/development/environment-variables.md) · Ports: [docs/development/ports.md](docs/development/ports.md)

## Quick start

```bash
corepack enable && pnpm install && pnpm setup:env
uv sync --project apps/ai-service
pnpm infra:up && pnpm db:migrate:deploy && pnpm db:roles && pnpm db:seed
pnpm dev:core          # api :4100 · ai-service :8100 · temporal-worker · provider-worker
pnpm dev:web           # :3000      pnpm dev:admin  # :3001      pnpm dev:mobile
```

No paid credentials are required locally (mock AI gateway, local-dev token issuer, sandbox provider).

## Layout

| Path                     | What                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `apps/api`               | NestJS 12 + Fastify BFF, Prisma (PostgreSQL 17 + pgvector), OIDC guards, OpenAPI                              |
| `apps/ai-service`        | Python FastAPI: ModelRouter → budget/policy → Vercel AI Gateway client (mock by default), LangGraph, evals    |
| `apps/temporal-worker`   | Responsibility Engine workflows (approval-gated, idempotent, verified)                                        |
| `apps/provider-worker`   | Provider adapter registry + signed webhook ingress (SANDBOX mock only)                                        |
| `apps/voice-agent`       | LiveKit worker foundation (audio NOT verified)                                                                |
| `apps/web`, `apps/admin` | Next.js 16 shells · `apps/mobile` Expo SDK 58 shell                                                           |
| `packages/*`             | types, domain, config, api-contracts, ai-model-contracts, observability, ui, test-fixtures, eslint/ts configs |
| `infra/`                 | Dockerfiles, Terraform (AWS ap-south-1; validated, never applied), observability                              |

## Capability matrix (honest status)

| Capability                                                                  | Status                                                        |
| --------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Local stack, migrations, auth guards, typed API client, workflows, webhooks | Working & tested locally                                      |
| Vercel AI Gateway inference                                                 | Mock-tested only — **live NOT VERIFIED**                      |
| Realtime voice (LiveKit + audio models)                                     | **NOT VERIFIED**                                              |
| Real sign-in (IdP)                                                          | Not chosen yet (local-dev issuer only)                        |
| Real providers / payments / bookings                                        | None (SANDBOX mock only)                                      |
| AWS deployment                                                              | Terraform validated offline; **nothing applied**              |
| Native mobile builds                                                        | JS bundles export for iOS/Android; native builds NOT VERIFIED |
