# 0003 — Canonical task state machine

- Status: Accepted · Date: 2026-11-19

## Context

The architecture document (§4) and the product specification (§10 TASK-03) define **different** state vocabularies. The architecture lists names (`NEEDS_INFORMATION`, `PROPOSED`, `WAITING_APPROVAL`, `APPROVED`, `EXECUTING`, `AWAITING_PROVIDER`, `CANCELLING`, `CANCELLED_VERIFIED`, `FAILED_RECOVERABLE`, `RECOVERING`); the product spec defines states **and transitions and terminal states** (`AWAITING_USER_INPUT`, `AWAITING_APPROVAL`, `READY_TO_EXECUTE`, `IN_PROGRESS`, `AWAITING_EXTERNAL_SERVICE`, `RECOVERY_IN_PROGRESS`, `BLOCKED`, `PAUSED`, `CANCEL_REQUESTED`, `FAILED`…). Two vocabularies in code would be a correctness hazard.

## Decision

`packages/domain/src/task-state.ts` is the single source. It adopts the product spec's states and edges (it is the only one with a transition table) and keeps `ARCHITECTURE_STATE_ALIASES` for traceability. Gaps in the spec were resolved conservatively:

- `RESEARCHING / PLANNING` → one state `PLANNING`.
- `EXPIRED` is non-terminal and can only go back to `PLANNING` (fresh approval) or be cancelled.
- Direct `→ CANCELLED` is allowed only from pre-execution states; anything in flight must go through `CANCEL_REQUESTED` (provider reconciliation first).
- Resuming from `PAUSED` can never jump to `IN_PROGRESS`; executing work resumes via `RECOVERY_IN_PROGRESS`.
- `COMPLETED_VERIFIED` requires evidence IDs; `AWAITING_APPROVAL → READY_TO_EXECUTE` requires an approval ID; every transition requires the expected version (optimistic concurrency).

## Consequences

Product owners should confirm the three gap resolutions above. Changing the machine is a contract change (domain tests + workflow tests must be updated together).
