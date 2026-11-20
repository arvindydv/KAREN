# 0012 — Explicitly deferred decisions

- Status: Accepted · Date: 2026-11-19

These are intentionally **not** decided in the foundation; each has an integration point.

| Topic                                                                                          | Integration point today                                                 | Decide when                          |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------ |
| OIDC provider (Cognito/Auth0/Clerk)                                                            | `OIDC_*` config + `TokenVerifier`                                       | Auth milestone (next)                |
| Web/admin hosting (Vercel vs ECS)                                                              | Standalone Next.js images; Terraform `enable_web/enable_admin` (off)    | Before first public deploy           |
| Identity provider — **resolved by ADR-0015: first-party identity, no hosted IdP** (2026-11-20) | —                                                                       | —                                    |
| Admin access control at the edge (→ ADR-0014, amended by ADR-0017)                             | Terraform requires `admin_allowed_cidrs`; Cloudflare Access recommended | Before admin is deployed             |
| Langfuse SDK                                                                                   | `InvocationSink` in ai-service; keys accepted but unused                | When eval/tracing pipeline is set up |
| Mobile crash reporting                                                                         | `registerErrorReporter` hook                                            | Before beta                          |
| LiveKit client tokens                                                                          | API will mint short-lived tokens; voice worker never mints              | Voice pilot (P1)                     |
| Outbox relay → SQS/EventBridge                                                                 | `platform.outbox_events` table                                          | First cross-service event consumer   |
| Policy engine (OpenFGA/Cedar/OPA)                                                              | In-code `decideExecution` + guards                                      | Only if policy complexity demands    |
| ~~Shared AI daily-budget store~~                                                               | **Resolved by ADR-0013** (Redis, atomic, fail-closed)                   | —                                    |
