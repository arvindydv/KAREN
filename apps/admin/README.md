# @karen/admin — staff operations console

Next.js 16 BFF for the staff realm (ADR-0017). Staff sign in with **password + WebAuthn security
key every time**. The browser talks only to this app; route handlers and server components call
the API with the opaque `kst_` staff token held in an HttpOnly cookie.

## Security model (summary)

- Session cookie `__Host-karen_staff` (HttpOnly, Secure, Path=/, SameSite=Strict). Only under
  `next dev` with `APP_ENV=local|test` is it `karen_staff` without Secure (plain-http localhost).
- Every browser → BFF call (`/api/session/*`, `/api/staff/*`) requires `Origin` = app origin and a
  double-submit CSRF token (`__Host-karen_staff_csrf` cookie echoed in `x-csrf-token`).
- `/api/staff/*` relays only an explicit allowlist (`src/lib/bff/allowlist.ts`); bodies are
  validated against `@karen/api-contracts`; browser cookies are never forwarded.
- Per-request nonce CSP from `src/proxy.ts` (`script-src 'self' 'nonce-…' 'strict-dynamic'`).
- Navigation filtering is display-only; the API enforces permissions and step-up.

## Configuration (server-only)

See `.env.example`: `APP_ENV`, `API_INTERNAL_BASE_URL`, `ADMIN_APP_ORIGIN` (required outside
local/test).

## Tests

```bash
pnpm --filter @karen/admin test        # Vitest
pnpm --filter @karen/admin test:e2e    # Playwright smoke (port 3101, no API needed)
```

### Opt-in WebAuthn flow against a real API

`e2e/webauthn-flow.spec.ts` drives enroll → sign in → step-up with Chromium's virtual
authenticator. It is skipped unless `KAREN_E2E_API=1` and is not part of CI:

1. Run the API with `STAFF_AUTH_ENABLED=true`, `STAFF_DATABASE_URL=<staff role URL>`,
   `STAFF_WEBAUTHN_RP_ID=localhost`, `STAFF_WEBAUTHN_ORIGINS=http://localhost:3101`.
2. `pnpm --filter @karen/api staff:bootstrap -- --email ops@karen.test --name "E2E Admin"` (use a
   throwaway database: bootstrap refuses once any staff account exists).
3. `KAREN_E2E_API=1 KAREN_E2E_ENROLLMENT_TOKEN=ken_… KAREN_E2E_STAFF_EMAIL=ops@karen.test pnpm --filter @karen/admin test:e2e e2e/webauthn-flow.spec.ts`
