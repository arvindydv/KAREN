# 0035 — Phase 02 scope correction: voice removed, back to the trusted core

- Status: Accepted · Date: 2026-11-23
- Supersedes: ADR-0027, ADR-0029, ADR-0030, ADR-0031, ADR-0032, ADR-0033, ADR-0034 (entirely);
  the voice parts of ADR-0026 and ADR-0028.
- Keeps in force: ADR-0021–0025; ADR-0026 task routing and image input; ADR-0028 OpenRouter
  activation and the "hidden reasoning off on fast tiers" rule; the `reply_language` preference
  and `user_name` prompt hint (now plain chat features).
- Archive: branch `archive/phase-02-voice` (commit `04ef63b`) holds the complete voice work.

## Context

Phase 02 was approved as "real AI conversations and premium chat". During implementation it grew
a full voice stack: Deepgram/OpenRouter STT and TTS, live duplex sessions, speech segments,
wake words on web and mobile, an echo gate, a voice-mode UI and a companion persona for spoken
turns (~17k lines, ADRs 0026–0034).

KAREN's product promise (`karen.md`, `docs/product/instinct-reference-blueprint.md` §15–16,
`karen_phases.md` dependency spine) is **responsibility with proof**: memory, goals, the
Responsibility Engine, approvals, reminders and verified outcomes. Voice is Phase 06 / Stage 4 —
after durable tasks and approvals. Building it first made KAREN another chatbot with a voice,
added paid-provider surface, a new data category (audio) and a large maintenance burden before
any of the core exists.

## Decision

1. Remove all voice code from `apps/api`, `apps/ai-service`, `apps/web`, `apps/mobile`,
   `packages/*` and the Phase 02 additions to `apps/voice-agent` (which returns to its Phase 00
   skeleton, kept as the planned Phase 06 deployable).
2. The three unmerged voice migrations are deleted and replaced by one migration that adds only
   `identity.user_preferences.reply_language`. They were never applied outside local machines.
3. Internal AI contract bumps to `2026-11-23.v4`: speech, transcription, voice catalog and live
   session schemas, `reply_style` and the `NOT_FOUND` error code are removed.
4. Text chat (ADR-0021/0022/0023) is the only conversational surface until Phase 06.
5. Next work follows the MVP order in the blueprint §16: explicit memory, goals,
   Responsibility Engine with durable tasks, approvals bound to exact parameters, reminders, audit.

## Consequences

- Smaller attack surface: no microphone permission, no audio data, no Deepgram key or region.
- Local developer databases that applied the old voice migrations keep the extra columns;
  reset the local DB (`pnpm db:reset`) or drop them using the rollback SQL in the archived
  migrations. Nothing in production is affected.
- Re-introducing voice in Phase 06 starts from the archive branch, re-reviewed against the
  Responsibility Engine (voice must create the same permissioned tasks, read back critical values
  and never treat speech as approval).
