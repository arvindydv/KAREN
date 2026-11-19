# Repository structure

```text
karen/
├── apps/
│   ├── api/               NestJS 12 + Fastify BFF; Prisma schema/migrations; OpenAPI emitter
│   ├── ai-service/        Python 3.12 FastAPI (uv): ModelRouter, gateway clients, LangGraph, evals
│   ├── temporal-worker/   Responsibility Engine workflows (karen-tasks)
│   ├── provider-worker/   Provider adapters (karen-provider-ops) + signed webhook ingress
│   ├── voice-agent/       Python LiveKit worker (uv) — pilot foundation
│   ├── web/               Next.js 16 public site + authenticated app shell
│   ├── admin/             Next.js 16 staff console shell
│   └── mobile/            Expo SDK 58 / React Native 0.88 / Expo Router
├── packages/
│   ├── types/             branded IDs, Money (minor units), Result, AppEnvironment
│   ├── domain/            task state machine, risk policy, approvals, provider contract, workflow contracts; ./node crypto helpers
│   ├── config/            zod env loading (fail-fast), shared env fragments, public-env guard
│   ├── api-contracts/     public API zod schemas, committed OpenAPI doc, generated typed client
│   ├── ai-model-contracts/ route tiers, capability registry schema, internal AI wire contract + shared fixtures
│   ├── observability/     pino logger w/ redaction + correlation, pseudonymisation, optional OTel/Sentry
│   ├── ui/                platform-neutral design tokens (+ generated CSS vars) and web primitives
│   ├── test-fixtures/     synthetic users, signed webhook fixtures, signature test vectors
│   ├── eslint-config/     flat config + boundary rules
│   └── typescript-config/ strict base configs
├── infra/
│   ├── docker/            node-service + nextjs Dockerfiles, Postgres init SQL
│   ├── terraform/         modules/ + environments/{dev,staging,production}
│   └── observability/     local OTel collector config
├── evals/                 golden cases, graders, datasets (synthetic)
├── scripts/               cross-platform Node scripts (dev runner, guards, terraform validate, k6 load harness)
├── docs/                  architecture, adr, security, database, gateway, integrations, development, runbooks, api
├── .github/               CI + gated deploy workflow, PR template
├── docker-compose.yml     local Postgres+pgvector, Redis, Temporal (+ optional OTel collector)
└── CLAUDE.md, CONTRIBUTING.md, README.md
```
