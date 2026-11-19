# 0004 — Provider-neutral OIDC, server-held roles, isolated local-dev issuer

- Status: Accepted · Date: 2026-11-19

## Context

Architecture §3/§10: Cognito, Auth0 or Clerk are to be _evaluated_. Coupling the platform to one now would be premature. Passkeys/step-up auth are required later.

## Decision

- The API verifies access tokens with `jose`: signature against the IdP JWKS (cached; unknown `kid` triggers a refetch so key rotation needs no restart), `iss`, `aud`, `exp/nbf/iat`, required `sub`, and an **asymmetric-only** algorithm allow-list (HS*/`none` rejected at construction and at config validation).
- Users are identified internally by `identity.external_identities(issuer, subject)` → `identity.users.id`. Never by e-mail.
- **Staff roles live in the database** (`identity.staff_role_grants`); token claims never grant permissions. Permissions derive from `ROLE_PERMISSIONS` in `@karen/api-contracts`, enforced only by API guards (`AuthGuard` → `PermissionsGuard`), with denials audited.
- **Local-dev issuer**: `AUTH_MODE=local-dev` generates an in-memory ES256 key pair at boot and exposes `POST /dev/auth/token` (subjects restricted to `dev|…`). Config validation refuses this mode unless `APP_ENV` is `local` or `test`; the route is not registered otherwise; tests cover both. Tokens go through the same verifier as production tokens. No static secret exists.

## Consequences

Choosing the IdP is milestone work: set `OIDC_*`, add sign-in UIs (web/admin/mobile), refresh-token handling and step-up (`acr`/`amr` are already surfaced on the verified token).
