# 0009 — Temporal execution model

- Status: Accepted · Date: 2026-11-19

## Decision

- Local: Temporal CLI dev server (`temporalio/temporal:1.10.1 server start-dev`, SQLite volume) in docker-compose. Deployed: Temporal Cloud (TLS + API key); no self-hosted Temporal in Terraform.
- Task queues: `karen-tasks` (workflows + internal activities, `apps/temporal-worker`) and `karen-provider-ops` (provider adapter activities, `apps/provider-worker`). Contracts in `@karen/domain/workflows`.
- Workflow IDs `task:<taskId>:step:<stepId>` make duplicate starts fail rather than double-execute.
- Side-effecting provider calls: stable idempotency key per intent; `ProviderAmbiguousError` is **non-retryable** and the workflow reconciles via the status activity before anything else. `COMPLETED_VERIFIED` only with evidence; otherwise `ESCALATED`.
- Workflow code is lint-restricted from Node APIs/randomness; behaviour changes to running workflows require `patched()` (runbook).

## Consequences

`recordTaskTransition` currently logs metadata only; the Tasks feature replaces it with an append-only `task_events` write. Postgres remains the human-readable source of task state; Temporal is the durability mechanism.
