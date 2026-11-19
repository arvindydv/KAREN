# Contributing

## Workflow

- Trunk-based: short-lived branches off `main`, PRs required, CI must pass (protected branch). Use Conventional Commits (`feat(api): …`, `fix(ai): …`, `docs(adr): …`).
- One logical change per PR; include how it was verified (see PR template). Significant decisions → new ADR in `docs/adr/`.

## Local conventions

- Node 24 + pnpm (Corepack), uv for Python. Run `pnpm setup:env` once; never commit `.env`.
- Formatting: Prettier (TS/JSON/MD), ruff format (Python), `terraform fmt`.
- Imports: only from package entrypoints (`@karen/domain`, `@karen/domain/node`) — deep imports and cross-app relative imports fail lint.
- Wire DTOs are snake_case; TypeScript identifiers camelCase.
- Add dependencies with exact versions at least 7 days old; explain why in the PR.
- Tests live next to code (`*.test.ts`) or in `test/*.int.test.ts` for integration. Keep them deterministic — no real network to paid/external services.
- Updating the public API: change zod schemas/controllers → `pnpm contracts:generate` → commit `openapi/` and `src/generated/`.
- Updating the AI wire contract: follow `apps/ai-service/CLAUDE.md` (bump `CONTRACT_VERSION`, update fixtures, both test suites).
- Database: `pnpm db:migrate`, review SQL, expand/contract for breaking changes.

## Before pushing

`pnpm verify` (+ `pnpm test:integration`, `pnpm verify:py`, `pnpm infra:validate` as relevant).
