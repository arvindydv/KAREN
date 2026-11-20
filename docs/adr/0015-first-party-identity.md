# 0015 — First-party identity: KAREN owns authentication

- Status: Accepted · Date: 2026-11-20
- Supersedes: the Cognito selection recorded as "ADR-0015 — Identity provider selection" in
  `docs/PHASE_00_REPORT.md` §5 (a desk decision that never had its own ADR file), the IdP row of
  ADR-0012, and the _external-IdP premise_ of ADR-0004.
- Keeps from ADR-0004: asymmetric-only JWT verification, exact `iss`/`aud`/`exp`/`nbf` checks, DB-held
  roles, never identifying users by e-mail claims, and the isolated local-dev issuer.
- Related: ADR-0016 (sessions and tokens), ADR-0017 (staff identity realm).

## Context

The product owner has changed KAREN's authentication strategy (Phase 01 instruction, 2026-11-20):
KAREN must own credential verification, account identity, session issuance, authorization and
revocation. Hosted identity services (Cognito, Auth0, Firebase Auth, Clerk, Supabase Auth, Stytch
and similar) may not be used for user **or** staff identity. Google/Apple sign-in is deferred but
must remain possible later. Infrastructure services (e-mail delivery, Secrets Manager/KMS, managed
PostgreSQL, monitoring) remain allowed.

The repository at `2d83cf9` contained: a provider-neutral OIDC verifier configured for Cognito
access tokens; `IdentityService.resolvePrincipal`, which **auto-provisioned** a user the first time
any verified `(issuer, subject)` was seen; DB-held staff roles; a local-dev ES256 issuer; and no
credential, session, recovery or consent endpoints.

## Options considered

| Option                                                                     | Verdict                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Hosted IdP (Cognito, previous decision)                                 | **Rejected by product decision.**                                                                                                                                                                                                                                                                                       |
| B. Self-hosted IdP product (Keycloak, Ory Kratos/Hydra, Zitadel)           | Rejected for now: a new deployable (CLAUDE.md principle 4: 5–7 deployables), its own database and upgrade burden, and a second account model to reconcile with `identity.users`. Revisit only if federation/SSO requirements outgrow the module.                                                                        |
| C. Full OAuth 2.0 / OIDC authorization server inside the API               | Rejected for Phase 01: our clients are first-party; an authorization server adds consent screens, client registration, PKCE/redirect handling and discovery documents we do not need, and every extra protocol surface is attack surface. If third-party clients or federation ever require it, use a reviewed library. |
| **D. First-party identity module in `apps/api` with first-party sessions** | **Chosen.** Isolated module and Postgres schema (`identity`), opaque server sessions for web, opaque rotating refresh credentials + short-lived signed access tokens for mobile (ADR-0016). Extractable later behind the same contracts if load or organisational evidence justifies it.                                |

## Decision

1. **Identity of record** is `identity.users` (UUID). Login identifiers attach to it:
   `identity.user_emails` (one canonical e-mail per account in Phase 01) and, later,
   `identity.external_identities` for Google/Apple _linking_ (kept, not removed). Accounts are
   created only by explicit provisioning (`AccountService`), **never** as a side effect of
   authenticating a request. The roadmap's `POST /v1/identity/bootstrap` (which existed to map an
   external IdP subject) is **not built**: registration provisions the account.
2. **Account lifecycle** is a state machine — `PENDING_VERIFICATION → ACTIVE ↔ LOCKED/SUSPENDED →
DELETION_REQUESTED → DELETED` (exact table in `@karen/domain` `ACCOUNT_TRANSITIONS`) — enforced in
   application code **and** by a database trigger, with an integration test asserting both agree on
   every pair. Only `ACTIVE` has full API access.
3. **Passwords** (NIST SP 800-63B-4, OWASP Password Storage):
   - Argon2id via `@node-rs/argon2` (no install scripts; prebuilt binaries; MIT). Verified in unit tests
     against the phc-winner-argon2 reference vector. Parameters v1: **m = 64 MiB, t = 3, p = 1**
     (RFC 9106 §4 second recommended option), chosen by benchmark
     (`docs/security/password-hashing-benchmark.md`). Parameters live in the PHC string, so raising
     them is a code change plus rehash-on-login.
   - Unique 16-byte CSPRNG salt per hash. No plaintext, no reversible encryption.
   - **Pepper**: Argon2's secret input, ≥ 32 bytes, versioned by id (`PASSWORD_PEPPERS`,
     `PASSWORD_PEPPER_CURRENT_ID`), held in Secrets Manager, **required in deployed environments**.
     Justification: the runtime DB role can read verifiers through the pre-auth lookup, so a
     database-only compromise (SQL injection, leaked backup) must not yield offline-crackable hashes.
     Cost: losing every pepper version means every user must reset; retired ids stay configured until
     no hash references them. Rotation = add id, switch current, rehash on login, force reset for
     dormant hashes after a published window.
   - Policy: 15–256 code points after NFKC; no composition rules; no periodic expiry; reject common
     base-word concatenations, repetition/sequences and context words (service name, own e-mail).
     A comprehensive breached-password corpus is **not yet** integrated (needs a data-source decision —
     see `docs/PHASE_01_PLAN.md` §6).
   - All hashing goes through a bounded per-process concurrency gate; saturation returns a retryable
     503 and never weakens parameters.
   - Unknown accounts cost one full dummy verification (timing parity against enumeration).
4. **E-mail** is canonicalized (trim, ASCII dot-atom local part lower-cased, IDNA→punycode domain,
   no provider-specific folding) and unique case-insensitively in the database (CHECK constraints
   refuse non-canonical values). E-mail OTP is an e-mail-ownership and recovery mechanism, not
   phishing-resistant MFA, and is never sufficient for staff (ADR-0017).
5. **Pre-authentication reads** go only through narrow `SECURITY DEFINER` functions that match one
   exact key (`identity.lookup_password_login`), keeping RLS deny-by-default for everything else.
6. **Sessions and tokens**: ADR-0016. **Staff identity**: ADR-0017.
7. **Future federation** (Google/Apple): an external identity may be _linked_ to an existing account
   only through an authenticated linking flow or a verified-e-mail match with explicit user
   confirmation; never silently merged by e-mail claim (pre-account-takeover defence).

## Consequences

- KAREN carries the operational burden an IdP vendor would: abuse protection, e-mail deliverability,
  recovery, key management, incident response. Runbooks and monitoring are Phase 01 M10 deliverables.
- `AUTH_MODE=oidc` and the Cognito-specific verifier options (`OIDC_AUDIENCE_CLAIM=client_id`,
  `OIDC_REQUIRED_TOKEN_USE`, the Cognito issuer regex) become dead configuration. They are removed in
  M3, when the first-party session/access-token verifier replaces them; until then deployed
  environments fail closed (no IdP is configured and unknown identities are no longer provisioned).
- Terraform `oidc_*` variables and their Cognito comments are replaced in M3 (no AWS deploy in this
  phase).
- Reversal: the identity module keeps `(issuer, subject)` linking, so adding an external IdP later is
  additive. Moving password hashes to another system is possible (standard PHC Argon2id strings) as
  long as the pepper is moved with them.
