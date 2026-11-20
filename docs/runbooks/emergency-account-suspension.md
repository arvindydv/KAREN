# Runbook — emergency consumer-account suspension

Use for abuse, legal holds, or confirmed account takeover. Staff cannot suspend through the
admin console in Phase 01 (staff have status-read only); an operator runs:

```bash
pnpm --filter @karen/api account:status -- --user <uuid> --to SUSPENDED --reason abuse_report --operator <your-id>
# takeover suspected (user can recover via password reset):
pnpm --filter @karen/api account:status -- --user <uuid> --to LOCKED --reason suspected_compromise --operator <your-id>
```

Effects (same transaction): state-machine-checked status change, all sessions revoked, audit
event `identity.account.status_changed` with `actor_ref = operator:<id>`. Reinstate with
`--to ACTIVE`. Record the incident/ticket id in the change log — never personal data.
