# apps/temporal-worker — rules

- Workflow files (`src/workflows/**`) must be deterministic: no Node APIs, I/O, `Math.random`, timers or activity implementations (lint-enforced). Use `proxyActivities` with type-only imports.
- Every state change goes through `transitionTask` from `@karen/domain`; completion requires evidence.
- Side-effecting provider operations run on `TASK_QUEUES.PROVIDER_OPERATIONS` with a stable `buildIdempotencyKey(...)`. Ambiguous results are reconciled via status — never retried blindly.
- Changing running-workflow behaviour requires `patched()` (docs/runbooks/temporal-workflow-versioning.md).
- Tests: `pnpm test` (time-skipping test server; first run downloads the test server binary), `pnpm test:integration` (needs `pnpm infra:up`).
