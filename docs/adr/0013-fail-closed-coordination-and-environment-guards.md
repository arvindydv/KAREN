# 0013 — Fail-closed coordination and environment guards

- Status: Accepted · Date: 2026-11-20
- Supersedes: the "Shared AI daily-budget store" row of ADR-0012; extends ADR-0007 and ADR-0011.

## Context

The foundation review (docs/FOUNDATION_READINESS_REPORT.md) found five places where a
degraded dependency or a missing setting silently weakened a control:

1. The API rate limiter returned "not blocked" on any Redis error (fail-open), including for
   authentication routes. Its window key was created by `INCR` then a separate `PEXPIRE`, so a
   crash between the two could leave a key with no TTL.
2. The AI daily budget was an in-process counter: N replicas ⇒ up to N × budget, reset on restart.
3. `APP_ENV` defaults to `local`. A deployed container that forgot `APP_ENV` would accept
   unsigned internal calls (ai-service) and allow `AUTH_MODE=local-dev`.
4. Internal HMAC signatures could be replayed within the 300 s window, and rotation needed a
   restart with a single secret (no overlap).
5. Fastify `trustProxy: true` took the left-most (client-supplied) `X-Forwarded-For` entry as the
   client IP, so rate limits could be dodged by sending a fake header.

## Decision

| Control                                                                                      | Behaviour when its store is unavailable                                         |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `sensitive` API throttler (`@SensitiveRateLimit()`: auth, OTP, recovery, approval decisions) | **Fail closed**: retryable `503 DEPENDENCY_UNAVAILABLE`                         |
| `default` API throttler                                                                      | **Degrade**: bounded per-process fixed window (limit holds per replica)         |
| AI daily budget (`RedisDailyBudgetTracker`)                                                  | **Fail closed** before any gateway call: retryable `503 CAPABILITY_UNAVAILABLE` |
| Internal-auth replay cache (`RedisSignatureReplayGuard`, POST/PUT/PATCH/DELETE)              | **Fail closed**: retryable `503 CAPABILITY_UNAVAILABLE`                         |

- Rate-limit windows are created atomically: `MULTI { SET key 0 PX ttl NX; INCR; PTTL }`.
- The AI budget is a per-UTC-day Redis hash; reserve/settle/release are single Lua scripts using
  integer micro-USD. A reservation from a crashed process stays counted for that day
  (over-counts, never under-counts). Settings **refuse** `KAREN_AI_BUDGET_STORE=memory` in
  dev/staging/production. Vercel gateway-side budgets remain the third layer (architecture §2.7).
- Replay: a verified signature is accepted once (`SET NX EX 601`). Callers already re-sign
  every attempt, so legitimate retries are unaffected. Safe methods are exempt.
- Rotation: the ai-service verifier accepts `INTERNAL_SERVICE_HMAC_SECRET` and, during a
  rotation window, `INTERNAL_SERVICE_HMAC_SECRET_PREVIOUS` (constant-time comparison against
  both). Procedure in docs/security/internal-service-auth.md.
- All container images set `KAREN_DEPLOYED_ARTIFACT=true`; configuration then refuses to start
  without an explicit `APP_ENV` (TS `loadEnv`, ai-service and voice-agent settings).
- The API trusts exactly `API_TRUSTED_PROXY_HOPS` proxies (Terraform: 2 = Cloudflare → ALB).
- The AI wire contract is unchanged: coordination outages reuse `CAPABILITY_UNAVAILABLE`
  (503, retryable) instead of adding an error code.

## Consequences

- Redis is now on the critical path for auth-like routes and for every billable model call.
  ElastiCache Multi-AZ with automatic failover is required for production (the production
  environment defaults to `redis_multi_az = true`, `redis_num_cache_clusters = 2`; keep it); a Redis outage pauses AI completions instead of risking unbounded spend.
- Redis remains non-authoritative (ADR-0011): losing it loses at most a day's counters, which
  then restart from zero — the gateway-side budget is the backstop for that case.
- New dependency: `redis==8.1.0` (ai-service), released 2026-07-30, no transitive packages.
- Tests: unit tests use in-memory stores; `pnpm test:integration` (`pytest -m integration`)
  proves cross-replica atomicity, fail-closed behaviour and replay refusal against real Redis;
  API integration tests prove the sensitive limiter fails closed and the default degrades.
