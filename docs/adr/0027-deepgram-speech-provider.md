# 0027 — Deepgram as the speech provider; live voice conversations through the backend

- Status: Accepted · Date: 2026-11-22
- Builds on: ADR-0026 (provider-independent speech, voice preferences), ADR-0023 (usage limits),
  ADR-0024 (content policy), ADR-0022 (SSE streaming), ADR-0013 (fail-closed coordination).
- Details, verified facts and setup: `docs/voice/deepgram.md`.

## Context

ADR-0026 put speech behind `SpeechToTextProvider` / `TextToSpeechProvider` with OpenRouter and mock
adapters, push-to-talk only. KAREN needs natural English / Hindi / Hinglish voice conversations:
live transcripts, turn detection, interruption, and Indian-English and Hindi voices. OpenRouter
documents no streaming speech-to-text, and its catalog voices have no listening-verified Hindi.

## Decision

1. **Deepgram is a third speech provider**, implemented once (`karen_ai/speech/deepgram.py`) behind
   the existing protocols plus a new `LiveTranscriber` protocol. **STT and TTS providers are chosen
   independently** (`KAREN_VOICE_STT_PROVIDER`, `KAREN_VOICE_TTS_PROVIDER`: `mock | openrouter |
deepgram`), so either can be replaced without touching KAREN's core. Mock stays the default.
2. **Model choice per task, from the catalog** (`config/voice-catalog.deepgram.json`; never in code):
   - batch voice messages → **Nova-3** (`language=multi` with en+hi hints for Hinglish/unknown;
     monolingual `hi` / `en` when the language is known);
   - live conversations → **Flux Multilingual** (`flux-general-multi`, built-in end-of-turn
     detection, en+hi language hints, accepts browser WebM/Opus directly);
   - spoken replies → **Flux TTS** (the only Deepgram family with Indian-English and Hindi voices)
     with **Aura-2** American/British voices as a cheaper alternative.
     Catalog entries carry the provider, mode (`batch`/`live`), documented gender and a list price.
3. **Live voice is proxied, not direct.** Deepgram's temporary tokens cannot be restricted to a
   model or capped, and the browser cannot reach the provider under KAREN's CSP. So: browser →
   BFF → API → ai-service → Deepgram. The client streams ~250 ms audio chunks as small signed
   HTTP requests and reads transcript events over SSE. Across replicas, a per-session bus (Redis
   Streams; in-process locally) carries chunks to the one ai-service replica that holds the
   Deepgram stream. No WebSocket infrastructure or new client dependency was added.
4. **Voice reuses the conversation pipeline.** A final turn is sent by the client through the normal
   `POST /v1/conversations/:id/messages` with `Idempotency-Key: voice-<session>-<turn>` (duplicate
   submissions are no-ops). Task classification, model routing (OpenRouter), consent, limits,
   persistence and safety are unchanged; Deepgram never sees or produces the answer.
5. **Language**: a saved `reply_language` (`auto | en | hi | hi-Latn`) is sent to the router as
   `reply_language` (prompt `chat.v2`: "always reply in …"; `auto` = mirror the latest message) and
   narrows STT language hints. The prompt now forbids translating names, technical terms and code.
   Mixed-script Hindi (Devanagari with Latin technical terms) is detected as Hindi.
6. **Cost**: list prices live in the catalog (USD/minute STT, USD/1,000 characters TTS, date and
   source). Pre-call reservations are the worst case for the request (60 s clip, the reply's
   characters, `max_seconds` of live audio) and settle to measured usage (provider audio duration,
   `dg-char-count`, streamed seconds). Invocation records carry the Deepgram request ID, audio
   seconds and characters. Per-user limits are enforced by the API exactly as for chat.
7. **Verification gate**: live mode refuses catalog entries without `verified_at`; only the manual
   `karen-ai-speech-probe --confirm-paid-calls` (worst case ≈ $0.05) can justify setting it, and
   voices additionally need a listening check (`--voices-listened`).
8. **Wire contract v3** (`2026-11-22.v3`): `reply_language`, `voice.voice_id`, speed 0.7–1.5,
   `NOT_FOUND` error code, voice catalog and live-session schemas (TS owns, Python mirrors, shared
   fixtures). Public API: `GET /v1/voice/options`, `POST /v1/voice/sessions`,
   `POST /v1/voice/sessions/:id/{audio,close}`, `GET /v1/voice/sessions/:id/events` (SSE).
   Preferences gain `voice_enabled`, `voice_replies`, `reply_language`, `voice_id` (expand-only
   migration `20261122090000_identity_voice_settings`).

## Consequences

- One provider key more (`DEEPGRAM_API_KEY`, ai-service only, `SecretStr`, never logged).
- Live sessions add Redis stream traffic (~4 small entries/s per active session, short TTL).
  Audio sits in Redis only transiently (seconds) and is never persisted or logged.
- If the replica holding a session dies, the session ends without a `closed` event; the per-user
  reservation is then released by its TTL (over-counts, never under-counts).
- The LiveKit voice-agent path (ADR-0026 §12) is unchanged and remains **NOT VERIFIED**; it bypasses
  the API conversation store and must not be used for user conversations until it is reworked.
- **NOT VERIFIED** (no paid call has been made): live Deepgram behaviour, Hindi/Hinglish accuracy
  (WER), Flux turn-detection quality on Indian speech, voice quality and Hinglish pronunciation, the
  India endpoint, and prices beyond the public pricing page read on 2026-11-22.
