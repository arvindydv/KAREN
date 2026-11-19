# Developer onboarding (Linux & macOS)

## Prerequisites

- Node **24** (`.nvmrc`) with Corepack; pnpm is pinned via `packageManager`.
- **uv** ≥ 0.9 (installs Python 3.12 automatically for the Python services).
- Docker with Compose v2.
- Optional: Terraform ≥ 1.11 (infra), Xcode / Android Studio (native mobile builds), k6 or Docker (load tests).

## First run

```bash
corepack enable
pnpm install                     # frozen by lockfile in CI
pnpm setup:env                   # creates apps/*/.env from .env.example (never overwrites)
uv sync --project apps/ai-service
uv sync --project apps/voice-agent   # optional
pnpm infra:up                    # Postgres+pgvector, Redis, Temporal (waits for health)
pnpm db:migrate:deploy           # apply migrations
pnpm db:seed                     # synthetic users (dev|asha-0001, dev|rohan-0002, dev|ops-0003)
pnpm dev:core                    # api :4100, ai-service :8100, temporal-worker, provider-worker
```

No AI gateway, LiveKit, AWS or IdP credentials are required: the AI service runs in **mock** mode and the API uses the **local-dev** token issuer.

Try it:

```bash
curl localhost:4100/health/ready
TOKEN=$(curl -s -XPOST localhost:4100/dev/auth/token -H 'content-type: application/json' \
  -d '{"subject":"dev|ops-0003"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).access_token')
curl -H "authorization: Bearer $TOKEN" localhost:4100/v1/me
curl -H "authorization: Bearer $TOKEN" localhost:4100/v1/admin/system/status
```

Swagger UI: http://localhost:4100/docs · Temporal UI: http://localhost:8233

## Per-surface commands

| Task                              | Command                                                                                                                                                        |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web / Admin                       | `pnpm dev:web` (3000) · `pnpm dev:admin` (3001)                                                                                                                |
| Mobile                            | `pnpm dev:mobile` (dev client) · `pnpm --filter @karen/mobile start:go` (Expo Go)                                                                              |
| API only                          | `pnpm dev:api`                                                                                                                                                 |
| AI service                        | `pnpm dev:ai`                                                                                                                                                  |
| Temporal worker / Provider worker | `pnpm dev:temporal-worker` · `pnpm dev:provider-worker`                                                                                                        |
| Voice worker                      | `pnpm dev:voice` (needs LiveKit credentials; exits with a clear message otherwise)                                                                             |
| Migrations                        | `pnpm db:migrate` (create) · `pnpm db:migrate:deploy` · `pnpm db:migrate:status` · `pnpm db:reset`                                                             |
| Contracts                         | `pnpm contracts:generate` · `pnpm contracts:check`                                                                                                             |
| Lint / typecheck / tests          | `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm test:integration` (needs infra) · `pnpm test:e2e:web`                                                     |
| Python                            | `pnpm lint:py` · `pnpm typecheck:py` · `pnpm test:py` · `pnpm evals`                                                                                           |
| Build                             | `pnpm build`                                                                                                                                                   |
| Everything (TS)                   | `pnpm verify` · Python: `pnpm verify:py`                                                                                                                       |
| Infrastructure                    | `pnpm infra:validate` (fmt + validate + offline tests; never plans/applies)                                                                                    |
| Load baseline                     | `docker run --rm --network host -i grafana/k6:1.4.2 run - < scripts/load/api-baseline.k6.js` (raise `API_RATE_LIMIT_PER_MINUTE` first; 429s count as failures) |

## Troubleshooting

- Port clash: see [ports.md](ports.md).
- `ERR_PNPM_NO_MATURE_MATCHING_VERSION`: the 7-day release-age policy (ADR-0010) — pin the newest mature version.
- Prisma client missing: `pnpm db:generate` (turbo runs it before api tasks).
- Temporal container unhealthy on first start: `docker compose logs temporal`; volume ownership is fixed by `temporal-volume-init`.
