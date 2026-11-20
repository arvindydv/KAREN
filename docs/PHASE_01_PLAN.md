# Phase 01 — Identity, onboarding, profile, consent, admin security: plan & status

Baseline: `main` @ `2d83cf9` (PR #1 merged; hosted CI 16/16 green on that commit).
**Phase 00 stays open** — Gate 00 is independent of this plan (`docs/PHASE_00_REPORT.md`).
Statuses: `NOT_STARTED` · `IN_PROGRESS` · `DONE_LOCAL` · `EXTERNALLY_BLOCKED` · `VERIFIED` · `RELEASE_READY`.

## 1. Direction change

KAREN owns authentication (ADR-0015). No hosted identity service for users or staff; Google/Apple
deferred but kept possible (`identity.external_identities`). Sessions/tokens: ADR-0016. Staff
realm: ADR-0017.

## 2. Repository audit (2026-11-20)

| Area          | Found                                                                                                                                                                                                                                                                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API auth      | Global `AuthGuard` → `TokenVerifier` (jose, asymmetric allow-list, JWKS) → `IdentityService.resolvePrincipal` **which auto-provisioned users**; `PermissionsGuard` with audited denials                                                                                                                                                                 |
| Local dev     | In-memory ES256 issuer, `POST /dev/auth/token`, refused outside local/test (tested)                                                                                                                                                                                                                                                                     |
| Identity data | `identity.users` (status ACTIVE/SUSPENDED/DELETION_REQUESTED), `external_identities`, `staff_role_grants` (keyed by consumer user id)                                                                                                                                                                                                                   |
| Consent data  | `consent.consent_grants`, `consent.legal_acceptances`; `ConsentService.hasActiveConsent` (deny by default); no endpoints                                                                                                                                                                                                                                |
| RLS           | Owner-only policies, runtime role without BYPASSRLS/DDL/DELETE, transaction-local `karen.user_id`; tests run as the runtime role                                                                                                                                                                                                                        |
| Clients       | Web/admin `getSession`/`getStaffSession` always `null` (fail closed); mobile SecureStore abstraction; CSP `script-src 'unsafe-inline'` in web and admin                                                                                                                                                                                                 |
| Docs          | ADR-0004 (provider-neutral OIDC), ADR-0014 (admin: Cloudflare Access + staff OIDC). "ADR-0015" existed only as a section in PHASE_00_REPORT §5 (Cognito). **No ADR-0015/0016 files existed.** The "previous Phase 01 planning document" referenced in the instruction is **not in the repository**; its issue list was taken from the instruction text. |

### 2.1 Components that change because Cognito / hosted staff IdP are removed

| Component                                                                                                             | Change                                                                                 | Milestone      |
| --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------- |
| `IdentityService.resolvePrincipal` auto-provisioning                                                                  | **Removed** (lookup-only; unknown → 401)                                               | **M1 done**    |
| `apps/api/src/config/env.ts` Cognito rules (`OIDC_AUDIENCE_CLAIM=client_id`, `OIDC_REQUIRED_TOKEN_USE`, issuer regex) | Remove with `AUTH_MODE=oidc`                                                           | M3             |
| `token-verifier.ts` `audienceClaim`/`requiredTokenUse` + Cognito test block                                           | Replace by first-party access-token verifier (`typ`, `realm`, `sid`)                   | M3             |
| `AuthModule` `oidc` branch, `remoteJwks`                                                                              | Replace by local key set (KMS public keys)                                             | M3             |
| `apps/api/.env.example`, `docs/development/environment-variables.md` OIDC rows                                        | Replace                                                                                | M3             |
| `infra/terraform/environments/*/{main,variables}.tf` `oidc_*` + "ADR-0015: Amazon Cognito" comments                   | Replace with signing-key/pepper secrets; no Cognito resources exist                    | M3 (no deploy) |
| `apps/web/src/lib/session.ts`, `apps/admin/src/lib/staff-session.ts`                                                  | Real BFF sessions                                                                      | M3/M8/M9       |
| ADR-0014 layers 1–2 (Cloudflare Access + staff OIDC client)                                                           | Amended by ADR-0017                                                                    | M0 done        |
| `karen_phases.md` Phase 01 "Tech" line, A02/B01 items, ADR-0015 references                                            | Annotated (this PR)                                                                    | M0 done        |
| `karen_architecture.md` §3/§10 "OIDC provider (Auth0, Cognito, or Clerk evaluated)"                                   | **Not edited** (requires explicit authorisation per CLAUDE.md); superseded by ADR-0015 | owner action   |
| `docs/PHASE_00_REPORT.md` §5 + Phase 00 item 25 "ADR-0015 trial"                                                      | Trial no longer needed; Phase 00 owner to close item as superseded                     | owner action   |

## 3. Reassessment of previously identified problems

| Problem                                     | Reassessment under first-party auth                                                                | Resolution                                                                                          |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Auto-provisioning inside the auth guard     | Still dangerous (pre-account takeover, unbounded row creation by any valid token)                  | **Fixed M1**; test proves a valid token for an unknown subject creates nothing                      |
| Conflicting auth API names                  | `/v1/identity/bootstrap` obsolete; `/v1/consent/*` vs `/v1/me/*`                                   | Canonical inventory: identity-architecture §7                                                       |
| Inconsistent consent table names            | Roadmap `consent.grants/receipts/requests` vs existing `consent.consent_grants`                    | Keep existing names; add `consent_receipts`, `notices`, `data_rights_requests` (§3 of architecture) |
| Incomplete user statuses / consent purposes | Statuses lacked pending/locked/deleted; purposes lack location, audio, family, notifications split | Statuses **fixed M1**; purpose catalog extended in M6 (legal review needed)                         |
| Avatar upload without malware scanning      | Unchanged; Phase 00 restriction stands                                                             | **Deferred**: initials placeholder only until a scanning pipeline exists                            |
| Logout / revocation limits                  | Previously impossible (IdP-held refresh tokens); now ours                                          | ADR-0016 (M3)                                                                                       |
| Missing deletion execution paths            | Unchanged                                                                                          | M7 Temporal workflow + deletion DB role                                                             |
| `unsafe-inline` script CSP                  | Unchanged; more important now that the web app holds a session cookie                              | Nonce CSP in M3/M9 before any authenticated page ships                                              |
| Cognito + hosted staff IdP reliance         | Removed by decision                                                                                | ADR-0015/0017                                                                                       |

## 4. Milestones (dependency-ordered)

```text
M0 ─► M1 ─► M2 ─► M3 ─┬─► M4 ─► M5
                      ├─► M6 ─► M7 (needs M3 re-auth, M6 receipts, Temporal)
                      └─► M8 (needs M3 session core)
M4..M8 ─► M9 (web/mobile E2E) ─► M10 (hardening, benchmarks, Gate 01 evidence)
```

The dependency review confirms M1 first: every later milestone needs the account state machine,
credential storage and the removal of implicit provisioning.

| Milestone | Scope                                                                                                                                                                                                                  | Status                             | Evidence / blockers                                                                                                                                                                                                                                                                        |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M0        | ADRs 0015–0017, architecture, threat model, plan, roadmap deltas                                                                                                                                                       | **DONE_LOCAL**                     | This PR (docs). Legal/infra items in §6 remain.                                                                                                                                                                                                                                            |
| M1        | Account state machine, e-mail canonicalization, credentials schema, Argon2id + pepper + gate, opaque-token primitive, explicit provisioning, guard auto-provisioning removed, `ACCOUNT_INACTIVE`                       | **DONE_LOCAL**                     | §5                                                                                                                                                                                                                                                                                         |
| M2        | Register / verify / resend / forgot / reset APIs, OTP challenges, Brevo e-mail (ADR-0018), per-address budget                                                                                                          | **DONE_LOCAL** (login moved to M3) | §5.1. Brevo SMTP auth verified; inbox delivery NOT VERIFIED (`pnpm --filter @karen/api mail:smoke <to>`); sender domain + legal review pending                                                                                                                                             |
| M3        | Login, sessions, refresh rotation/reuse, logout(-all), devices, revocation on reset/status, OIDC/Cognito removal (code, config, Terraform)                                                                             | **DONE_LOCAL**                     | §5.2. Web cookie/BFF lands with the web UI (M9). KMS signing NOT VERIFIED (Secrets Manager keys)                                                                                                                                                                                           |
| M4        | Profile (ETag/If-Match), preferences, saved places, e-mail change (code to new address), password change                                                                                                               | **DONE_LOCAL**                     | §5.3. Avatar deferred (no malware-scanning pipeline). Connected-accounts overview: none exist yet (Phase 05)                                                                                                                                                                               |
| M5        | Onboarding progress API (steps, skip/resume/complete, multi-device)                                                                                                                                                    | **DONE_LOCAL** (API)               | §5.4. Screens in M9; copy/translations need product + Hindi review                                                                                                                                                                                                                         |
| M6        | Notices, purpose catalog, grant/deny/revoke with cascade, hash-chained receipts + verification, legal acknowledgement, @RequireConsent                                                                                 | **DONE_LOCAL**                     | §5.5, ADR-0019. Real notice texts, purposes and legal bases: **legal approval pending** (only DRAFT placeholders exist, local/test only)                                                                                                                                                   |
| M7        | Export + deletion requests, Temporal workflows, signed internal steps, guarded one-transaction erasure, restricted deletion-pending sessions                                                                           | **DONE_LOCAL**                     | §5.6, ADR-0020. Cancellation window + retention schedule: **legal review pending**. Export verified end-to-end locally (API + worker + local Temporal server; found and fixed a post-commit notification 500). Deletion end-to-end with a real worker and the deployed stack: NOT VERIFIED |
| M8        | Staff realm (separate schema + DB role), password + WebAuthn sign-in, step-up, invitations, offline bootstrap, least-privilege roles, two-person JIT elevation, emergency disable, audited reason-bound status lookups | **DONE_LOCAL**                     | §5.7, ADR-0017 notes. Physical security keys / browsers NOT VERIFIED (software authenticator in tests). Admin UI in M9                                                                                                                                                                     |
| M9        | Web Playwright + mobile flows, a11y, localization                                                                                                                                                                      | NOT_STARTED                        | Physical iOS/Android devices for SecureStore/biometric validation                                                                                                                                                                                                                          |
| M10       | Auth benchmark (measured), privacy-safe security metrics, operator account-status CLI, 9 identity runbooks + alerting recommendations                                                                                  | **IN_PROGRESS**                    | §5.8. Benchmarks on a dev laptop only (Fargate/RDS NOT VERIFIED); ASVS requirement-level mapping, staging load tests and alert configuration remain (need staging)                                                                                                                         |

## 5. M1 evidence

| Control                                                | Implementation                                                  | Test                                                                                     |
| ------------------------------------------------------ | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Account state machine (app)                            | `packages/domain/src/identity.ts`                               | `packages/domain/src/identity.test.ts`                                                   |
| Account state machine (DB) ≡ app                       | trigger in `20261120131000_identity_credentials`                | `apps/api/test/identity.int.test.ts` "agrees with the domain on every (from, to) pair"   |
| Deny-by-default status column                          | default `PENDING_VERIFICATION`; insert only PENDING/ACTIVE      | same file                                                                                |
| E-mail canonicalization                                | `canonicalizeEmail`                                             | `identity.test.ts` (IDN, case, folding, malformed)                                       |
| Case-insensitive unique e-mail                         | unique index + CHECK constraints                                | registration race test; CHECK test                                                       |
| NIST password policy                                   | `security/password/password-policy.ts`                          | `password-policy.test.ts`                                                                |
| Argon2id, salt, params versioning, pepper, rehash      | `security/password/password-hasher.ts`                          | `password-hasher.test.ts` (incl. reference KAT), rotation test in `identity.int.test.ts` |
| Hashing DoS bound                                      | `security/concurrency-gate.ts`                                  | `concurrency-gate.test.ts`, hasher saturation test                                       |
| Enumeration timing parity                              | `AccountService.checkPasswordCredential` dummy verify           | `identity.int.test.ts` "timing parity"                                                   |
| Opaque token primitive (type-separated, verifier-only) | `security/opaque-token.ts`                                      | `opaque-token.test.ts`                                                                   |
| Explicit provisioning; no guard auto-provisioning      | `AccountService.createPasswordAccount`, `IdentityService`       | `app.int.test.ts` "never provisions an account from a verified token alone"              |
| Non-ACTIVE accounts denied                             | `accountAccessLevel` in `resolvePrincipal` → `ACCOUNT_INACTIVE` | `app.int.test.ts` (SUSPENDED/LOCKED/DELETION_REQUESTED/DELETED)                          |
| Status transitions: optimistic concurrency + audit     | `AccountService.transitionStatus`                               | `identity.int.test.ts` race + audit tests                                                |
| RLS / grants on new tables (runtime role)              | migration + `infra/database/roles.sql`                          | `identity.int.test.ts` RLS block (no cross-user read/update, no DELETE, no enumeration)  |
| Pepper required when deployed                          | `config/env.ts`                                                 | `env.test.ts`                                                                            |

No public endpoint is added in M1 — `AccountService` is exercised by integration tests and is wired
to HTTP in M2. **Not done in M1:** coverage instrumentation/upload (Phase 00 item, still
IN_PROGRESS), breached-password corpus, any client UI.

### 5.1 M2 evidence

| Control                                                                  | Test (`apps/api/test/auth-flows.int.test.ts` unless noted)      |
| ------------------------------------------------------------------------ | --------------------------------------------------------------- |
| Register → code mail → verify → ACTIVE + verified; replay fails          | "registers, e-mails a code, verifies once…"                     |
| Codes/e-mails never stored or audited in clear                           | same test (challenge rows + audit asserted)                     |
| Existing address: identical response, notice mail, decoy handle          | "an existing address gets an identical response…"               |
| Strict input (no mass assignment), weak-password reasons                 | "rejects weak passwords and malformed input…"                   |
| 5-attempt lockout; expiry                                                | "closes a challenge after 5 wrong codes…", "expired codes fail" |
| Resend rotates code; per-challenge send cap                              | "resend rotates the code…"                                      |
| Forgot: no enumeration; reset; weak password keeps the code; notice mail | "unknown addresses…", "resets the password with the code…"      |
| Purpose separation of handles                                            | "a reset handle cannot be used to verify an e-mail"             |
| Concurrent resets: exactly one wins                                      | "concurrent resets with the same code…"                         |
| Pre-account takeover reclaimed by mailbox owner                          | "pre-account takeover…"                                         |
| LOCKED → ACTIVE via reset; SUSPENDED gets no code                        | "a LOCKED account is recovered…"                                |
| Per-address hourly budget                                                | "caps mails per address per hour…"                              |
| Mail retries / permanent failure / async dispatch                        | `src/infrastructure/mail/mail.service.test.ts`                  |
| Deployed config requires Brevo + OTP key; memory transport local-only    | `src/config/env.test.ts`                                        |

**Changed from the M0 design:** login moves to M3 (a login without sessions has nothing to return);
the resend route is `POST /v1/auth/challenges/resend` (serves both purposes); OTP mail bypasses the
outbox (ADR-0018). Session revocation on reset lands with sessions in M3.

### 5.2 M3 evidence

| Control                                                                                                                 | Test                                                    |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| ES256 `at+jwt` access tokens: forgery, `none`/HS256/RS256, typ/iss/aud/realm/sub/sid, expiry, unknown kid, key rotation | `src/security/access-token.test.ts`                     |
| Mobile and web sign-in; generic failure for wrong password vs unknown e-mail                                            | `test/sessions.int.test.ts` "login"                     |
| Unverified account + correct password → fresh code, no session; locked status only after correct password               | same                                                    |
| Per-account throttle before hashing, identical for unknown e-mails                                                      | "per-account throttle…"                                 |
| New-device notice e-mail (not for the first device)                                                                     | "e-mails a new-sign-in notice…"                         |
| Refresh rotation; same-token retry returns the same successor; 5 concurrent refreshes → one successor                   | "refresh rotation"                                      |
| Reuse after the window and foreign installation revoke the session (audited)                                            | "reuse of a consumed token…", "another installation…"   |
| Logout / logout-all / revoke session or device; other users' ids → 404                                                  | "logout and revocation"                                 |
| Password reset and lock/suspend revoke all sessions in the same transaction                                             | "a password reset signs out…", "locking or suspending…" |
| Idle/absolute expiry; per-request liveness; no cross-user confusion                                                     | "expired web sessions…", "rejects a valid token…"       |
| Verified token for a non-existent user/session never provisions anything                                                | `test/app.int.test.ts`                                  |
| Deployed config requires shared signing keys; removed OIDC mode refused                                                 | `src/config/env.test.ts`                                |
| Terraform: no OIDC/Cognito; new secrets in Secrets Manager                                                              | `node scripts/terraform-validate.mjs` (all 3 envs)      |

### 5.3 M4 evidence (`apps/api/test/profile.int.test.ts` unless noted)

| Control                                                                                                                                                        | Test                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| ETag on read; If-Match required (428) and enforced (412); audit lists field names only                                                                         | "reads with an ETag…"                                 |
| Concurrent writes with one version: exactly one wins                                                                                                           | "concurrent writes…"                                  |
| No mass assignment (status/email/id), no control characters, valid zones/currencies                                                                            | "refuses mass assignment…"                            |
| Time zone aliases accepted (`Asia/Kolkata`) — regression for an M2 bug                                                                                         | `src/common/locale.test.ts`, `auth-flows.int.test.ts` |
| Preferences: conservative defaults (optional notifications off); racing first saves → one 412                                                                  | "defaults are conservative…"                          |
| Places: ownership (other user → 404), If-Match, hard delete, 20-limit under concurrency                                                                        | "saved places"                                        |
| E-mail change: current password, code to the NEW address, notice to the old, other sessions revoked, other users cannot redeem the code, taken address → decoy | "e-mail change"                                       |
| Password change: current password, policy, only OTHER sessions revoked, notice                                                                                 | "password change"                                     |

**Found and fixed in M4:** `Intl.supportedValuesOf('timeZone')` omits ICU aliases, so `Asia/Kolkata`
(the default zone) was rejected at registration since M2. Now validated with `Intl.DateTimeFormat`.

### 5.4 M5 evidence (`apps/api/test/onboarding.int.test.ts`)

Separate states by design: authentication (sessions), mandatory legal acknowledgement (M6),
optional consents (M6) and onboarding completion (this table). Onboarding records progress only
and never gates product access.

| Control                                                                                     | Test                   |
| ------------------------------------------------------------------------------------------- | ---------------------- |
| Steps progress; retries are no-ops; out-of-order completion; unknown step → 404             | "starts not_started…"  |
| Concurrent progress from several devices converges, one row per user                        | "concurrent progress…" |
| Skip/resume idempotent; completing a step after skipping resumes; skipping never blocks use | "skip and resume…"     |
| Complete is final and idempotent                                                            | "complete is final…"   |
| Per-user isolation (FORCEd RLS); authentication required                                    | "is per user…"         |

### 5.5 M6 evidence (`apps/api/test/consent.int.test.ts` unless noted)

| Control                                                                                                        | Test                                                          |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Catalog: one entry per purpose, deps acyclic, unbuilt features not grantable                                   | `packages/domain/src/privacy.test.ts`, "lists every purpose…" |
| Drafts served only in local/test; config refuses drafts when deployed                                          | "never serves drafts…", `env.test.ts`                         |
| Approved notices immutable; DB enforces content hash                                                           | "approved notices are immutable…"                             |
| Default not_asked; dependency enforcement (403 CONSENT_REQUIRED); revoke cascades with receipts                | "defaults to not_asked…"                                      |
| Unavailable purposes, unknown notice versions, invalid transitions refused; deny recorded                      | "refuses unavailable purposes…"                               |
| If-Match 428/412; out-of-order concurrent updates → one wins                                                   | "stale or missing If-Match…"                                  |
| Idempotency-Key replay returns the original receipt                                                            | "Idempotency-Key replays…"                                    |
| Receipt chain verifies; tampering (even with the trigger disabled) is detected; API role cannot alter receipts | "form a verifiable chain…"                                    |
| Receipts private per user (FORCEd RLS)                                                                         | "receipts are private…"                                       |
| Legal acknowledgement idempotent, stores notice hash                                                           | "tracks acceptance…"                                          |
| @RequireConsent requires every purpose; no principal ≠ consent                                                 | `src/consent/consent.guard.test.ts`                           |

### 5.6 M7 evidence

| Control                                                                                                                                | Test                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Internal steps: unsigned / wrong key / stale / replayed / user-session calls rejected; not in the public contract                      | `apps/api/test/data-rights.int.test.ts` "internal step endpoints"                        |
| Export: idempotent request, single workflow start, complete copy without secrets, owner-only download, expiry purges payload           | "export"                                                                                 |
| Deletion: re-auth, all sessions revoked, restricted session (view/cancel only), cancel restores ACTIVE, later erase step → `cancelled` | "needs the password…"                                                                    |
| Erasure only after the window; idempotent; personal data gone, proofs kept, address reusable, final e-mail                             | "erases the account after the window…"                                                   |
| `erase_user` refuses an ACTIVE account even if called directly; forged rows blocked by RLS                                             | "the erasure routine refuses…"                                                           |
| Workflows: one durable timer for the full window, cancellation, `not_due` re-check, transient-failure retries, export expiry           | `apps/temporal-worker/src/workflows/data-rights.workflow.test.ts` (time-skipping server) |
| Worker signs every call; 4xx non-retryable, 5xx retryable, no secret → refuses                                                         | `apps/temporal-worker/src/activities/data-rights-activities.test.ts`                     |
| Deployed config: Temporal dispatch, ≥ 1 day window, worker HMAC secret                                                                 | `src/config/env.test.ts`                                                                 |
| ALB 404 for `/internal/*`; worker → api SG rule; api service discovery                                                                 | `node scripts/terraform-validate.mjs`                                                    |

### 5.7 M8 evidence (`apps/api/test/staff.int.test.ts`)

| Control                                                                                                                                                 | Test                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Offline bootstrap once; single-use enrollment links; no public staff sign-up                                                                            | "bootstrap and enrollment"                                 |
| Password AND assertion: wrong password, unknown e-mail, wrong origin, missing UV, replayed ceremony, cloned counter, foreign key all rejected (audited) | "sign-in requires…"                                        |
| Staff ↔ consumer credentials never interchangeable (both directions)                                                                                    | "realm separation"                                         |
| Consumer and staff DB roles cannot read each other's tables                                                                                             | "the two DB roles…"                                        |
| Least privilege; user-status lookup needs a reason, returns status only, audited; admins have no user-data permission                                   | "least privilege…"                                         |
| Step-up required for sensitive actions; another member's ceremony cannot be redeemed                                                                    | "sensitive actions need…"                                  |
| JIT elevation: reason + ticket, approved by someone else only, expires                                                                                  | "JIT elevation…"                                           |
| No self-grant/self-revoke; emergency disable ends sessions instantly                                                                                    | "guards against self-service…"                             |
| Idle expiry; realm disabled → no staff/admin routes                                                                                                     | "staff sessions expire…", "with the staff realm disabled…" |
| Legacy consumer staff grants confer nothing                                                                                                             | `apps/api/test/app.int.test.ts`                            |

### 5.8 M10 evidence (so far)

| Item                                                                                                                            | Evidence                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Per-request latency within budgets (login p95 63 ms, session validation 4.6 ms, refresh 6.3 ms, profile 4.9 ms, consent 1.2 ms) | `docs/security/auth-performance-benchmark.md` (run A, `apps/api/scripts/bench-auth.mjs`) |
| Loaded behaviour: login ~32/s per process, capacity-bound by the 4-hash gate (by design)                                        | same doc (run B)                                                                         |
| Security counters emitted, labels PII-free                                                                                      | `apps/api/test/metrics.int.test.ts` "counts security events…"                            |
| Emergency suspension tooling                                                                                                    | `pnpm --filter @karen/api account:status` (`src/identity/account-status-cli.ts`)         |
| Runbooks + alert suggestions                                                                                                    | `docs/runbooks/README-identity.md`                                                       |
| Contract regression found & fixed: staff routes missing from OpenAPI (CI on #27)                                                | commit `92b4d30` on M8                                                                   |

## 6. Items needing decisions or external validation

| Item                                                                                                                                                                                      | Owner              | Type                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ------------------------ |
| Breached-password source: offline Pwned Passwords dataset (licence terms to be confirmed) vs k-anonymity range API (external call at sign-up)                                             | security + product | decision                 |
| E-mail: Brevo chosen (ADR-0018). Own sender domain with DKIM/SPF/DMARC (current From is @gmail.com); rotate the SMTP key shared in chat; Brevo processor agreement + data-location review | ops + legal        | infra validation / legal |
| Signing keys in KMS (ECC_NIST_P256) and pepper secrets in Secrets Manager                                                                                                                 | ops                | infra validation         |
| Privacy notice, terms, AI disclosure texts (EN/HI); consent purposes and legal bases under DPDP Act 2023 and Rules                                                                        | legal              | legal approval           |
| Deletion cancellation window, retention schedule, backup retention statement                                                                                                              | legal + ops        | legal approval           |
| Minors / verifiable guardian consent design                                                                                                                                               | legal              | legal approval           |
| CAPTCHA / bot-challenge provider (if any) for login abuse                                                                                                                                 | security           | decision                 |
| `karen_architecture.md` §3/§10 update to reference ADR-0015                                                                                                                               | architecture owner | authorisation            |

## 7. Requirements traceability (roadmap → milestone → acceptance tests)

| Roadmap item (karen_phases.md)                            | Milestone                        | Acceptance test (planned unless marked)                                     |
| --------------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------- |
| F01-01 signup paths (e-mail + password)                   | M1+M2                            | M1: provisioning/race/policy tests ✔; M2: register→verify API tests         |
| F01-01 Google / Apple / passkeys                          | deferred                         | — (ADR-0015 §7 linking rules)                                               |
| F01-01 e-mail canonicalization, duplicate handling        | M1                               | `identity.test.ts`, registration race ✔                                     |
| F01-01 password policy, verification, throttles           | M1+M2                            | `password-policy.test.ts` ✔; throttle tests M2                              |
| F01-01 `/v1/identity/bootstrap`                           | dropped                          | superseded by registration (ADR-0015)                                       |
| F01-01 refresh rotation, secure storage, biometric unlock | M3+M9                            | refresh race/reuse integration tests; mobile store tests; device validation |
| F01-01 reset/recovery, lost device                        | M2+M3                            | replay/expiry/concurrent-reset tests                                        |
| F01-01 logout current/all                                 | M3                               | revocation-during-request tests                                             |
| F01-01 enumeration/CSRF/XSS/fixation, proxy IP trust      | M1–M3, M9                        | dummy-verify ✔; BFF CSRF + CSP tests                                        |
| F01-02 onboarding (language, assist vs act, skip/resume)  | M5                               | idempotent step transitions, multi-device resume, Playwright                |
| F01-03 profile/ETag, locale, devices, account status      | M4/M3                            | 412 on stale `If-Match`; cross-user negative tests                          |
| F01-03 avatar upload                                      | deferred                         | blocked on malware scanning                                                 |
| F01-04 notices, purposes, receipts, dashboard             | M6                               | receipt tamper-detection test; revoke stops processing test                 |
| F01-04 export / deletion / propagation / retention        | M7                               | Temporal replay + worker-restart tests; per-store deletion checks           |
| F01-04 minors / guardian                                  | design only                      | legal review                                                                |
| F01-05 separate staff audience, MFA, JIT, audit           | M8                               | consumer↔staff token cross-use tests; WebAuthn ceremony tests               |
| F01-05 cross-user RLS tests with real app role            | M1 (new tables) + each milestone | `identity.int.test.ts` RLS block ✔                                          |
| Gate 01 (web + physical devices, no unauthorized reads)   | M9–M10                           | EXTERNALLY_BLOCKED on devices + staging                                     |
