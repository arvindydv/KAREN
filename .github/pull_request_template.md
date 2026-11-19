## What & why

<!-- What does this change do, and which product/architecture requirement does it serve? -->

## How it was verified

<!-- Commands you ran and their results. "Not verified" is an acceptable, honest answer. -->

- [ ] `pnpm verify` (format, public-env guard, lint, typecheck, unit tests, build)
- [ ] `pnpm test:integration` (if DB/Redis/Temporal behaviour changed)
- [ ] `pnpm verify:py` (if Python changed)
- [ ] `pnpm contracts:check` (if API contracts changed)

## Safety checklist

- [ ] No secrets, tokens or real personal data in code, fixtures, logs or screenshots
- [ ] Authorization is enforced server-side; client-supplied identity/permissions are not trusted
- [ ] Sensitive actions still require backend policy + approval (no LLM-authorised side effects)
- [ ] No invented external API capabilities or model IDs
- [ ] Migrations are backwards compatible (expand/contract) and reviewed
- [ ] Architecture docs / ADRs updated for significant decisions
