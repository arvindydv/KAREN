-- Phase 03 / voice — spoken-voice preferences on identity.user_preferences (ADR-0026).
-- Expand-only: four new columns with defaults; existing rows get the defaults. RLS and erasure
-- already cover this table (owner policy; identity.erase_user deletes the row).
-- Reviewed SQL; never auto-applied to production.
-- Rollback (pre-production only):
--   ALTER TABLE "identity"."user_preferences" DROP CONSTRAINT "user_preferences_voice",
--     DROP COLUMN "voice_accent", DROP COLUMN "voice_gender", DROP COLUMN "voice_speed_pct",
--     DROP COLUMN "voice_autoplay";
-- Atomic: Prisma does not wrap migrations in a transaction (scripts/check-migrations.mjs).
BEGIN;
ALTER TABLE "identity"."user_preferences"
  ADD COLUMN "voice_accent" VARCHAR(16) NOT NULL DEFAULT 'indian',
  ADD COLUMN "voice_gender" VARCHAR(8) NOT NULL DEFAULT 'any',
  ADD COLUMN "voice_speed_pct" SMALLINT NOT NULL DEFAULT 100,
  ADD COLUMN "voice_autoplay" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "identity"."user_preferences"
  ADD CONSTRAINT "user_preferences_voice" CHECK (
    "voice_accent" IN ('indian', 'american', 'british')
    AND "voice_gender" IN ('female', 'male', 'any')
    AND "voice_speed_pct" BETWEEN 80 AND 125);
COMMIT;
