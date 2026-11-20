-- Audit event semantics (roadmap F00-03): actor, action, target, outcome, POLICY DECISION,
-- trace link, timestamp, REASON. Additive and nullable (expand-only; no backfill needed).
-- Atomic: Prisma does not wrap migrations in a transaction (scripts/check-migrations.mjs).
BEGIN;

ALTER TABLE "audit"."audit_events" ADD COLUMN "policy_decision" VARCHAR(128),
ADD COLUMN "reason_code" VARCHAR(64);

COMMIT;
