# 0002 — All-ESM TypeScript runtime, NestJS 12 + Fastify, TypeScript 6.0

- Status: Accepted · Date: 2026-11-19

## Context

NestJS 12 (current major) ships as ESM only. TypeScript 7 (native compiler) is the npm `latest`, but `typescript-eslint` 8.72 supports `typescript <6.1`, and `openapi-typescript` declares `^5`. Node 24 is the active LTS line.

## Decision

- Every TS package and service is `"type": "module"` with `module/moduleResolution: nodenext`. Expo/React Native and Next.js use their bundler settings.
- NestJS 12 on the Fastify adapter. Tests use Vitest 4 (the Nest 12 ESM template's choice; Vite 8/oxc emits decorator metadata).
- **TypeScript is pinned to 6.0.3** across the repo. Upgrade to 7.x once typescript-eslint supports it.
- ESLint 10 flat config with typescript-eslint type-aware rules (ESLint 9 is deprecated upstream).

## Consequences

- `openapi-typescript` and some ESLint plugins in `eslint-config-next` show peer-range warnings (TS 6 / ESLint 10); they run correctly in this repo's checks. Re-evaluate on upgrades.
- `nestjs-zod` does not support Nest 12; we use a 40-line in-house `ZodValidationPipe` + `z.toJSONSchema` (ADR-0006).
