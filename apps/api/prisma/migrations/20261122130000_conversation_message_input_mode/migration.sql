-- Voice turns answered for the ear (ADR-0029): remember whether a user message was typed or spoken,
-- so its answer (and any regeneration of it) is written to be read aloud.
-- Expand-only: one column with a default that keeps today's behaviour ('text').
-- RLS and erasure already cover this table (owner policy; messages are deleted with the user).
-- Reviewed SQL; never auto-applied to production.
-- Rollback (pre-production only):
--   ALTER TABLE "conversation"."messages" DROP CONSTRAINT "messages_input_mode",
--     DROP COLUMN "input_mode";
-- Atomic: Prisma does not wrap migrations in a transaction (scripts/check-migrations.mjs).
BEGIN;
ALTER TABLE "conversation"."messages"
  ADD COLUMN "input_mode" VARCHAR(8) NOT NULL DEFAULT 'text';

ALTER TABLE "conversation"."messages"
  ADD CONSTRAINT "messages_input_mode" CHECK ("input_mode" IN ('text', 'voice'));
COMMIT;
