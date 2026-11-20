# Runbook: provider webhook failures

Endpoint: `POST /webhooks/:providerId` on provider-worker (public hostname `webhooks_hostname`).
Webhooks are **hints**: workflows verify outcomes through the provider status API, so a lost or
delayed webhook delays completion but never fakes it.

## Behaviour (verified by tests)

| Response                      | Meaning                                                    | Provider will                        |
| ----------------------------- | ---------------------------------------------------------- | ------------------------------------ |
| 202 `accepted`                | Signature valid, first delivery, handed to the sink        | stop                                 |
| 200 `duplicate_ignored`       | Valid replay of an already-processed event id              | stop                                 |
| 400                           | Signed but malformed payload                               | stop (fix on our side)               |
| 401 `rejected`                | Bad/stale signature (timestamp tolerance)                  | retry — investigate                  |
| 404                           | Unknown provider or provider without webhook capability    | stop                                 |
| 503 `temporarily_unavailable` | Hand-off to the sink failed; the replay claim was released | retry → processed                    |
| 500                           | Replay guard (Redis) unavailable — fails closed            | retry → processed once Redis is back |

## Diagnose

- `provider.webhook.rejected` logs (reason only, never payloads): spike of `INVALID_SIGNATURE`
  ⇒ secret mismatch after rotation, clock skew, or spoofing attempts.
- `provider.webhook.sink_failed` ⇒ downstream (queue/event bus) problem.
- Redis health ⇒ replay guard availability.

## Actions

1. **Secret rotation mismatch:** confirm the provider's current signing secret matches
   `provider-worker/PROVIDER_WEBHOOK_SECRETS` in Secrets Manager; rotate on both sides, deploy.
2. **Spoofing / flood:** WAF rate rule on the webhook hostname; never disable signature checks.
3. **Sink outage:** fix the downstream; providers retry 503s. Events missed beyond the
   provider's retry window are recovered by status reconciliation, not by replaying webhooks.
4. **Clock skew:** check container time (NTP via Fargate); do not widen the tolerance.
