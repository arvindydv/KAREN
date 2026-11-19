# Local ports

All host ports bind to 127.0.0.1 and avoid common defaults so KAREN can run beside other projects.

| Service                           | Port        | Notes                                                                         |
| --------------------------------- | ----------- | ----------------------------------------------------------------------------- |
| web (Next.js dev)                 | 3000        | Playwright smoke uses 3100                                                    |
| admin (Next.js dev)               | 3001        |                                                                               |
| api (NestJS)                      | 4100        | Swagger UI at `/docs` when `API_DOCS_ENABLED=true`                            |
| provider-worker                   | 4200        | `/health/*`, `/webhooks/:providerId`                                          |
| temporal-worker health            | 4300        | `/health/live`, `/health/ready`                                               |
| PostgreSQL (docker)               | 5442 → 5432 | user `karen` / local-only password; DBs `karen`, `karen_test`, `karen_shadow` |
| Redis (docker)                    | 6390 → 6379 | DB 0 api, 1 api tests, 2 provider-worker                                      |
| Temporal frontend (docker)        | 7233        |                                                                               |
| Temporal UI (docker)              | 8233        | http://localhost:8233                                                         |
| Expo Metro                        | 8081        |                                                                               |
| ai-service                        | 8100        |                                                                               |
| voice-agent health                | 8200        |                                                                               |
| OTel collector (optional profile) | 4318        | `docker compose --profile observability up -d`                                |
