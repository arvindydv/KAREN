# Phase 03 — AWS/RDS verification checklist (NOT EXECUTED)

- **Status (2026-11-24): NOT VERIFIED.** The AWS account reachable from the engineering session
  (`ap-south-1`) has **no RDS instance** (`DescribeDBInstances` → 0, read-only call). Creating one
  is infrastructure spend and deployment, which the Phase 03 execution instruction does not
  authorise. Every item below therefore stays **[NV]** until an operator runs it.
- **What is proven locally instead [V-local]:** the whole API integration suite runs against a
  database migrated by a `NOSUPERUSER NOBYPASSRLS` owner (`pnpm test:integration`, project
  `integration-nonsuper-owner`), and the probe script below passes against that database.
- Script: `infra/database/verify/rds-verification.sql` (read-only apart from two synthetic rows it
  creates, erases and removes; never creates extensions or roles).

## Preconditions (operator)

1. A **non-production** RDS PostgreSQL 17 instance created by `infra/terraform/modules/rds-postgres`.
2. `vector` created by the master user (`rds_superuser`). `pg_trgm` is **not** created (APP-3 open).
3. A dedicated migration role: `LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB`, owner of
   the database; **not** the master user and **not** a member of `rds_superuser`.
4. `prisma migrate deploy` run as that role; then `roles.sql` applied by the master user (it
   contains `CREATE/ALTER ROLE`); an API login `IN ROLE karen_api_runtime`.

## Run

```bash
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -v migration_url="$MIGRATION_DATABASE_URL" -v runtime_url="$RUNTIME_DATABASE_URL" \
  -f infra/database/verify/rds-verification.sql | tee rds-verification-$(date +%F).txt
```

## Checks and expected results

| Check     | Proves                                                                   | Expected       | Test-strategy id    | Local result (2026-11-24)                 |
| --------- | ------------------------------------------------------------------------ | -------------- | ------------------- | ----------------------------------------- |
| R-00…R-02 | Owner and runtime roles are not superuser / BYPASSRLS; one owner         | PASS           | T-AWS-01            | PASS                                      |
| R-10/R-11 | FORCE on all memory tables; only owner policies (+ M2b job lookup)       | PASS           | T-AWS-01, SR-RLS-05 | PASS                                      |
| R-20      | Database `LC_COLLATE` / `LC_CTYPE`                                       | record value   | Q2                  | `en_US.utf8` (local docker)               |
| R-21/R-22 | Devanagari words stay whole under the `simple` parser (F1 viability, Q2) | PASS / record  | Q2                  | PASS / `'खाना' 'हूँ'` (local only)          |
| R-23      | `pg_trgm` available (not installed)                                      | record version | Q3                  | 1.6 available, not installed (local only) |
| R-30…R-33 | NEW-1: unscoped lookup and erasure work for the runtime role; no leak    | PASS           | T-AWS-02, SR-EXP-04 | PASS                                      |
| R-40…R-42 | Memory maintenance functions callable; caller scope empty afterwards     | PASS           | T-AWS-03            | added with M2b                            |
| R-99      | Synthetic rows removed                                                   | PASS           | —                   | PASS                                      |

Not covered by the script (manual, release tasks): retrieval p95 on RDS (T-PERF-03), query plans
of the retrieval and maintenance statements under realistic volume (`EXPLAIN (ANALYZE, BUFFERS)`
of the statements listed in `docs/database/memory-maintenance.md`), backup/PITR restore drill and
deletion re-application (OD-13, T-AWS-06).

## Evidence to record

Date, instance id, engine version, the full script output, the migration-role `\du` line, and who
ran it. Store the output with the release record; then mark the rows above **[V-aws]**.
