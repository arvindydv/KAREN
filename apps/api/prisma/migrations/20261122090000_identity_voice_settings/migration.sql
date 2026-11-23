-- Voice settings v2 (ADR-0027): voice mode, spoken replies, reply language, preferred voice, and the
-- wider speaking-rate range Deepgram documents (0.7–1.5).
-- Expand-only: four new columns with defaults that keep today's behaviour (voice controls shown,
-- replies may be read aloud, reply language detected automatically, voice chosen automatically).
-- The speed CHECK is widened (80–125 -> 70–150); every existing value stays valid.
-- RLS and erasure already cover this table (owner policy; identity.erase_user deletes the row).
-- Reviewed SQL; never auto-applied to production.
-- Rollback (pre-production only; first clamp speeds back into 80–125):
--   ALTER TABLE "identity"."user_preferences" DROP CONSTRAINT "user_preferences_voice_v2",
--     DROP COLUMN "voice_enabled", DROP COLUMN "voice_replies", DROP COLUMN "reply_language",
--     DROP COLUMN "voice_id";
--   (then re-add CONSTRAINT "user_preferences_voice" from 20261121120000_identity_voice_preferences)
-- Atomic: Prisma does not wrap migrations in a transaction (scripts/check-migrations.mjs).
BEGIN;
ALTER TABLE "identity"."user_preferences"
  ADD COLUMN "voice_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "voice_replies" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "reply_language" VARCHAR(8) NOT NULL DEFAULT 'auto',
  ADD COLUMN "voice_id" VARCHAR(128);

ALTER TABLE "identity"."user_preferences" DROP CONSTRAINT "user_preferences_voice";

ALTER TABLE "identity"."user_preferences"
  ADD CONSTRAINT "user_preferences_voice_v2" CHECK (
    "voice_accent" IN ('indian', 'american', 'british')
    AND "voice_gender" IN ('female', 'male', 'any')
    AND "voice_speed_pct" BETWEEN 70 AND 150
    AND "reply_language" IN ('auto', 'en', 'hi', 'hi-Latn')
    AND ("voice_id" IS NULL OR "voice_id" ~ '^[A-Za-z0-9._:-]{1,128}$'));
COMMIT;
