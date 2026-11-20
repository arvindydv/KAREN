# Runbook — data-rights workflow failures (export / deletion)

**Signals:** `accountDeletionWorkflow` or `dataExportWorkflow` with repeated activity failures in
Temporal; API logs `Workflow start failed`; `privacy.deletion.requested` audit events without a
matching `privacy.deletion.completed` after `scheduled_for` + 1 day.

1. **Find the request** (operator, read-only):
   `SELECT id, kind, status, scheduled_for, completed_at FROM consent.data_rights_requests WHERE id = '<id>';`
   Never paste user data into tickets; use request ids.
2. **Workflow missing** (status `scheduled`/`requested`, no workflow `karen-data-<kind>-<id>`):
   the start failed. Ask the user to retry the action, or start it with the Temporal CLI using the
   same workflow id and `{ "requestId": "<id>", "waitSeconds": <seconds left> }` — duplicate
   starts are rejected, so this is safe.
3. **Activity failing 401**: signing secret mismatch between worker and API
   (`INTERNAL_SERVICE_HMAC_SECRET`) or clock skew > 5 min. Fix config; the workflow retries.
4. **Activity failing 4xx (non-retryable)**: the request was removed or is in an unexpected state;
   inspect, then terminate the workflow with a reason. Do not erase manually.
5. **`erase_user` raising `account is …`**: the account left `DELETION_REQUESTED` (e.g. a staff
   suspension). Resolve the account state with security, then either cancel the request (user
   decision) or re-run.
6. **Never** delete rows by hand; erasure must go through `identity.erase_user` so the retention
   record and audit stay complete. Escalate to the privacy owner for any deadline at risk.
