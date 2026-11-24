-- Phase 03 / M5a (arch §12.3, L-10): ledger request kind. Memory extraction calls are counted in
-- their own column so `requests` keeps meaning "chat generations"; their cost still goes into
-- cost_micro_usd and counts against the same daily/monthly limits (D10). Expand-only: existing
-- rows get 0; no reader changes meaning. Reviewed SQL; never auto-applied to production.
--
-- Rollback (pre-production): ALTER TABLE platform.usage_ledger DROP COLUMN memory_extraction_requests;
-- Atomic: Prisma does not wrap migrations in a transaction (scripts/check-migrations.mjs).
BEGIN;

ALTER TABLE "platform"."usage_ledger"
  ADD COLUMN "memory_extraction_requests" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "usage_ledger_memory_extraction_requests_nonneg" CHECK ("memory_extraction_requests" >= 0);

COMMIT;
