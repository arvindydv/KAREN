# Runbook: provider outage or misbehaviour

Scope: provider-worker adapters and the Temporal action workflow. Today only the SANDBOX mock
provider exists; this runbook applies unchanged to real adapters.

## Built-in safety (verified by tests)

- Side effects are dispatched once per stable idempotency key; a timeout or ambiguous response
  raises `ProviderAmbiguousError` → the workflow **reconciles via the provider status API**
  before anything else and never blindly retries the side effect.
- Status checks retry (up to 10 attempts, max interval 1 min). If the outcome still cannot be
  verified the task ends `ESCALATED` — never "completed".
- Expired legal access (`legalAccessExpiresAt`) blocks side effects automatically.
- The kill switch `KAREN_EXECUTION_PAUSED=true` on provider-worker refuses every side effect
  before contacting the provider (workflow → `ESCALATED`, nothing dispatched).

## Actions

| Situation                                                      | Action                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider down / timing out                                     | Usually no action: workflows escalate instead of duplicating. If volume is high, set `KAREN_EXECUTION_PAUSED=true` on api and provider-worker to stop new attempts.                                                                                                    |
| Provider returning wrong results / suspected duplicate charges | Pause execution immediately (both services). Remove the adapter from the registry (deploy) so workflows fail with `CAPABILITY_UNAVAILABLE`. Reconcile every operation started in the window via the provider's status API using the idempotency keys from task events. |
| Contract/terms lapsed                                          | Update `legalAccessExpiresAt`/`legalAccess` in the descriptor; side effects are refused automatically.                                                                                                                                                                 |
| Resume                                                         | Only after reconciliation of all `ESCALATED` tasks in the window and confirmation from the provider. Unset `KAREN_EXECUTION_PAUSED`, redeploy, watch the first operations.                                                                                             |

Every user-visible task must end verified-completed, cancelled, or visibly escalated with a
human follow-up (task safety contract §2.2).
