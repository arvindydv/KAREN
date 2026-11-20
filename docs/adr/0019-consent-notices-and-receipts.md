# 0019 — Purpose consent, versioned notices and tamper-evident receipts

- Status: Accepted · Date: 2026-11-20
- Related: ADR-0015 (identity), product spec SEC-01; roadmap F01-04.

## Decision

1. **Separate states.** Mandatory legal acknowledgement (`consent.legal_acceptances`, per notice
   version + content hash), optional purpose consent (`consent.consent_grants`), and onboarding
   (M5) are independent. Optional consent is never a precondition for an account.
2. **Purpose catalog in code** (`@karen/domain` `CONSENT_CATALOG`): every purpose optional and
   off by default; dependencies (e.g. memory needs AI processing); purposes of features that do
   not exist are `not_yet_available` and cannot be granted. Legal bases are **pending legal
   review** — the catalog does not claim any.
3. **Decisions** grant / deny / revoke per purpose, one current row per (user, purpose, scope)
   with a version (`If-Match`), optional `Idempotency-Key`, per-user serialization (row lock).
   Revoking a purpose revokes its dependents, each with its own receipt.
4. **Receipts** (`consent.consent_receipts`): append-only (trigger; API role has INSERT/SELECT
   only), per-user sequence, `receipt_hash = sha256(canonical receipt ‖ prev_hash)` and
   `receipt_mac = HMAC(CONSENT_RECEIPT_KEY, receipt_hash)`. Each records the notice kind, version
   and **hash of the exact notice text**, source and method, but no IP/device/PII beyond the user
   UUID. `GET /v1/me/consents/receipts/verify` recomputes the chain. Tampering by anyone without
   the MAC key is detected; a database superuser who also holds the key is out of scope
   (residual risk R8).
5. **Notices** (`consent.notices`): draft → approved → retired. Approved rows are immutable
   (trigger), the DB recomputes and enforces the content hash, and drafts are served only when
   `ALLOW_DRAFT_NOTICES=true`, which config refuses outside local/test. Approval is an operator
   action after legal sign-off (runbook), never an API call.
6. **Enforcement** is server-side: `@RequireConsent(...purposes)` guard (after auth and
   permissions) and `ConsentService.requireConsent/hasActiveConsent`, both reading PostgreSQL on
   every call. The existing execution policy already consults consent before any action.

## Consequences

- No feature that processes data under these purposes exists yet (AI chat Phase 02, memory
  Phase 03); each must use the guard/service — reviewers check this. Withdrawal takes effect for
  the next request/step; long-running workflows must re-check consent before each step (pattern
  documented for Phase 02/04).
- Real notice texts (EN/HI), the purpose list and legal bases need legal review before launch.
- Minors / guardian consent: designed as a future `guardian` relation + age gate; not built and
  no children's features may launch before legal review.
