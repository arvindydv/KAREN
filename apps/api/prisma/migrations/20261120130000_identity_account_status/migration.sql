-- Phase 01 / M1 — account lifecycle statuses (ADR-0015, @karen/domain ACCOUNT_STATUSES).
-- Expand-only: new enum values; existing rows and code paths are unaffected. New values cannot
-- be USED in the transaction that adds them, so the default/trigger change is the next migration.
-- Atomic: Prisma does not wrap migrations in a transaction (scripts/check-migrations.mjs).
BEGIN;

ALTER TYPE "identity"."UserStatus" ADD VALUE IF NOT EXISTS 'PENDING_VERIFICATION' BEFORE 'ACTIVE';
ALTER TYPE "identity"."UserStatus" ADD VALUE IF NOT EXISTS 'LOCKED' AFTER 'ACTIVE';
ALTER TYPE "identity"."UserStatus" ADD VALUE IF NOT EXISTS 'DELETED' AFTER 'DELETION_REQUESTED';

COMMIT;
