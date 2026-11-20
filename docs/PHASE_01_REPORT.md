# KAREN — Phase 01 Report: First-party identity, onboarding, profile, privacy and staff access

- **Date:** 2026-11-20.
- **Plan:** `docs/PHASE_01_PLAN.md` (milestones M0–M10, per-milestone evidence).
- **Roadmap gate:** `karen_phases.md` — Gate 01.
- **Security mapping:** `docs/security/asvs-5-identity-mapping.md` (ASVS 5.0, requirement level).
- **Performance:** `docs/security/auth-performance-benchmark.md`.

> **Verdict**
>
> | Status                          | Value   | Why                                                                                                                                                                                          |
> | ------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
> | `LOCAL_IMPLEMENTATION_COMPLETE` | partial | M0–M10 are implemented and tested locally. Items in §4 are not built; the full web flow E2E against the real API is not automated                                                            |
> | `EXTERNAL_VALIDATION_PENDING`   | yes     | Physical devices, physical security keys, staging, KMS keys, the e-mail domain and legal texts (§5)                                                                                          |
> | `PHASE_01_GATE_PASSED`          | **no**  | Gate 01 needs web **and physical iOS/Android** sign-up/login/recovery/logout. Staging does not exist yet (the Phase 00 gate is still open). An independent security review has not been done |
>
> **Production launch readiness: NOT READY.** Nothing has been deployed.

## 1. Delivered (pull requests to `main`)

PRs #22–#29 each need the owner's review and merge approval. Merge them in order: #22 → #29.

**Open pull requests:**

| PR  | Milestone | Content                                                                | Hosted CI      |
| --- | --------- | ---------------------------------------------------------------------- | -------------- |
| #22 | M3        | Login, sessions, refresh rotation/reuse detection, revocation, devices | 16/16          |
| #23 | M4        | Profile, preferences, saved places, e-mail and password change         | 16/16          |
| #24 | M5        | Onboarding progress API                                                | 16/16          |
| #25 | M6        | Notices, purpose consent, hash-chained receipts                        | 16/16          |
| #26 | M7        | Data export and account deletion (Temporal)                            | 16/16          |
| #27 | M8        | Staff realm, mandatory WebAuthn, step-up, JIT elevation                | 16/16          |
| #28 | M10       | Auth benchmark, security metrics, runbooks, ASVS mapping, this report  | 16/16 (part 1) |
| #29 | M9        | Web, admin and mobile clients; BFF-signed client IP                    | 16/16          |

M0–M2 are already on `main`. M2 came in through #21.

## 2. Gate 01 criteria

| Criterion (karen_phases.md)                   | Status              | Evidence                                                                                                                                                                                                                                                                             |
| --------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Signup / login / recovery / logout on **web** | **PARTIAL**         | BFF auth route handlers unit-tested (77 web unit tests). Playwright smoke E2E (9) covers forms, CSP nonce, auth redirect and CSRF/origin refusal. A full browser sign-up → verify → login → reset → logout run against the real API has **not** been automated or run — NOT VERIFIED |
| Same on **physical iOS/Android**              | **NOT VERIFIED**    | 32 jest tests. Expo config and bundle export checks pass in CI. Needs a device run (SecureStore, biometric lock, refresh single-flight)                                                                                                                                              |
| No unauthorized reads                         | PASSED (local)      | PostgreSQL RLS with a non-owner runtime role, cross-user negative tests (`rls`, `identity`, `sessions`, `profile` integration suites), staff ↔ consumer token separation, status-only staff lookups                                                                                  |
| Consent receipts can be verified              | PASSED (local)      | Hash-chained, HMAC-sealed receipts. Tamper-detection test (`consent.int.test.ts`)                                                                                                                                                                                                    |
| End-to-end data request                       | PASSED (local)      | Export and deletion run through the API, Temporal worker and local Temporal server (`data-rights.int.test.ts`; `data-rights.workflow.test.ts` in the Temporal worker)                                                                                                                |
| RLS negative tests pass                       | PASSED (local + CI) | Integration job in hosted CI                                                                                                                                                                                                                                                         |

