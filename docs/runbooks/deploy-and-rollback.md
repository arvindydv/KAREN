# Runbook: deploy and roll back a service (ECS/Fargate)

Status: **written against the code and Terraform; NOT yet rehearsed** — no AWS environment
exists (Phase 00 task F00-02 #17). Rehearse in `dev`, then `staging`, before any production use.

## Principles

- Images are immutable and tagged with the **git SHA**; `latest` is rejected by Terraform
  validation (`image_tags`). Rolling back = deploying the previous SHA, never rebuilding.
- ECS services use `deployment_circuit_breaker { rollback = true }` with
  `minimum_healthy_percent = 100` / `maximum_percent = 200`
  (`infra/terraform/modules/ecs-service/main.tf`): a deployment whose tasks fail health
  checks is rolled back by ECS automatically. That covers _crashing_ releases only — a release
  that is healthy but wrong needs the manual rollback below.
- Database migrations are **never** coupled to a service deploy (see `database-migrations.md`).
  Every release must work with both the previous and the next schema (expand → contract).
- Workflow code changes follow `temporal-workflow-versioning.md` (`patched()`); rolling back a
  temporal-worker with a non-patched workflow change can break running workflows.

## Pre-deploy checklist

1. The commit is on `main`, CI is green (all required checks).
2. `git log <deployed-sha>..<new-sha>` reviewed; note any migration or workflow change.
3. Migrations for this release (if any) were applied **before** the deploy and are
   backwards-compatible with the currently running version.
4. Record the currently deployed tag per service (`terraform output` / ECS console) — this is the
   rollback target.
5. On-call engineer present; dashboards open (5xx rate, p95/p99 `http.server.request.duration`,
   `db.client.connection.pending_requests`, ECS task health).

## Deploy

1. Build and push: GitHub Actions → **Deploy (manual, gated)** → environment + service.
   Requires repo variable `DEPLOYMENTS_ENABLED=true` and, for `production`, environment
   reviewers. Image tag = commit SHA.
2. Roll out: set `image_tags.<service> = "<sha>"` in the environment's tfvars →
   `terraform plan` → review that ONLY the task definition/service changes → `terraform apply`.
3. Watch the ECS deployment until `COMPLETED` (circuit breaker may roll back automatically).
4. Smoke checks (each must pass within 10 min):
   - `GET /health/ready` → 200 on every service behind the ALB.
   - API: authenticated `GET /v1/me` with a synthetic staging account → 200.
   - Error rate and p99 latency not worse than the pre-deploy baseline.

## Roll back (healthy-but-wrong release)

Trigger: elevated 5xx, latency regression, wrong behaviour, or security concern.

1. **Contain first if actions are involved:** set `KAREN_EXECUTION_PAUSED=true` on api AND
   provider-worker (`incident-kill-switches.md`). Status reconciliation keeps running.
2. Set `image_tags.<service>` back to the recorded previous SHA → `terraform plan` → `apply`.
   (Emergency only: ECS console "Update service" to the previous task-definition revision, then
   immediately reconcile Terraform so state does not drift.)
3. Verify the smoke checks above against the old version.
4. If the bad release ran a migration: do **not** roll the schema back; ship a forward fix
   (the previous version must still be compatible — that is why migrations are expand-only).
5. If a temporal-worker release changed workflow code without `patched()`: keep the old
   worker version until all affected workflows finished; check Temporal UI for
   non-determinism errors.
6. Un-pause execution only after reconciliation of any `ESCALATED` tasks.
7. Write an incident note: timeline, SHAs, impact, audit `request_id`s.

## Failed deployment (circuit breaker)

1. ECS event log shows the rollback; confirm the old task definition is serving.
2. Read the stopped task's reason (`aws ecs describe-tasks ... stoppedReason`) and container
   logs. Common causes and the fail-closed guard that produced them:
   - missing `APP_ENV` / required secret → config refuses to start (ADR-0013);
   - `AUTH_MODE=local-dev` outside local/test → refused;
   - Redis/DB unreachable → readiness 503 (task never becomes healthy).
3. Fix forward; never bypass a refusal by loosening validation.
