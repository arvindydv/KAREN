-- Phase 01 / M6 — new consent purposes and the DENIED decision. Own migration: new enum values
-- cannot be used in the transaction that adds them. Expand-only.
-- Atomic: Prisma does not wrap migrations in a transaction (scripts/check-migrations.mjs).
BEGIN;

ALTER TYPE "consent"."ConsentPurpose" ADD VALUE IF NOT EXISTS 'PERSONALIZATION';
ALTER TYPE "consent"."ConsentPurpose" ADD VALUE IF NOT EXISTS 'PRECISE_LOCATION';
ALTER TYPE "consent"."ConsentPurpose" ADD VALUE IF NOT EXISTS 'AUDIO_RETENTION';
ALTER TYPE "consent"."ConsentPurpose" ADD VALUE IF NOT EXISTS 'FAMILY_SHARING';
ALTER TYPE "consent"."ConsentStatus" ADD VALUE IF NOT EXISTS 'DENIED';

COMMIT;
