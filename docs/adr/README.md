# Architecture Decision Records

One file per significant decision. Status: `Accepted`, `Superseded by NNNN`, or `Proposed`.
Copy `0000-template.md`, take the next number, and link the ADR from the PR that implements it.

| #                                                               | Decision                                                                                                            | Status                       |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| [0001](0001-monorepo-tooling.md)                                | pnpm + Turborepo for TypeScript, uv for Python, no cross-forcing                                                    | Accepted                     |
| [0002](0002-esm-typescript-runtime.md)                          | All-ESM TypeScript on Node 24; NestJS 12 + Fastify; TypeScript 6.0 (not 7)                                          | Accepted                     |
| [0003](0003-canonical-task-state-machine.md)                    | One canonical task state machine reconciling the two source documents                                               | Accepted                     |
| [0004](0004-provider-neutral-oidc.md)                           | Provider-neutral OIDC/JWKS verification, DB-held roles, isolated local-dev issuer                                   | Partially superseded by 0015 |
| [0005](0005-database-prisma-schemas.md)                         | Prisma 7 + pg driver adapter, Postgres schema per owning module, pgvector via SQL                                   | Accepted                     |
| [0006](0006-wire-contracts.md)                                  | snake_case wire format; zod-first contracts → OpenAPI → generated client; shared AI fixtures                        | Accepted                     |
| [0007](0007-internal-service-auth.md)                           | Timestamped HMAC request signing between internal services                                                          | Accepted                     |
| [0008](0008-model-gateway-and-router.md)                        | ModelRouter → GatewayClient → Vercel AI Gateway; mock by default; live gated on verified registry                   | Accepted                     |
| [0009](0009-temporal-execution.md)                              | Temporal dev server locally / Temporal Cloud deployed; split task queues; reconcile-before-retry                    | Accepted                     |
| [0010](0010-supply-chain-release-age.md)                        | Exact pins + 7-day minimum release age for npm; ~2-week cutoff for Python                                           | Accepted                     |
| [0011](0011-redis-engine.md)                                    | Redis 7.4 locally, ElastiCache Valkey deployed; URL or discrete-part config                                         | Accepted                     |
| [0012](0012-deferred-decisions.md)                              | Explicitly deferred choices (IdP, web hosting, Langfuse SDK, mobile crash reporter…)                                | Accepted                     |
| [0013](0013-fail-closed-coordination-and-environment-guards.md) | Fail-closed sensitive rate limits, shared atomic AI budget, replay guard + key rotation, explicit APP_ENV in images | Accepted                     |
| [0014](0014-admin-console-access-control.md)                    | Admin console: edge identity (Cloudflare Access) + staff OIDC/MFA + API RBAC + audit                                | Amended by 0017              |
| [0015](0015-first-party-identity.md)                            | First-party identity: KAREN owns authentication; Argon2id + pepper; account state machine; no hosted IdP            | Accepted                     |
| [0016](0016-sessions-and-tokens.md)                             | Opaque BFF web sessions; mobile short access JWT + rotating refresh with reuse detection; revocation                | Accepted                     |
| [0017](0017-staff-identity-realm.md)                            | Separate staff realm, mandatory WebAuthn, JIT elevation, offline bootstrap, break-glass                             | Accepted                     |
| [0018](0018-transactional-email-brevo.md)                       | Brevo SMTP for transactional e-mail; OTPs HMAC-verified, dispatched post-commit, never at rest                      | Accepted                     |
| [0019](0019-consent-notices-and-receipts.md)                    | Purpose consent, immutable versioned notices, append-only hash-chained receipts, server-side enforcement            | Accepted                     |
