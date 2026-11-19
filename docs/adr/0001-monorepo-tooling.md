# 0001 — Monorepo tooling

- Status: Accepted · Date: 2026-11-19

## Context

Architecture §13 prescribes pnpm + Turborepo for TypeScript and uv for Python, and says multi-language code should not be forced into one package manager.

## Decision

- TypeScript workspaces: `apps/{api,web,admin,mobile,temporal-worker,provider-worker}` and `packages/*`, managed by pnpm 10 (`packageManager` pinned) and orchestrated by Turborepo.
- Python services `apps/ai-service` and `apps/voice-agent` are **excluded** from the pnpm workspace and are independent uv projects (`pyproject.toml` + committed `uv.lock`). Root `package.json` scripts call `uv run --project …` for convenience only.
- Internal TS packages are **compiled** (`tsc` → `dist`, `exports` map) rather than consumed as raw source, so NestJS, Temporal's workflow bundler, Next.js and Metro all consume the same artefacts. Turbo's `^build` dependency builds them first.

## Consequences

- One command surface (`pnpm verify`, `pnpm verify:py`) while each runtime keeps its native tooling.
- Editing a package requires a rebuild (`turbo` handles it; `pnpm build:packages` manually).
