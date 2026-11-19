# 0005 — Prisma 7, Postgres schemas per owning module, pgvector via SQL

- Status: Accepted · Date: 2026-11-19

## Decision

- Prisma 7.10 with the new `prisma-client` generator (ESM, `.js` import extensions) and the `@prisma/adapter-pg` driver adapter (node-postgres pool, statement timeout 15 s). `prisma.config.ts` holds datasource/migrations config.
- Ownership is expressed with **PostgreSQL schemas**: `identity`, `consent`, `audit`, `platform`. New domains add their own schema; cross-schema writes go through the owning module's service.
- pgvector 0.8.7 (PostgreSQL 17) is enabled in the first migration. Prisma has no vector type, so vector columns are `Unsupported("vector(N)")` created by SQL migrations and queried only via `infrastructure/database/vector.ts` (typed raw SQL). An integration test proves the extension and distance operator work.
- `audit.audit_events` is append-only, enforced by triggers rejecting UPDATE, DELETE and TRUNCATE (tested).
- The `postgresqlExtensions` preview feature is **not** used (extensions are SQL-managed).

## Consequences

Integration-test and drift checks need a shadow database (`SHADOW_DATABASE_URL`). Production migrations are applied by an explicit, reviewed step — never automatically (runbook).
