# 0020 — Data export and account deletion as durable workflows

- Status: Accepted · Date: 2026-11-20
- Related: ADR-0007 (internal service auth), ADR-0009 (Temporal), ADR-0019 (consent).

## Decision

1. **Requests are durable rows** (`consent.data_rights_requests`), at most one open request per
   (user, kind) by constraint; repeating a request returns the open one and re-attempts its
   workflow start (Temporal `REJECT_DUPLICATE` per request id).
2. **Workflows carry ids and durations only** (`dataExportWorkflow`, `accountDeletionWorkflow`
   on `karen-tasks`). Temporal history therefore holds no personal data. Workflows read no clock;
   the API supplies every wait, and answers `not_due` if a step arrives early.
3. **The worker has no database access.** Each step is an idempotent, **signed internal API call**
   (`/internal/v1/data-rights/:id/{export,expire-export,erase}`; HMAC + timestamp + replay
   rejection). The ALB answers 404 for `/internal/*` on every host; security groups allow only
   temporal-worker → api for it.
4. **Deletion**: re-authentication → `ACTIVE → DELETION_REQUESTED`, every session revoked,
   e-mail notice. During the cancellation window (`DATA_DELETION_GRACE_SECONDS`, default 7 days —
   **pending legal review**) the user can sign in to a restricted session that only views or
   cancels the request. After it, `identity.erase_user(request_id)` runs as ONE transaction and
   refuses unless the request is a due, scheduled deletion of a `DELETION_REQUESTED` account.
5. **Erased**: e-mail, credentials, sessions, refresh tokens, devices, challenges, profile fields,
   preferences, places, onboarding, external identities, staff grants, consent state, idempotency
   records, export payloads. **Kept (retention exceptions, recorded on the request, pending legal
   review)**: a scrubbed account tombstone (UUID + status), consent receipts and legal
   acceptances (proof), audit events (UUIDs and reason codes only), the request rows, and backups
   until they expire on their own schedule. Redis entries are keyed by HMACs and expire within
   an hour. **Deletion is therefore not instant across backups** and the product says so.
6. **Export**: JSON of everything the user gave or we hold about them (minus security secrets,
   listed as excluded), hashed over canonical JSON, downloadable for `DATA_EXPORT_TTL_HOURS`
   (default 7 days), then purged by the same workflow.

## Consequences

- Temporal unavailable → the request is saved and the user gets a retryable error; retrying is
  safe. A worker restart resumes timers and steps (Temporal), and steps are idempotent.
- Exports live in PostgreSQL (JSONB) for now; S3 with KMS and presigned URLs when payloads grow.
- Stuck deletions must alert (runbook `docs/runbooks/data-deletion-failures.md`).
