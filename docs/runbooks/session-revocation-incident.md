# Runbook — session revocation incidents

**"Users are being signed out unexpectedly"**

- `karen.auth.refresh{outcome="refresh_reuse"|"device_mismatch"}` spike → usually a mobile client bug calling refresh concurrently without single-flight, or restoring an old token after reinstall. The server revoked those sessions on purpose (theft defence). Fix the client; do not widen the 10 s retry window without an ADR.
- `karen.auth.session_revoked{reason="account_status"}` → staff/operator status changes.

**"A revoked session still works"** (security incident): sessions are checked in PostgreSQL on every request; reproduce with `GET /v1/me`, inspect `identity.sessions` for that id (`revoked_at`). Escalate as a security bug.

**Revoke everything for one user:** `account:status --to LOCKED` (user recovers via password reset), or have the user use "Sign out everywhere".
