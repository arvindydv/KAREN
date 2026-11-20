# 0014 — Admin console access control

- Status: Accepted · Date: 2026-11-20 · **Amended by [0017](0017-staff-identity-realm.md)**: layers 1–2 no longer use a hosted IdP (Cloudflare Access/company IdP, staff OIDC client); staff identity is a first-party realm with mandatory WebAuthn. Layers 3–4 unchanged.
- Refines: ADR-0012 row "Admin access control at the edge"; depends on the IdP choice (ADR-0004).

## Context

`apps/admin` is a Next.js staff console. Today `getStaffSession()` always returns `null`, so every
console route redirects to `/sign-in` (fail closed) — it is safe but not usable. Terraform already
refuses `enable_admin = true` without a non-empty `admin_allowed_cidrs` (never `0.0.0.0/0`) and
adds an ALB `source-ip` condition on the admin host rule.

## Decision — four independent layers; each must deny on its own

1. **Edge identity (required before first deploy):** Cloudflare Access (Zero Trust) application
   on the admin hostname, requiring the company IdP group `karen-staff` and MFA. Origin accepts
   only Cloudflare IP ranges (ALB security group) _and_ the office/VPN CIDRs (`admin_allowed_cidrs`).
   The admin app validates the `Cf-Access-Jwt-Assertion` header (audience tag + team JWKS) in
   Next.js middleware and returns 403 when missing/invalid — so a misconfigured edge still fails
   closed. _(To implement with the staff session, below.)_
2. **Staff session:** a separate OIDC client (not the consumer one) with PKCE, `amr` containing an
   MFA method, session lifetime ≤ 8 h, httpOnly/Secure/SameSite=strict cookies, server-side only
   (`server-only`). `getStaffSession()` returns a session only when this succeeds.
3. **API authorisation (already enforced):** every admin data call goes through the API with the
   staff's access token; `@RequirePermissions()` checks DB-held role grants
   (`identity.staff_role_grants`), never token claims or UI state. Denials are audited.
4. **Audit:** every admin read/write writes `audit.audit_events` (append-only trigger). Staff screens
   show the acting identity.

Navigation filtering in the UI is UX only, never a control.

## Consequences

- Until layers 1–2 are implemented, `enable_admin` must stay `false` (documented blocker).
- Granting a staff role is a DB operation that must itself be audited and restricted to
  `security_admin`; no self-service path exists. Seed data creates staff grants only in local/test.
- If Cloudflare is not adopted, the equivalent is AWS Verified Access or ALB OIDC authentication
  in front of the admin target group; the in-app checks (layers 2–4) are unchanged.
