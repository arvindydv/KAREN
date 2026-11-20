-- Phase 01 / M5 — onboarding progress (records progress only). Expand-only.
-- Rollback: DROP TABLE identity.onboarding_progress;
-- Atomic: Prisma does not wrap migrations in a transaction (scripts/check-migrations.mjs).
BEGIN;

-- CreateTable
CREATE TABLE "identity"."onboarding_progress" (
    "user_id" UUID NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'in_progress',
    "completed_steps" VARCHAR(32)[] DEFAULT ARRAY[]::VARCHAR(32)[],
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "skipped_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "onboarding_progress_pkey" PRIMARY KEY ("user_id")
);

-- AddForeignKey
ALTER TABLE "identity"."onboarding_progress" ADD CONSTRAINT "onboarding_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "identity"."onboarding_progress"
  ADD CONSTRAINT "onboarding_progress_status" CHECK ("status" IN ('in_progress', 'skipped', 'completed')),
  ADD CONSTRAINT "onboarding_progress_steps" CHECK ("completed_steps" <@ ARRAY[
    'welcome', 'language', 'about_you', 'preferences', 'accessibility', 'notifications',
    'assist_vs_act', 'memory_and_proactivity', 'privacy']::varchar(32)[]),
  ADD CONSTRAINT "onboarding_progress_timestamps" CHECK (
    ("status" = 'completed') = ("completed_at" IS NOT NULL)
    AND ("status" = 'skipped') = ("skipped_at" IS NOT NULL));

ALTER TABLE "identity"."onboarding_progress" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "identity"."onboarding_progress" FORCE ROW LEVEL SECURITY;
CREATE POLICY "onboarding_progress_owner" ON "identity"."onboarding_progress"
  USING ("user_id" = "identity"."current_user_id"())
  WITH CHECK ("user_id" = "identity"."current_user_id"());

COMMIT;
