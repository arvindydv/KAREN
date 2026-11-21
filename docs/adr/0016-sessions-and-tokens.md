# 0016 — First-party sessions, access tokens and refresh rotation

- Status: Accepted (design; implementation in Phase 01 M3) · Date: 2026-11-20
- Depends on: ADR-0015. Keeps from ADR-0004: asymmetric-only JWT verification and claim checks.

## Context

Clients: Next.js web (server components + route handlers can act as a BFF), Expo mobile, Next.js
admin (ADR-0017). Revoked sessions must stop reaching protected APIs; the API must scale
horizontally with no process-local auth state; Redis is ephemeral (ADR-0011/0013).

## Options considered

| Option                                                        | Assessment                                                                                                                                                      |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Long-lived JWTs everywhere                                    | Rejected: revocation needs a deny-list on every request anyway, and a stolen token is usable until expiry.                                                      |
| JWT access token in browser JS (localStorage)                 | Rejected: XSS-exfiltratable.                                                                                                                                    |
| **Web: opaque session in an HttpOnly cookie held by the BFF** | **Chosen.** The browser never sees a bearer token.                                                                                                              |
| **Mobile: opaque rotating refresh + short-lived access JWT**  | **Chosen.** Short access TTL bounds stateless validity; refresh is server-checked, rotated, and bound to a session record.                                      |
| Mobile: opaque session token on every call (no JWT at all)    | Viable and simpler; rejected only because the voice/realtime path (LiveKit, ai-service) benefits from a verifiable, audience-scoped token. Revisit if unneeded. |

## Decision

**Session record (`identity.sessions`) is authoritative.** Fields: id, user_id, realm (`consumer`),
client kind (`web`/`ios`/`android`), device id, created/last_seen/idle_expires/absolute_expires,
revoked_at + reason, `auth_time`, `amr`, step-up timestamp. Refresh families
(`identity.refresh_credentials`): verifier (SHA-256 of a 256-bit opaque token), family id,
generation, parent, consumed_at, replaced_by, expires_at.

**Web.** Login is posted to a Next.js route handler, which calls the API and stores the returned
opaque session token in `__Host-karen_session` (HttpOnly, Secure, SameSite=Lax, Path=/, no Domain).
Server code forwards it to the API; the API validates the session row on **every** request (indexed
primary-key lookup on the verifier). Idle timeout 30 min sliding (bounded write amplification: refresh
`last_seen` at most once per 5 min), absolute 30 days. CSRF: SameSite plus an Origin/`Sec-Fetch-Site`
check on every state-changing route handler, plus a per-session CSRF token for forms. Session id
rotated on login, privilege change and step-up (fixation defence). Nonce-based CSP replaces
`'unsafe-inline'` for scripts in authenticated pages.

