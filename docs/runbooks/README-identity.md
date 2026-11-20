# Identity & privacy runbooks (Phase 01)

| Situation                                         | Runbook                                                            |
| ------------------------------------------------- | ------------------------------------------------------------------ |
| Leaked key/secret, mass sign-out                  | [credential-compromise.md](credential-compromise.md)               |
| Credential stuffing / sign-in spike               | [suspicious-login-spike.md](suspicious-login-spike.md)             |
| Redis down                                        | [redis-outage.md](redis-outage.md)                                 |
| PostgreSQL down                                   | [postgres-outage.md](postgres-outage.md)                           |
| E-mail (Brevo) down                               | [email-outage.md](email-outage.md)                                 |
| Unexpected sign-outs / revocation bugs            | [session-revocation-incident.md](session-revocation-incident.md)   |
| Suspend / lock a consumer account                 | [emergency-account-suspension.md](emergency-account-suspension.md) |
| Staff account compromise / lost key / break-glass | [staff-account-compromise.md](staff-account-compromise.md)         |
| Export / deletion workflow stuck                  | [data-deletion-failures.md](data-deletion-failures.md)             |

## Alerting recommendations (NOT yet configured — needs the monitoring stack in staging)

| Alert                  | Condition (suggested starting point)                                                         |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| Credential stuffing    | `karen.auth.login{outcome="invalid_credentials"}` > 10× 7-day baseline for 10 min            |
| Hash saturation        | `karen.auth.hash_saturated` > 0 for 5 min                                                    |
| Refresh theft signals  | `karen.auth.refresh{outcome=~"refresh_reuse                                                  | device_mismatch"}` > baseline + 3σ |
| E-mail failing         | `karen.mail.delivery{outcome!="sent"}` / total > 5 % for 15 min                              |
| Staff authz denials    | any `karen.staff.authz_denied{reason="missing_permission"}` burst > 20 in 10 min             |
| Staff sign-in failures | `karen.staff.login{outcome!="success"}` > 5 in 15 min for any account (from audit)           |
| Deletion overdue       | `privacy.deletion.requested` without `privacy.deletion.completed` 24 h after `scheduled_for` |
| Auth dependency        | readiness `redis` or `database` down > 2 min                                                 |
