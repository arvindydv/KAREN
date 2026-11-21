# KAREN — Phase 01 Report: First-party identity, onboarding, profile, privacy and staff access

- **Date:** 2026-11-21 (revision 2 — Phase 01 closure audit). Revision 1: 2026-11-20.
- **Plan:** `docs/PHASE_01_PLAN.md` (milestones M0–M10, per-milestone evidence).
- **Roadmap gate:** `karen_phases.md` — Gate 01.
- **Closure checklists:** `docs/PHASE_01_CLOSURE_CHECKLIST.md`, `docs/PHASE_00_CLOSURE_CHECKLIST.md`.
- **Security:** `docs/security/asvs-5-identity-mapping.md` (ASVS 5.0), `docs/security/remediation-plan.md`.
- **Performance:** `docs/security/auth-performance-benchmark.md`.
- **Next phase:** `docs/PHASE_02_PROPOSAL.md` (planning only; implementation needs owner approval).

> **Verdict**
>
> | Status                          | Value   | Why                                                                                                                                                                                                                                                   |
> | ------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
> | `LOCAL_IMPLEMENTATION_COMPLETE` | partial | M0–M10 are on `main` (M9 merged via #29 at `3bf9913` on 2026-11-21). §5 items are not built; the full web E2E against the real API is not automated                                                                                                   |
> | `OWNER_MANUAL_VALIDATION`       | **yes** | The owner reports manual end-to-end runs of sign-up, login, recovery and logout on a physical Android device, a physical iOS device and the web app (§2.1). The evidence record (build, devices, environment, artefacts) is not yet filled in         |
> | `EXTERNAL_VALIDATION_PENDING`   | yes     | Staging, KMS keys, physical security keys, e-mail domain, legal texts, independent security review (§5)                                                                                                                                               |
> | `PHASE_01_GATE_PASSED`          | **no**  | All Gate 01 criteria now have at least owner-reported or local evidence, but the manual evidence is not yet verifiable and was not taken on the merged `main` build, the Phase 00 gate is open and the independent review has not happened (§2.2, §8) |
>
> **Production launch readiness: NOT READY.** Nothing has been deployed.
>
> **Recommendation:** Phase 01 formal closure **NO-GO**. Phase 02 planning **GO**. Phase 02 implementation **conditional GO** — only after explicit owner approval and the entry criteria in §8.

## 1. Delivered and pull-request status (audited 2026-11-21 with `gh`)

| PR  | Milestone | Content                                                                | State (2026-11-21)                                                                                                                                                                                                                                                                                                            |
| --- | --------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #21 | M2        | Registration, e-mail OTP verification, password reset                  | Merged                                                                                                                                                                                                                                                                                                                        |
| #22 | M3        | Login, sessions, refresh rotation/reuse detection, revocation, devices | Merged 2026-11-20 16:45 UTC                                                                                                                                                                                                                                                                                                   |
| #23 | M4        | Profile, preferences, saved places, e-mail and password change         | Merged 2026-11-20 16:45 UTC                                                                                                                                                                                                                                                                                                   |
| #24 | M5        | Onboarding progress API                                                | Merged 2026-11-20 16:45 UTC                                                                                                                                                                                                                                                                                                   |
| #25 | M6        | Notices, purpose consent, hash-chained receipts                        | Merged 2026-11-20 16:45 UTC                                                                                                                                                                                                                                                                                                   |
| #26 | M7        | Data export and account deletion (Temporal)                            | Merged 2026-11-20 16:45 UTC                                                                                                                                                                                                                                                                                                   |
| #27 | M8        | Staff realm, mandatory WebAuthn, step-up, JIT elevation                | Merged 2026-11-20 16:45 UTC                                                                                                                                                                                                                                                                                                   |
| #28 | M10       | Auth benchmark, security metrics, runbooks, ASVS mapping, this report  | Merged 2026-11-20 16:45 UTC (the ASVS mapping and report commit `1ef324f` is on `main`)                                                                                                                                                                                                                                       |
| #29 | M9        | Web, admin and mobile clients; BFF-signed client IP                    | Merged 2026-11-21 10:00 UTC (merge `3bf9913`). `main` was merged into the branch first (`65c5344`) to resolve conflicts in `apps/mobile/package.json`, `pnpm-lock.yaml` (regenerated by `pnpm install`) and `docs/PHASE_01_PLAN.md`; then 16/16 CI green ([run](https://github.com/arvindydv/KAREN/actions/runs/44891964312)) |

M0–M1 are on `main` through #19. `main` also has the Dependabot batch #30.

**All Phase 01 PRs are merged.** #22–#28 were merged in the intended order, then #29. `main` had no branch protection at that time, so required checks were not enforced by GitHub on those merges. Each PR did show 16/16 green before merge (revision 1 of this report).

## 2. Gate 01 criteria

### 2.1 Owner-reported manual validation (recorded 2026-11-21)

The project owner reports that they personally ran the following flows end-to-end. **Only the flows listed here were reported. Nothing else is claimed.**

| Flow                                      | Physical Android | Physical iOS  | Web (browser) |
| ----------------------------------------- | ---------------- | ------------- | ------------- |
| Sign-up + e-mail OTP verification         | Reported pass    | Reported pass | Reported pass |
| Login (e-mail + password)                 | Reported pass    | Reported pass | Reported pass |
| Password recovery (forgot → code → reset) | Reported pass    | Reported pass | Reported pass |
| Logout                                    | Reported pass    | Reported pass | Reported pass |

The owner also reports testing these flows. **The platform for each one was not stated:**

- Profile / preferences.
- Consent grant / revoke.
- Data export.
- Account deletion.

**Evidence record — must be completed before this counts as verifiable evidence:**

| Field                                                                 | Value                                                                                                                                           |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Tester                                                                | Project owner                                                                                                                                   |
| Date(s) of the runs                                                   | NOT RECORDED (reported on 2026-11-21)                                                                                                           |
| Commit / branch tested                                                | NOT RECORDED. The client screens exist only on the PR #29 branch (`phase-01/m9-clients`, head `0b04f15`), so the run cannot have been on `main` |
| API environment                                                       | NOT RECORDED. No staging exists, so this was a non-deployed API (local machine or LAN)                                                          |
| Android device model / OS version / build type                        | NOT RECORDED (Expo Go, development build or release build?)                                                                                     |
| iOS device model / OS version / build type                            | NOT RECORDED                                                                                                                                    |
| Browser and version                                                   | NOT RECORDED                                                                                                                                    |
| E-mail delivery path for OTPs                                         | NOT RECORDED (Brevo SMTP or the local mail catcher?)                                                                                            |
| Artefacts (screen recordings, screenshots, request ids, audit events) | None attached                                                                                                                                   |

**Not covered by the report** (these stay NOT VERIFIED until they are tested and recorded on a device):

- SecureStore persistence across an app restart.
- Biometric app lock.
- Refresh-token rotation after the 10-minute access-token expiry (single-flight).
- "Log out of all devices" from a second device.
- Behaviour on a slow or offline network.

### 2.2 Criterion-by-criterion status

| Criterion (karen_phases.md)                   | Status                                      | Evidence                                                                                                                                                                                                                                               |
| --------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Signup / login / recovery / logout on **web** | **OWNER-REPORTED PASS** (record incomplete) | §2.1 manual run. Automated: 77 web unit tests and 9 Playwright smoke tests (forms, CSP nonce, auth redirect, CSRF/origin refusal) on #29. A full browser sign-up → verify → login → reset → logout run against the real API is **still not automated** |
| Same on **physical iOS/Android**              | **OWNER-REPORTED PASS** (record incomplete) | §2.1 manual run on one Android and one iOS device. Automated: 32 jest tests and Expo config / bundle export checks in CI. Device-specific controls listed in §2.1 are NOT VERIFIED                                                                     |
| No unauthorized reads                         | PASSED (local + CI)                         | PostgreSQL RLS with a non-owner runtime role, cross-user negative tests (`rls`, `identity`, `sessions`, `profile` integration suites), staff ↔ consumer token separation, status-only staff lookups                                                    |
| Consent receipts can be verified              | PASSED (local)                              | Hash-chained, HMAC-sealed receipts. Tamper-detection test (`consent.int.test.ts`). The owner also reports a manual consent grant/revoke (§2.1). The notice texts are still DRAFT placeholders                                                          |
| End-to-end data request                       | PASSED (local)                              | Export and deletion run through the API, Temporal worker and local Temporal server (`data-rights.int.test.ts`; `data-rights.workflow.test.ts`). The owner also reports manual export and deletion (§2.1). Deletion on a deployed stack: NOT VERIFIED   |
| RLS negative tests pass                       | PASSED (local + CI)                         | Integration job in hosted CI                                                                                                                                                                                                                           |

**Why this is still not a pass:** the first two rows rest on an owner attestation without a build reference or artefacts, taken on the pre-merge #29 branch. Resolving the #29 conflicts changed `pnpm-lock.yaml` and `apps/mobile/package.json` (expo 58.0.25, expo-dev-client 58.0.20), so the merged build (`3bf9913`) is not the build that was tested. The closing step is a short **re-run on the merged `main` commit, recorded in the evidence table** (`PHASE_01_CLOSURE_CHECKLIST.md` C2, C3).

## 3. Repository audit findings (2026-11-21)

| #   | Finding                                                                                                                                                                                                                                                     | Severity | Action                                                                                                                                                                 |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | **The repository is now `public`.** The Phase 00 report recorded it as private. The threat models, runbooks and security mapping are now world-readable                                                                                                     | High     | Owner to confirm the change was intentional. If it was not, make the repo private again. Either way, see A2 and A3                                                     |
| A2  | **`main` has no branch protection** (`GET …/branches/main/protection` → 404) and there are no rulesets. Because the repo is public, the Phase 00 "needs a paid plan" blocker no longer applies                                                              | High     | Turn on protection now: PR required, 16 required checks, no force pushes, no deletions, linear history, conversation resolution (`PHASE_00_CLOSURE_CHECKLIST.md` P0-3) |
| A3  | Secret scanning and push protection are **enabled**. Dependabot **security** updates are **disabled**                                                                                                                                                       | Medium   | Enable Dependabot security updates. The 7-day release-age cooldown (ADR-0010) still applies                                                                            |
| A4  | A history search (`git log --all -S`/`-G`) for the Brevo key prefixes `xsmtpsib-` and `xkeysib-` found **no key** in any commit. CI gitleaks is green. The key shared in chat must still be rotated (it left our control through the chat, not through git) | Medium   | Rotate the Brevo SMTP key (`remediation-plan.md` S-01)                                                                                                                 |
| A5  | PR #29 conflicted with `main` (§1) — **resolved and merged 2026-11-21**                                                                                                                                                                                     | High     | Rebase #29 on `main`, regenerate the lockfile with `pnpm install` (not by hand-merging), re-run the full CI, then the owner reviews and merges                         |
| A6  | Dependabot PRs #33/#34 propose moving the Python images from 3.12 to **3.14**. The stack is pinned to Python 3.12 (`CLAUDE.md`)                                                                                                                             | Low      | Close them, or add an `ignore` rule for Python major/minor bumps, until an ADR approves a runtime upgrade                                                              |
| A7  | The Dependabot `uv` job fails on `main` because `ruff 0.17.5` is newer than the `exclude-newer` cutoff. This is the ADR-0010 release-age policy working as intended, not a defect                                                                           | Info     | None. It clears once the package is older than the cutoff                                                                                                              |
| A8  | `docs/PHASE_01_PLAN.md` milestone table showed M9 and M10 as not started — **fixed in the #29 merge** (M9 and M10 `DONE_LOCAL`)                                                                                                                             | Low      | Fix while resolving the #29 conflict. M10 → `DONE_LOCAL` (local scope); staging items stay `BLOCKED_EXTERNAL`                                                          |

## 4. Security posture (summary)

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
- **ASVS 5.0 at L2, consumer realm.** These gaps were re-verified against the code on 2026-11-21 (`asvs-5-identity-mapping.md`, "Re-verification"):
  - Breached-password corpus not wired in (6.2.12; `password-policy.ts` says so).
  - No consumer MFA (6.3.3).
  - `CHALLENGE_TTL_MS` is still 15 minutes, above the 10-minute maximum (6.5.5; `challenge.service.ts:19`).
  - No concurrent-session policy in ADR-0016 (7.1.2).
  - Ending a single other session does not ask for re-authentication (7.5.2; `DELETE /v1/me/sessions/:id`).
  - The web app does not send COOP (3.4.8, L3; the admin app does).
  - **Phase 01 does not claim ASVS L2 for consumers until these are resolved or formally accepted.** The fix plan is in `remediation-plan.md`.

## 5. Not built in Phase 01 (tracked)

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
- **Automated full web E2E** against the real API (sign-up → verify → login → reset → logout).
- **Breached-password check:** needs a decision (`PHASE_01_PLAN.md` §6).

## 6. External validation required (owner / vendor / legal)

| Item                                                                                        | Blocks                   | Status 2026-11-21                                                                 |
| ------------------------------------------------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------- |
| Physical iOS/Android run of the mobile flows                                                | Gate 01                  | **Owner-reported done** (§2.1). Evidence record + re-run on merged `main` pending |
| Web run of the auth flows                                                                   | Gate 01                  | **Owner-reported done** (§2.1). Evidence record pending                           |
| Physical security keys (YubiKey, platform authenticators) on the admin console              | Staff go-live            | Not reported                                                                      |
| Staging environment (Phase 00 gate): deploy, smoke tests, load tests, alerts                | Gate 00, Gate 01, launch | Not started (no AWS account)                                                      |
| Signing keys in KMS, peppers and HMAC secrets in Secrets Manager                            | Deployment               | Not started                                                                       |
| Sender domain with DKIM/SPF/DMARC; **rotate the Brevo SMTP key shared in chat**; Brevo DPA  | Production e-mail        | Not started                                                                       |
| Privacy notice, terms, consent purposes and legal bases (DPDP Act 2023); retention schedule | Launch                   | Not started                                                                       |
| Independent security review / ASVS verification                                             | Gate 01 sign-off         | Not started                                                                       |

## 7. Measured performance (dev laptop, not production)

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

## 8. GO / NO-GO

| Decision                                            | Recommendation     | Conditions                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Formal Phase 01 closure                             | **NO-GO**          | Blockers B2–B7 in `PHASE_01_CLOSURE_CHECKLIST.md` §3                                                                                                                                                                                                                                        |
| Production launch                                   | **NO-GO**          | Phase 00 and Phase 01 gates, legal texts, deployed environment                                                                                                                                                                                                                              |
| Phase 02 planning (docs, ADR drafts, spike designs) | **GO**             | `PHASE_02_PROPOSAL.md`. No feature code                                                                                                                                                                                                                                                     |
| Phase 02 implementation                             | **CONDITIONAL GO** | Only after explicit owner approval **and** entry criteria E1–E6 (`PHASE_02_PROPOSAL.md` §2): #29 merged and re-tested, branch protection on, quick security fixes merged, ASVS decisions recorded, AI Gateway dev account and budget approved. Phase 01 external items continue in parallel |

## 9. What the owner needs to do next

1. Confirm whether making the repository public was intentional (A1). Then turn on branch protection for `main` (A2) and Dependabot security updates (A3).
2. ~~Merge #29~~ — done 2026-11-21. Turn on branch protection before the next merge.
3. Re-run the four auth flows on the merged `main` commit on Android, iOS and web. Fill in the §2.1 evidence table with the commit SHA, devices, OS versions, build type, API host and date, and attach screen recordings or screenshots.
4. Decide (`remediation-plan.md` §2):
   - the breached-password source;
   - consumer MFA or passkeys (or claim ASVS L1 for consumers);
   - the 10-minute OTP lifetime (engineering is ready to change it);
   - a concurrent-session cap.
5. Rotate the Brevo SMTP key.
6. Unblock staging (Phase 00 gate) and commission the independent security review.
7. Review `PHASE_02_PROPOSAL.md` and approve, change or reject the start of Phase 02 implementation.
