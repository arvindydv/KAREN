# Password hashing benchmark (Argon2id parameter selection)

Script: `apps/api/scripts/bench-password-hash.mjs` (`node scripts/bench-password-hash.mjs 20 4`).
Library: `@node-rs/argon2` 2.2.2 (reproduces the phc-winner-argon2 reference vector — unit test).

## Run 1 — 2026-11-20, developer laptop (NOT production hardware)

Environment: Node v24.4.1 · AMD Ryzen 7 8840U (16 logical CPUs) · 15 GiB RAM ·
`UV_THREADPOOL_SIZE` default (4). 20 sequential verifies per candidate; throughput at concurrency 4.

| Candidate                     | p50     | p95     | p99     | Throughput @4 | Memory / hash |
| ----------------------------- | ------- | ------- | ------- | ------------- | ------------- |
| OWASP m=19 MiB t=2 p=1        | 7.1 ms  | 8.2 ms  | 8.2 ms  | 250.1 / s     | 19 MiB        |
| OWASP m=46 MiB t=1 p=1        | 11.0 ms | 19.6 ms | 19.6 ms | 113.7 / s     | 46 MiB        |
| **RFC 9106 m=64 MiB t=3 p=1** | 41.7 ms | 43.5 ms | 43.5 ms | 41.0 / s      | 64 MiB        |
| RFC 9106 m=64 MiB t=3 p=4     | 21.6 ms | 23.0 ms | 23.0 ms | 46.3 / s      | 64 MiB        |

With 20 samples, p95/p99 are the slowest sample(s) and are indicative only.

## Decision (v1)

**m = 64 MiB, t = 3, p = 1.** Rationale: strongest candidate whose single-hash latency leaves room for
a ≤ 300 ms login p95 budget even if production vCPUs are 3–5× slower than this laptop; p=1 maps one
hash to one libuv thread, so `PASSWORD_HASH_MAX_CONCURRENCY` directly bounds CPU and memory
(4 × 64 MiB = 256 MiB peak per process). p=4 would halve latency but let one request occupy four
threads, making the gate's bound four times looser.

## Open (M10)

Re-run on the target ECS/Fargate task size, under concurrent login load, and record CPU, RSS and
login p50/p95/p99. If p95 exceeds the budget, prefer more tasks over weaker parameters; lowering
parameters requires a new ADR note and keeps old hashes verifying (versioned in the PHC string).
