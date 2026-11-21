# Authentication performance benchmark (Phase 01 M10)

Script: `apps/api/scripts/bench-auth.mjs` (boots the built API in-process on a local port; real
PostgreSQL 17 + Redis from `pnpm infra:up`; e-mail captured in memory; generous rate limits so the
limiter does not dominate). Client and server share one Node process, so CPU numbers include both.

**Environment (both runs):** developer laptop — AMD Ryzen 7 8840U (16 logical CPUs), 15 GiB RAM,
Node v24.4.1, `UV_THREADPOOL_SIZE`=4 (default), password-hash gate 4, Argon2id m=64 MiB t=3 p=1,
DB pool 10, Docker PostgreSQL/Redis on the same machine. **NOT production hardware.**

## Run A — unloaded latency (concurrency 1)

| Operation                                     | n   | p50     | p95     | p99     | Throughput | Budget (p95, design doc §10) | Result |
| --------------------------------------------- | --- | ------- | ------- | ------- | ---------- | ---------------------------- | ------ |
| Login (Argon2id + session)                    | 200 | 55.7 ms | 63.0 ms | 73.0 ms | 18/s       | ≤ 300 ms                     | met    |
| Session validation (`GET /v1/me`, access JWT) | 200 | 3.2 ms  | 4.6 ms  | 11.8 ms | 289/s      | ≤ 10 ms                      | met    |
| Profile read                                  | 200 | 3.3 ms  | 4.9 ms  | 8.6 ms  | 287/s      | ≤ 30 ms                      | met    |
| Token refresh (rotation)                      | 100 | 4.8 ms  | 6.3 ms  | 34.2 ms | 187/s      | ≤ 50 ms                      | met    |
| Consent check (service call)                  | 200 | 0.7 ms  | 1.2 ms  | 4.9 ms  | 1204/s     | ≤ 10 ms                      | met    |

## Run B — loaded (concurrency 16)

| Operation          | n   | p50      | p95      | p99      | Throughput | Notes                                                                   |
| ------------------ | --- | -------- | -------- | -------- | ---------- | ----------------------------------------------------------------------- |
| Login              | 200 | 469.8 ms | 644.6 ms | 678.3 ms | 32/s       | queueing at the deliberate 4-hash gate; capacity-bound, not a slow path |
| Session validation | 400 | 38.3 ms  | 59.5 ms  | 84.5 ms  | 393/s      | single process; DB pool 10                                              |
| Profile read       | 400 | 34.3 ms  | 47.7 ms  | 50.2 ms  | 453/s      |                                                                         |
| Token refresh      | 200 | 37.1 ms  | 48.8 ms  | 53.0 ms  | 429/s      |                                                                         |
| Consent check      | 400 | 6.7 ms   | 11.2 ms  | 15.2 ms  | 2237/s     |                                                                         |

Peak RSS ≈ 490 MiB (client + server). 0 failures in all runs.

## Interpretation

- Per-request costs meet every proposed budget. Under load, **login throughput per process
  (~32/s here) is bounded by Argon2id by design**; scale horizontally (more tasks) rather than
  weakening parameters. Size tasks for ≈ 256 MiB of hashing memory at the default gate.
- Session validation is one PostgreSQL transaction; under 16-way load p95 rises to ~60 ms in a
  single process with a 10-connection pool. Before adding any cache (which must not weaken
  revocation), measure on the target task size with realistic pool sizing.
- **NOT VERIFIED:** ECS/Fargate task sizes, RDS latency, multi-task scaling, burst after an app
  release, Redis/RDS failover under load. These need the staging environment (Phase 00 gate).
