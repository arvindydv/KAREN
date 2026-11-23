# 0024 — AI observability content policy

- Status: Accepted · Date: 2026-11-21
- Related: ADR-0012 (Langfuse deferred), ADR-0023. Architecture §2.3, §9; CLAUDE.md security rules.

## Decision

1. **No prompt or completion text** in logs, metrics, traces, audit events, error messages or
   `platform.ai_invocations`. The API logs message ids, error classes and statuses only; the AI
   service logs `user_ref` (HMAC pseudonym), tiers and costs; redaction remains a backstop.
2. **No content-capturing tracing vendor (Langfuse or similar) in Phase 02.** Adding one needs a
   new ADR covering vendor, region, retention, redaction, access control and a DPDP review.
3. Quality signals come from **user feedback** (thumbs + category, stored with the message the
   user owns, exported and erased with it) and **offline evals on synthetic data** (`evals/`).
   Any future "privacy-aware eval sampling" of real conversations requires explicit opt-in
   consent and its own ADR.
4. OpenTelemetry spans carry ids, timings, tiers and outcome classes only.

## Consequences

- Debugging a bad answer needs the user's own report or a synthetic reproduction; this is the
  intended trade-off for privacy.
