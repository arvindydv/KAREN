-- Phase 01 / M4 — profile fields, preferences, saved places, e-mail change challenges.
-- Expand-only (new nullable columns, new tables). The EMAIL_CHANGE enum value is added by the
-- previous migration (a new enum value cannot be used in the transaction that adds it).
-- Rollback: DROP TABLE identity.saved_places, identity.user_preferences;
--   ALTER TABLE identity.users DROP COLUMN preferred_name, DROP COLUMN country, DROP COLUMN currency;
--   ALTER TABLE identity.verification_challenges DROP COLUMN target_email, DROP COLUMN target_email_canonical;
--   (the EMAIL_CHANGE enum value cannot be dropped; it is harmless unused.)
-- Atomic: Prisma does not wrap migrations in a transaction (scripts/check-migrations.mjs).
BEGIN;


-- AlterTable
ALTER TABLE "identity"."users" ADD COLUMN     "country" CHAR(2),
ADD COLUMN     "currency" CHAR(3),
ADD COLUMN     "preferred_name" VARCHAR(60);

-- AlterTable
ALTER TABLE "identity"."verification_challenges" ADD COLUMN     "target_email" VARCHAR(254),
ADD COLUMN     "target_email_canonical" VARCHAR(254);

-- CreateTable
CREATE TABLE "identity"."user_preferences" (
    "user_id" UUID NOT NULL,
    "language" VARCHAR(16) NOT NULL DEFAULT 'en',
    "script" VARCHAR(16) NOT NULL DEFAULT 'latin',
    "date_format" VARCHAR(8) NOT NULL DEFAULT 'dmy',
    "time_format" VARCHAR(8) NOT NULL DEFAULT '12h',
    "theme" VARCHAR(16) NOT NULL DEFAULT 'system',
    "text_size" VARCHAR(16) NOT NULL DEFAULT 'default',
    "reduced_motion" BOOLEAN NOT NULL DEFAULT false,
    "high_contrast" BOOLEAN NOT NULL DEFAULT false,
    "notify_product_email" BOOLEAN NOT NULL DEFAULT false,
    "notify_push" BOOLEAN NOT NULL DEFAULT false,
    "quiet_hours_start" VARCHAR(5),
    "quiet_hours_end" VARCHAR(5),
    "version" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "identity"."saved_places" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "kind" VARCHAR(8) NOT NULL,
    "label" VARCHAR(40) NOT NULL,
    "line1" VARCHAR(200) NOT NULL,
    "line2" VARCHAR(200),
    "city" VARCHAR(100) NOT NULL,
    "region" VARCHAR(100),
    "postal_code" VARCHAR(12),
    "country" CHAR(2) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "saved_places_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "saved_places_user_id_idx" ON "identity"."saved_places"("user_id");

-- AddForeignKey
ALTER TABLE "identity"."user_preferences" ADD CONSTRAINT "user_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."saved_places" ADD CONSTRAINT "saved_places_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "identity"."users"
  ADD CONSTRAINT "users_country_iso" CHECK ("country" IS NULL OR "country" ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT "users_currency_iso" CHECK ("currency" IS NULL OR "currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "users_names_plain" CHECK (
    ("display_name" IS NULL OR "display_name" !~ '[[:cntrl:]]') AND
    ("preferred_name" IS NULL OR "preferred_name" !~ '[[:cntrl:]]'));
ALTER TABLE "identity"."verification_challenges"
  ADD CONSTRAINT "verification_challenges_target" CHECK (
    ("purpose" = 'EMAIL_CHANGE') = ("target_email_canonical" IS NOT NULL)
    AND ("target_email" IS NULL) = ("target_email_canonical" IS NULL)
    AND ("target_email_canonical" IS NULL OR "target_email_canonical" = lower("target_email_canonical")));
ALTER TABLE "identity"."user_preferences"
  ADD CONSTRAINT "user_preferences_enums" CHECK (
    "language" IN ('en', 'hi', 'hinglish') AND "script" IN ('latin', 'devanagari')
    AND "date_format" IN ('dmy', 'mdy', 'ymd') AND "time_format" IN ('12h', '24h')
    AND "theme" IN ('system', 'light', 'dark') AND "text_size" IN ('default', 'large', 'larger')),
  ADD CONSTRAINT "user_preferences_quiet_hours" CHECK (
    ("quiet_hours_start" IS NULL) = ("quiet_hours_end" IS NULL)
    AND ("quiet_hours_start" IS NULL OR ("quiet_hours_start" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
         AND "quiet_hours_end" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')));
ALTER TABLE "identity"."saved_places"
  ADD CONSTRAINT "saved_places_kind" CHECK ("kind" IN ('home', 'work', 'other')),
  ADD CONSTRAINT "saved_places_country" CHECK ("country" ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT "saved_places_plain" CHECK (
    concat_ws(' ', "label", "line1", "line2", "city", "region", "postal_code") !~ '[[:cntrl:]]');

-- Owner-only RLS, FORCEd (no pre-authentication access path exists for these tables).
ALTER TABLE "identity"."user_preferences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "identity"."user_preferences" FORCE ROW LEVEL SECURITY;
CREATE POLICY "user_preferences_owner" ON "identity"."user_preferences"
  USING ("user_id" = "identity"."current_user_id"())
  WITH CHECK ("user_id" = "identity"."current_user_id"());
ALTER TABLE "identity"."saved_places" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "identity"."saved_places" FORCE ROW LEVEL SECURITY;
CREATE POLICY "saved_places_owner" ON "identity"."saved_places"
  USING ("user_id" = "identity"."current_user_id"())
  WITH CHECK ("user_id" = "identity"."current_user_id"());

COMMIT;
