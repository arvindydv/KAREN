# Identity threat model & verification traceability (Phase 01)

Scope: first-party consumer identity, sessions, recovery, consent and staff identity (ADR-0015/16/17).
Extends `docs/security/threat-model.md`. Status column: **M1** = implemented and tested in this
milestone; **Mx** = designed, implemented in that milestone; **RESIDUAL** = accepted risk.

## 1. Threats and controls

| #   | Threat                                      | Control (design)                                                                                                                                                                | Status / evidence                                                                                   |
| --- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| T1  | Credential stuffing                         | Per-IP fail-closed limiter, per-account progressive delay, hashing gate, breached-password check, new-device notification                                                       | Limiter exists (ADR-0013); account limiter M2; breached corpus **pending decision**                 |
| T2  | Brute force / distributed guessing          | Per-account counters keyed by canonical-e-mail hash (not IP), temporary lock per account+IP prefix, 15-char minimum                                                             | Policy **M1** (`password-policy.test.ts`); counters M2                                              |
| T3  | User enumeration                            | Identical register/forgot/resend responses with decoy handles; generic login failure; dummy Argon2id verify for unknown accounts; status revealed only after a correct password | Dummy verify **M1**; identical responses + decoys **M2** (`auth-flows.int.test.ts`)                 |
| T4  | Password spraying                           | Common/base-word/sequence/context rejection; per-IP limits across accounts; anomaly metrics                                                                                     | Policy **M1**; metrics M10                                                                          |
| T5  | Database compromise                         | Argon2id 64 MiB/t3 + **pepper outside DB**; refresh/session/challenge stored as SHA-256 verifiers; runtime role cannot read other users' rows                                   | **M1** (`password-hasher.test.ts` "peppered hash cannot be verified without the pepper"; RLS tests) |
| T6  | Session hijacking                           | Web: opaque token only server-side (BFF cookie, M9); mobile: 10-min ES256 access token; session row checked on every request; device-bound refresh                              | **M3** (`sessions.int.test.ts`)                                                                     |
| T7  | Session fixation                            | Server-generated session ids only; rotate on login/step-up/privilege change                                                                                                     | M3                                                                                                  |
| T8  | Refresh-token theft & reuse                 | Single-use rotation under `FOR UPDATE`; reuse or foreign installation revokes the session; 10 s sealed same-installation retry                                                  | **M3** (`sessions.int.test.ts` rotation/retry/concurrency/reuse/device-mismatch)                    |
| T9  | CSRF                                        | SameSite + Origin/Sec-Fetch-Site + CSRF token on BFF mutations; API itself takes no cookies                                                                                     | M3/M9                                                                                               |
| T10 | XSS → token theft                           | No tokens in browser JS; nonce CSP without `unsafe-inline` scripts                                                                                                              | M9 (current CSP still has `unsafe-inline` — known gap)                                              |
| T11 | Token forgery / algorithm confusion         | ES256 only; `typ=at+jwt`; `iss`/`aud`/`realm`/`exp`/`nbf`; known `kid`; UUID `sub`/`sid`                                                                                        | **M3** (`access-token.test.ts`)                                                                     |
| T12 | Cross-service / cross-realm token confusion | Typed opaque prefixes (`kss_`/`krt_`/`kev_`/`kpr_`), `aud=karen-api`, `realm=consumer`, `typ=at+jwt`                                                                            | **M1** prefixes, **M3** claims; staff realm M8                                                      |
| T13 | Replay of one-time codes                    | Single-use challenges consumed under `FOR UPDATE`; 5 attempts; 15 min expiry; HMAC-keyed verifiers                                                                              | **M2** (`auth-flows.int.test.ts`: replay, brute force, expiry, concurrent reset)                    |
| T14 | Insecure recovery / e-mail compromise       | Reset notifies; no auto-login; LOCKED→ACTIVE only via reset; no security questions; session revocation on reset                                                                 | **M2** (no auto-login, notice mail, unlock); session revocation M3                                  |
| T15 | Pre-account takeover                        | No accounts from tokens; codes bound to client-held handles; mailbox owner reclaims via reset (closes attacker's codes)                                                         | **M1** + **M2** (`auth-flows.int.test.ts` "pre-account takeover")                                   |
| T16 | MFA downgrade / bypass (staff)              | WebAuthn mandatory every sign-in; no OTP fallback; recovery two-person                                                                                                          | M8                                                                                                  |
| T17 | Privilege escalation                        | Roles from DB only; no public staff signup; separate realm; JIT with expiry; state machine forbids escaping suspension via deletion request                                     | Role-claim test (existing); state machine **M1** (DB ≡ domain parity test)                          |
| T18 | IDOR / BOLA / cross-user leakage            | User from verified credential only; `/me` routes without ids; RLS on every user table; ownership checks on `:id` routes                                                         | RLS **M1** for new tables (`identity.int.test.ts` RLS block)                                        |
| T19 | Insider abuse                               | Staff reads require permission + reason, audited; bulk-access alerts; break-glass two-person                                                                                    | M8                                                                                                  |
| T20 | DoS on hashing / DB / Redis                 | Bounded hashing gate (queue cap + timeout → 503), statement timeout, pool limits, fail-closed limiter                                                                           | Gate **M1** (`concurrency-gate.test.ts`, hasher saturation test)                                    |
| T21 | Race conditions                             | Unique canonical e-mail, optimistic versions, `FOR UPDATE` on refresh/challenges                                                                                                | Registration race + transition race **M1**; refresh race M3                                         |
| T22 | Dependency compromise                       | Exact pins + 7-day release age; no install scripts for the hashing library; KAT against reference vector                                                                        | **M1** (`@node-rs/argon2` 2.2.2; KAT in `password-hasher.test.ts`)                                  |
| T23 | Secrets exposure                            | Peppers/keys in Secrets Manager/KMS; required-when-deployed config; parser errors never echo key material; nothing secret in `NEXT_PUBLIC_*`                                    | **M1** (`env.test.ts`, `parsePepperKeys` test)                                                      |
| T24 | Sensitive data in logs                      | Never log passwords/codes/tokens/e-mails; `user_ref` pseudonyms; audit holds UUIDs + reason codes only                                                                          | **M1** audit rows asserted free of e-mail; log-capture test M10                                     |
| T25 | Misconfigured infrastructure                | Config validation at boot; local-dev auth refused outside local/test; staff disabled by default                                                                                 | Existing + pepper rules **M1**                                                                      |

Additional M4 controls: sensitive account changes (e-mail, password) require the current
password, share the sign-in throttle, revoke other sessions and notify by e-mail; e-mail change
codes go only to the new address and are bound to the requesting account; changing to an address
owned by another account returns an indistinguishable decoy.

## 2. Residual risks

- **R1** The runtime DB role can call `lookup_password_login` for any e-mail it already knows and obtain
  that account's verifier. Mitigated by the pepper (not in DB) and by the absence of any enumeration
  path; not eliminated.
- **R2** E-mail is a weak recovery channel: whoever controls the mailbox can reset a password-only
  account. Consumer passkeys/MFA (post-Phase 01) reduce this.
- **R3** The transactional e-mail provider (Brevo, ADR-0018) sees one-time codes in transit.
- **R3a** `forgot-password` does a few more DB writes for real accounts than for unknown addresses;
  the millisecond timing difference is not equalized. Mitigated by per-IP and per-address limits.
- **R3b** OTP mail is dispatched in-process after commit; a crash in that window loses the mail
  (the user resends). Chosen over storing codes at rest (ADR-0018).
- **R4** Until a breached-password corpus is integrated, passwords that are long but present in breach
  lists and not covered by our base-word heuristics are accepted.
- **R5** Account-level lockout can be abused to annoy a known user; mitigated by IP-prefix scoping and
  recovery unlock, not eliminated.
- **R6** Argon2id cost on the production task size is unmeasured; the per-process gate bounds damage but
  capacity planning is open until M10.
- **R7** Backups retain deleted data until they expire; deletion is not instantaneous across backups.

## 3. OWASP ASVS 5.0 traceability (chapter level)

Requirement-level IDs must be filled from the official ASVS 5.0 text (https://asvs.owasp.org/) during
M10; the mapping below is at chapter level and is **NOT VERIFIED** against individual requirement
numbers.

| ASVS 5.0 chapter                      | Phase 01 controls                                                                                      | Tests (now)                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| V6 Authentication                     | Password length/normalization/blocklist, Argon2id + pepper, uniform-cost failure, no auto-provisioning | `password-policy.test.ts`, `password-hasher.test.ts`, `identity.int.test.ts`, `app.int.test.ts` |
| V7 Session Management                 | ADR-0016 (M3)                                                                                          | —                                                                                               |
| V8 Authorization                      | DB roles, RLS, ACCOUNT_INACTIVE per request                                                            | `rls.int.test.ts`, `app.int.test.ts`, `identity.int.test.ts`                                    |
| V9 Self-contained Tokens              | Asymmetric allow-list, claim checks, typ/realm (M3)                                                    | `token-verifier.test.ts`                                                                        |
| V11 Cryptography                      | CSPRNG salts/tokens, Argon2id KAT, constant-time verifier compare                                      | `password-hasher.test.ts`, `opaque-token.test.ts`                                               |
| V13 Configuration                     | Required-when-deployed secrets, local-dev isolation                                                    | `env.test.ts`, `app.int.test.ts`                                                                |
| V14 Data Protection                   | No plaintext secrets at rest (DB CHECKs), minimal audit data                                           | `identity.int.test.ts`                                                                          |
| V16 Security Logging & Error Handling | Audit of account creation/rejection/transitions; standard error envelope                               | `identity.int.test.ts`, `app.int.test.ts`                                                       |
| V2 Validation & Business Logic        | E-mail canonicalization, state machine                                                                 | `identity.test.ts` (domain), DB parity test                                                     |