## 3. Security posture (summary)

- **Credentials:**
  - Argon2id with a pepper and a hashing concurrency gate.
  - NIST 800-63B-4 password policy: 15 characters minimum, no composition rules.
  - Uniform responses and dummy verification prevent user enumeration.
- **Rate limits:** fail-closed Redis limiters, keyed on the BFF-signed end-user IP.
- **Sessions:**
  - Server-side sessions are checked on every request.
  - Mobile uses ES256 `at+jwt` access tokens (10 minutes) and single-use rotating refresh tokens with reuse detection.
  - Web uses an opaque `__Host-` cookie, CSRF protection and a nonce CSP.
- **Staff:**
  - Separate schema and DB role, password plus WebAuthn (user verification required), step-up.
  - Two-person JIT elevation and reason-bound, audited lookups.
- **ASVS 5.0 at L2, consumer realm** — open gaps:
  - Breached-password corpus (6.2.12).
  - Consumer MFA (6.3.3).
  - OTP lifetime is 15 minutes, above the 10-minute maximum (6.5.5).
  - Concurrent-session policy is undocumented (7.1.2).
  - Others are listed in `asvs-5-identity-mapping.md`.
  - **Phase 01 does not claim ASVS L2 for consumers until these are resolved or formally accepted.**

## 4. Not built in Phase 01 (tracked)

- **Mobile:**
  - Data-export download.
  - Saved-places screens.
  - Theme application.
  - Locale-aware notices.
- **Hindi copy:** needs native-speaker and product review.
- **Deferred to later work:**
  - Avatar upload (blocked on malware scanning).
  - Google/Apple sign-in and passkeys (ADR-0015 §7).
  - Minors / guardian consent (design only).
- **Staff console:**
  - "End a user's sessions" (an operator CLI exists).
  - Per-key WebAuthn removal.
- **Breached-password check:** needs a decision (`PHASE_01_PLAN.md` §6).

## 5. External validation required (owner / vendor / legal)

| Item                                                                                        | Blocks            |
| ------------------------------------------------------------------------------------------- | ----------------- |
| Physical iOS/Android run of the mobile flows                                                | Gate 01           |
| Physical security keys (YubiKey, platform authenticators) on the admin console              | Staff go-live     |
| Staging environment (Phase 00 gate): deploy, smoke tests, load tests, alerts                | Gate 01, launch   |
| Signing keys in KMS, peppers and HMAC secrets in Secrets Manager                            | Deployment        |
| Sender domain with DKIM/SPF/DMARC; **rotate the Brevo SMTP key shared in chat**; Brevo DPA  | Production e-mail |
| Privacy notice, terms, consent purposes and legal bases (DPDP Act 2023); retention schedule | Launch            |
| Independent security review / ASVS verification                                             | Gate 01 sign-off  |

## 6. Measured performance (dev laptop, not production)

Unloaded p95 latencies:

| Operation          | p95    |
| ------------------ | ------ |
| Login              | 63 ms  |
| Session validation | 4.6 ms |
| Refresh            | 6.3 ms |
| Profile read       | 4.9 ms |
| Consent check      | 1.2 ms |

Login throughput is about 32/s per process, bounded by Argon2id.

Fargate/RDS figures are NOT VERIFIED (`auth-performance-benchmark.md`).

## 7. What the owner needs to do next

1. Review and merge #22 → #29 in order.
2. Decide on:
   - the breached-password source;
   - consumer MFA or passkeys (or claim L1 for consumers);
   - the 10-minute OTP lifetime (engineering is ready to change it);
   - a concurrent-session cap.
3. Run the mobile app on a physical device (guide given earlier: Expo Go / dev build against the local API on the LAN).
4. Unblock staging (the Phase 00 gate) so load tests, alerts and the deployed checks can run.
