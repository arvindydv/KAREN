# Runbook: database migrations

1. Author locally: edit `apps/api/prisma/schema.prisma` → `pnpm db:migrate` (name it) → review the generated SQL; hand-edit for extensions, triggers, indexes (`CONCURRENTLY` requires a separate migration without a transaction).
2. Breaking changes use **expand → migrate data → contract** across releases. Never drop/rename a column read by the currently deployed version.
3. CI applies all migrations to an empty database and checks drift (`db:migrate:diff`).
4. Deploy: a human runs `prisma migrate deploy` against the target (from a one-off ECS task using the api image's migration role) **after** reviewing `prisma migrate status`. Never automatic for production; never `migrate reset`/`db push` outside local.
5. Before production: confirm a fresh RDS snapshot/PITR window; for long-running migrations, check lock impact on a staging copy.
6. Rollback = forward fix (new migration). Destructive steps require an ADR or explicit approval in the PR.
