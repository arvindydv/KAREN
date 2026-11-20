# Runbook: database migrations

1. Author locally: edit `apps/api/prisma/schema.prisma` → `pnpm db:migrate` (name it) → review the generated SQL; hand-edit for extensions, triggers, indexes.
   - **Wrap every migration in `BEGIN;` … `COMMIT;`.** Prisma does not add a transaction: a failing statement otherwise leaves the earlier ones applied (reproduced in the Phase 00 drill). `pnpm check:migrations` (in `pnpm verify` and CI) enforces it. `CREATE INDEX CONCURRENTLY` cannot run in a transaction: put it alone in its own migration with `-- karen:no-transaction <reason>`.
   - Every new user-owned table ships, in the same migration, with RLS (`ENABLE` + policy on `identity.current_user_id()`), and gets explicit grants added to `infra/database/roles.sql` plus an RLS negative test.
2. Breaking changes use **expand → migrate data → contract** across releases. Never drop/rename a column read by the currently deployed version.
3. CI applies all migrations to an empty database and checks drift (`db:migrate:diff`).
4. Deploy: a human runs migrations against the target **after** reviewing `migrate status`, from a one-off ECS task using the **migration image** (the runtime image has no Prisma CLI):
   `docker build -f infra/docker/node-service.Dockerfile --build-arg APP=api --target migrate -t karen/api-migrate:<sha> .`
   — run it with `MIGRATION_DATABASE_URL` (owner/migration role, never the runtime role): `migrate status`, then the default `migrate deploy`. Then, as the same role: `psql -v ON_ERROR_STOP=1 -f infra/database/roles.sql`. Never automatic for production; never `migrate reset`/`db push` outside local.
5. Before production: confirm a fresh RDS snapshot/PITR window; for long-running migrations, check lock impact on a staging copy.
6. Rollback = forward fix (new migration). Destructive steps require an ADR or explicit approval in the PR.
7. A failed migration (`P3018`): because migrations are transactional, nothing of it was applied. Confirm with `\d` / `to_regclass` that no partial objects exist, fix the SQL in a **new** migration name if it was already shipped, and mark the failed one with `prisma migrate resolve --rolled-back <name>`. For a legacy non-transactional migration, manually revert its partial objects BEFORE `resolve`.
