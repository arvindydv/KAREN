# Runbook — Redis outage

**What fails closed (by design, ADR-0013):** sign-up, sign-in, OTP verification/resend, password reset, e-mail change, refresh (needs the replay store), staff sign-in ceremonies, internal data-rights calls (replay guard). Users see "temporarily unavailable — retry".
**What keeps working:** requests with an existing session (session liveness is checked in PostgreSQL), profile/settings reads and writes, consent changes, default rate limit (per-process fallback).

1. Check ElastiCache health and the `/health/ready` redis check.
2. Do NOT switch limiters to fail-open. Do not bypass replay checks.
3. After recovery: login throttles and e-mail budgets restart empty (acceptable); refresh replay entries were short-lived (10 s) — no action.
