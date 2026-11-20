# Runbook — PostgreSQL outage

All authenticated routes and auth flows return 5xx/503 (nothing is authorised from cache — by design). Liveness stays green; readiness reports `database: down`, so the ALB stops routing.

1. Check RDS status/failover; connection-pool metrics (`db.client.connection.*`).
2. Data-rights workflows keep retrying with backoff (Temporal) — no action; they resume when the API recovers.
3. After failover, verify: `pnpm --filter @karen/api db:migrate:status` (no drift), sign-in smoke test, `GET /v1/me` with an existing session.
