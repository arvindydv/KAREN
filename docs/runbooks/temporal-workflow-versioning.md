# Runbook: Temporal workflow versioning

- Workflow code must be deterministic (lint-enforced: no Node APIs, `Math.random`, timers, I/O).
- Changing the command sequence of a workflow that may have running executions requires `patched('<change-id>')` branches; deprecate with `deprecatePatch` after old executions drain, then remove.
- Prefer new workflow **types** (e.g. `actionExecutionWorkflowV2`) for large rewrites; route new starts to the new type.
- Activity input/output types are contracts (`@karen/domain/workflows`): add optional fields only.
- Replay test: before merging a workflow change, export histories of representative executions (`temporal workflow show --output json`) and replay them with `Worker.runReplayHistories` in a test.
- Timeouts: every activity has `startToCloseTimeout`; side-effecting activities have `nonRetryableErrorTypes` for ambiguous/rejected/capability errors.
