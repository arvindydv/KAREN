-- Phase 02 — reply-language preference on identity.user_preferences.
-- Expand-only: one new column with a default that keeps today's behaviour (reply language detected
-- automatically); existing rows get the default. RLS and erasure already cover this table (owner
-- policy; identity.erase_user deletes the row).
-- Reviewed SQL; never auto-applied to production.
-- Rollback (pre-production only):
--   ALTER TABLE "identity"."user_preferences" DROP CONSTRAINT "user_preferences_reply_language",
--     DROP COLUMN "reply_language";
-- Atomic: Prisma does not wrap migrations in a transaction (scripts/check-migrations.mjs).
BEGIN;
ALTER TABLE "identity"."user_preferences"
  ADD COLUMN "reply_language" VARCHAR(8) NOT NULL DEFAULT 'auto';

ALTER TABLE "identity"."user_preferences"
  ADD CONSTRAINT "user_preferences_reply_language" CHECK (
    "reply_language" IN ('auto', 'en', 'hi', 'hi-Latn'));
COMMIT;
