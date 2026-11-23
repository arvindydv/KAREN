# 0029 — Talking to KAREN: spoken-style answers, echo-safe barge-in, uninterrupted sessions

- Status: **Superseded by ADR-0035** (voice removed 2026-11-23; code on `archive/phase-02-voice`) · was Accepted · Date: 2026-11-22
- Builds on: ADR-0027 (live voice), ADR-0028 (live activation).

## Context

The first real-browser end-to-end run of "Talk to KAREN" (Chromium with a fake microphone fed by
synthetic speech → web BFF → API → ai-service → Deepgram/OpenRouter, all live) found defects
that unit, contract and API-level tests could not:

1. **KAREN never spoke in the browser**: the page CSP had no `media-src`, so playback of the
   MediaSource/Blob object URL was refused (`default-src 'self'`) and the UI fell back to listening.
2. **Every conversation died after ~30 s**: audio chunks (~4/s) counted against the general per-IP
   limiter (120/min) and got 429.
3. **Answers were written for reading, not listening**: tables, lists, long text read aloud, and
   meta-remarks such as "Aap Hinglish mein likh rahe hain…".
4. **Self-interruption / echo loop risk**: barge-in fired on Deepgram's bare `StartOfTurn` (a cough,
   or KAREN's own voice leaking from speakers), and an echoed sentence could come back as a new
   user turn.
5. A live session hard-ends at `KAREN_VOICE_LIVE_MAX_SECONDS` (cost cap), ending the conversation.

## Decision

1. CSP adds `media-src 'self' blob:` (same-page object URLs only; nothing remote).
2. `POST /v1/voice/sessions/:id/audio` skips the general throttler (`@SkipThrottle({default:true})`);
   it keeps its own per-user `VOICE_LIVE_CHUNKS_PER_MINUTE` limit behind auth, `AI_PROCESSING`
   consent and session ownership. Integration test proves chunks beyond the general limit pass.
3. Spoken turns: public `SendMessageRequest.input_mode: text | voice` (optional, default text),
   stored on the user message (`conversation.messages.input_mode`, expand-only migration
   `20261122130000_conversation_message_input_mode`). The generation runner sends
   `reply_style: "spoken"` (internal contract v3, additive, unreleased) when the question was
   spoken; regenerations of that answer keep it. Prompt `chat.v3` then asks for a short, plain,
   speakable reply (no Markdown/tables/URLs). Live turns are always `voice`; a push-to-talk message
   is `voice` only when its answer will be auto-read. `chat.v3` also forbids commenting on the
   language in use. `speakable()` drops Markdown table rules.
4. Turn guard (`apps/web/src/lib/chat/turn-guard.ts`): interruption needs real words — two or more
   words not taken from what KAREN is saying, or a stop word (stop, wait, ruko, bas, रुको…);
   transcripts that are mostly KAREN's own recent words (while speaking and 2.5 s after) are
   treated as echo: not shown, not interrupting, not sent.
5. When a session ends with `max_duration` while the user is still in conversation mode, the client
   starts a new session transparently (each session stays individually cost-capped).

## Verified (live, local stack, 2026-11-22)

Browser E2E: natural Hinglish question → accurate transcript → spoken-style Hinglish answer →
played in a Hindi/Indian voice → interruption "रुको, एक और सवाल…" stopped playback mid-reply →
new answer spoken; 198 chunks over 60 s without a 429; closing a silent session ends cleanly.

## Still NOT VERIFIED

Real microphones and speakers (echo guard thresholds are engineering defaults), Safari/iOS
MediaRecorder formats, noisy rooms, long sessions across the `max_duration` rollover, and mobile
(capture still needs `expo-audio`, pending approval).
