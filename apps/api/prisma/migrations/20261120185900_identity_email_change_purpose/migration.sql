-- Phase 01 / M4 — challenge purpose for e-mail change. Own migration: the value is used by a
-- CHECK constraint in the next migration, and PostgreSQL forbids using a new enum value in the
-- transaction that adds it. Expand-only.
-- Atomic: Prisma does not wrap migrations in a transaction (scripts/check-migrations.mjs).
BEGIN;

ALTER TYPE "identity"."ChallengePurpose" ADD VALUE IF NOT EXISTS 'EMAIL_CHANGE';

COMMIT;
