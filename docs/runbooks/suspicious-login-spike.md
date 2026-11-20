# Runbook — suspicious sign-in spikes (credential stuffing / spraying)

**Signals:** `karen.auth.login{outcome="invalid_credentials"}` rate ≫ baseline; `karen.auth.rate_limited{limiter="login_per_account"}` rising; many distinct e-mails per source IP at the edge; `karen.auth.hash_saturated` > 0.

1. Confirm at the edge (Cloudflare/ALB logs): source ASNs/IPs, user agents. Add WAF rate rules or blocks for offending ranges; enable a managed challenge on `/v1/auth/login` if available.
2. The API already: limits per IP (fail closed), per account (HMAC-keyed, before hashing), and bounds hashing concurrency (503 instead of meltdown). Lower `API_SENSITIVE_RATE_LIMIT_PER_MINUTE` / `LOGIN_MAX_FAILURES` temporarily if needed (config change + deploy).
3. If successful logins correlate with the spike (`outcome="success"` from new devices, `auth.new_sign_in` mails): treat affected accounts as compromised → `account:status --to LOCKED` (revokes sessions; recovery by e-mail reset).
4. Scale API tasks if `hash_saturated` persists under legitimate load (each task ≈ 4 concurrent hashes, ~256 MiB).
5. Never log submitted e-mails or passwords while investigating.