**Mobile.** Login returns `access_token` (ES256 JWT, 10 min, `typ=at+jwt`, `aud=karen-api`,
`iss=<API_PUBLIC_BASE_URL>`, `sub`=user UUID, `sid`, `realm=consumer`, `jti`) and `refresh_token`
(`krt_…`, 30-day absolute, single-use). Stored only in SecureStore (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`).

**Access-token validation** = signature (kid → key from the API's own key set; ES256 only; `none`/HS\*
impossible) + `iss` + `aud` + `typ` + `exp`/`nbf` (30 s skew) + `realm` + **session liveness**:
`sid` is checked against a Redis revocation set populated synchronously on revoke, with the DB as
fallback. If Redis is unavailable the API checks the session row in PostgreSQL (fail-safe, slower);
if both are unavailable the request is denied (503, retryable). Revocation latency target: immediate
for requests that reach the check; worst case bounded by access-token TTL only if both stores fail
and that is explicitly NOT accepted — we deny instead.

**Signing keys.** Private keys in KMS (asymmetric ECC_NIST_P256 sign/verify) or, until KMS is
available, Secrets Manager–held PEM. Published key set holds current + previous kid. Rotation:
publish next → sign with next after one access TTL → retire previous after one more TTL. KMS
outage ⇒ no new access tokens (refresh returns 503); existing tokens keep verifying from the cached
public key set.

**Refresh rotation and reuse detection.**

1. Presented refresh token → look up verifier `FOR UPDATE`.
2. Unknown / expired / session revoked → 401.
3. Already consumed:
   - consumed ≤ 10 s ago **and** the successor has not yet been used **and** same device id ⇒ return
     the same successor again (idempotent retry after a lost response or a mobile kill mid-refresh);
   - otherwise ⇒ **reuse**: revoke the whole family and its session, audit
     `identity.refresh.reuse_detected`, notify the user. One stolen-token replay costs the
     legitimate user one re-login, never silent account access.
4. Not consumed ⇒ mark consumed, insert successor (generation + 1) in the same transaction.
   Concurrent refreshes serialize on the row lock; exactly one creates a successor, the others take
   branch 3's idempotent path. No two valid descendants can exist.

**Logout / revocation.** Logout (current) revokes the session + family; logout-all revokes every
session of the user; password change revokes all other sessions; suspension/lock revokes all.
Revocation writes the DB row first, then the Redis set; a Redis write failure is logged and the DB
fallback covers it (a request either sees the Redis entry or — when Redis is degraded — reads the DB).

## Consequences

- Every authenticated request costs one cheap lookup (Redis set or PK read). Budget in
  `docs/architecture/identity-architecture.md` §10; measured in M10.
- The BFF is now security-critical code in `apps/web`; it gets its own tests (CSRF, cookie flags,
  open-redirect).
- Clients never handle passwords after submission and never persist them.

## Implementation notes (Phase 01 M3, 2026-11-20)

Implemented as designed except for these deliberate changes:

| Design above                                                          | Implemented                                                                                                                                         | Why                                                                                                                                                                                |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Liveness via a Redis revocation set, PostgreSQL fallback              | **PostgreSQL only**: the session row is read in the same transaction that loads account status and roles                                            | Strongly consistent revocation with no cache to invalidate and no Redis-down special case; still one transaction per request. Performance measured in M10 before adding any cache. |
| Web idle timeout 30 min                                               | `WEB_SESSION_IDLE_HOURS` default **24 h** (sliding), absolute 30 days                                                                               | 30 min idle is impractical for a consumer assistant; sensitive operations will require recent re-authentication (`authTime` on the principal) instead. Configurable.               |
| Idempotent retry "returns the same successor" (mechanism unspecified) | Successor token sealed (AES-256-GCM, HKDF-derived key, bound to the installation id) in Redis for **10 s**, written inside the rotating transaction | We never store refresh tokens at rest, so re-delivery needs a short-lived encrypted copy. Written before commit so a concurrent retry waiting on the row lock always finds it.     |
| —                                                                     | Refresh is **not** on the strict per-IP limiter                                                                                                     | Many devices share carrier NAT addresses and refresh every few minutes; 256-bit single-use tokens + reuse detection bound abuse.                                                   |
| KMS-held signing key                                                  | Secrets-Manager-held EC P-256 JWKs (`ACCESS_TOKEN_SIGNING_KEYS`), rotation by `kid`                                                                 | KMS signing needs AWS access (not available); the key-set interface is unchanged when KMS lands.                                                                                   |
| `OIDC_*` / Cognito verifier                                           | **Removed** (code, config, Terraform)                                                                                                               | ADR-0015.                                                                                                                                                                          |

Additional controls: refresh from a different installation id revokes the session
(`device_mismatch`); leaving ACTIVE (lock/suspend/deletion request) and password reset revoke all
sessions in the same transaction; per-account failed-login throttle keyed by an HMAC of the
submitted e-mail (existing or not); new-device sign-in notice e-mail.

## Implementation notes (Phase 01 M9, BFFs)

- Web: `__Host-karen_session` (HttpOnly, Secure, SameSite=Lax); admin: `__Host-karen_staff`
  (SameSite=Strict). Plain-http names only for `APP_ENV=local|test`. Double-submit CSRF cookies
  use the `__Host-` prefix too, so a sibling subdomain cannot plant them. Per-request nonce CSP
  (`script-src 'self' 'nonce-…' 'strict-dynamic'`, no `'unsafe-inline'` for scripts).
- **Rate limits behind a BFF:** the BFF forwards the end-user IP (from its trusted proxy hops)
  HMAC-signed with `INTERNAL_SERVICE_HMAC_SECRET`; the API's limiter key uses it only when the
  signature verifies within 60 s (`@karen/domain/node` client-ip, `ClientIpThrottlerGuard`).
  Otherwise every web user would share the BFF's single bucket. A captured signature lets its
  holder claim that one IP for ≤ 60 s — accepted (it only affects that IP's own bucket).
