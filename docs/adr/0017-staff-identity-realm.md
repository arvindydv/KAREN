# 0017 — Separate first-party staff identity realm with mandatory WebAuthn

- Status: Accepted (design; implementation in Phase 01 M8) · Date: 2026-11-20
- Amends: ADR-0014 layers 1–2. Layer 1 (edge) remains **network** restriction (ALB source-IP /
  VPN CIDRs, optional AWS Verified Access); a hosted IdP (Cloudflare Access backed by a company IdP)
  is no longer the staff identity of record. Layers 3–4 (API RBAC from DB grants, audit) unchanged.
- Depends on: ADR-0015, ADR-0016.

## Context

Today staff roles are rows in `identity.staff_role_grants` keyed by a **consumer** user id, so a
consumer session plus a grant equals staff access. The instruction requires strict separation, no
public staff signup, phishing-resistant MFA, short privileged sessions, JIT elevation and no
undocumented super-admin.

## Decision

1. **Separate realm, separate tables.** New Postgres schema `staff`: `staff.accounts`,
   `staff.webauthn_credentials`, `staff.sessions`, `staff.role_grants` (standing, minimal),
   `staff.elevations` (JIT, expiring, reason + ticket ref, approver ≠ requester for
   `security_admin`), `staff.invitations`. A staff account is not a consumer account; the same human
   may have both, unlinked. `identity.staff_role_grants` is migrated (expand/contract) and dropped.
2. **Separate token audience and cookie.** Admin BFF cookie `__Host-karen_staff` (SameSite=Strict);
   access tokens, if any, use `aud=karen-staff-api` and `realm=staff`. Consumer-realm credentials are
   rejected by staff guards and vice versa — tested in both directions.
3. **Authentication**: password (same hasher, separate pepper id) **plus WebAuthn** (user
   verification required, attestation `none`, resident keys optional) on every sign-in. TOTP or e-mail
   OTP are never sufficient for staff. Implementation uses a reviewed WebAuthn server library
   (candidate `@simplewebauthn/server`, pinned per ADR-0010 — selection recorded in M8 PR).
4. **Sessions**: idle 15 min, absolute 8 h; step-up (fresh WebAuthn assertion ≤ 5 min) for sensitive
   operations: role changes, data export, break-glass, suspension, sensitive user-data reads.
5. **Bootstrap**: first `security_admin` is created by an offline CLI run by an operator with the
   migration role (`pnpm --filter @karen/api staff:bootstrap`), refused when any active staff
   account exists, emitting an audit event and a one-time enrollment link that requires WebAuthn
   registration. No HTTP route can create the first admin.
6. **Invitations**: issued only by `security_admin` with step-up; single-use, 24 h, bound to the
   invited e-mail; enrollment requires WebAuthn.
7. **Authorization**: permissions from standing grants ∪ active elevations, evaluated on every
   request; decisions logged; staff identity alone grants **no** user-data access — user-data reads
   require a permission + an access reason/ticket, are audited as sensitive reads, and bulk access
   alerts.
8. **Break-glass**: two-person rule (requester + approving `security_admin`), 1 h expiry, paged
   alert, mandatory post-incident review. Documented in a runbook (M8).
9. **Default off**: `STAFF_AUTH_ENABLED=false` and Terraform `enable_admin=false` until M8 passes.

## Consequences

- Staff recovery after losing all authenticators requires another `security_admin` (two-person) —
  never self-service by e-mail.
- `ROLE_PERMISSIONS` in `@karen/api-contracts` splits into consumer and staff permission sets.

## Implementation notes (Phase 01 M8, 2026-11-20)

- **Schema `staff`** (accounts, password_credentials, webauthn_credentials, sessions, role_grants,
  elevations, enrollments) reached ONLY through the `karen_staff_runtime` DB role on a separate
  connection pool (`STAFF_DATABASE_URL`). The consumer role has no privileges on `staff.*`; the
  staff role has none on consumer tables — it reads a consumer account's status only through
  `identity.staff_account_status()`. Both directions are integration-tested.
- **WebAuthn** via `@simplewebauthn/server` 14.1.0 (pinned; MIT): attestation `none`, user
  verification required, ES256/RS256, origin allowlist + RP id from config, ceremony state in
  Redis (5 min, single use via GETDEL), counter must advance (clone detection), credentials are
  bound to the account.
- **Sign-in** = password + assertion, every time; no OTP/e-mail fallback for staff.
- **Sessions** `kst_` opaque, 15 min idle / 8 h absolute; step-up window 5 min.
- **Bootstrap** `pnpm --filter @karen/api staff:bootstrap -- --email … --name …` (advisory-locked,
  refused once any staff account exists). **Invitations** need `staff:manage` + step-up.
- **Elevation**: any staff member may request (reason + ticket + 5–240 min, step-up); a DIFFERENT
  security admin approves (API check + DB CHECK). Elevations expire automatically.
- **Legacy `identity.staff_role_grants`** no longer confers anything (consumer principals are
  always `user`); the table is dropped in a later contract migration once confirmed unused.
- **Edge layer** (network allowlist / Verified Access) remains required before `enable_admin`.
- Tests use a byte-accurate software authenticator; **physical security keys and browsers are
  NOT VERIFIED** (M9 Playwright virtual authenticator + manual device check).
