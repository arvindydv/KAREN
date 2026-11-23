# 0026 — Cost-aware task routing, image input and voice (STT/TTS) with language & accent preferences

- Status: Accepted; **voice parts superseded by ADR-0035** (2026-11-23) · Date: 2026-11-21
- Builds on: ADR-0025 (OpenRouter), ADR-0023 (usage limits), ADR-0024 (content policy), ADR-0022.
- Plan: `docs/plans/MULTIMODAL_ROUTING_PLAN.md` (erratum 2026-11-23: renamed from
  `docs/PHASE_03_MULTIMODAL_PLAN.md` under owner decision D2; link only, no decision changed).

## Decision

### Routing

1. **Task profiles** (`apps/ai-service/src/karen_ai/model_router/profiles.py`): every `task_kind`
   declares its tier, required capabilities (JSON schema, vision), a quality floor and a latency
   ceiling. New task kinds (additive, unreleased contract v2): `RESEARCH`, `DECISION_SUPPORT`,
   `IMAGE_UNDERSTANDING`. VISION becomes a (feature-flagged) text-generation tier.
2. **Least-cost qualified selection**: candidates are registry models listing the tier, meeting the
   profile, fitting the context window and — in live mode — verified; those whose worst-case cost
   for _this_ request exceeds the request/service cap are dropped before ranking (budget-aware).
   Rank: worst-case cost, then latency, then quality. Primary = cheapest; the next two
   capability-equivalent candidates are gateway fallbacks. No qualified model within budget →
   `BUDGET_EXCEEDED` before any call. `KAREN_MODEL_*` pins remain operator overrides.
3. **Registry metadata** (optional contract fields): `quality_index` (catalog Artificial Analysis
   intelligence index), `latency_p50_ms` / `throughput_p50_tps` (slowest healthy endpoint, free
   endpoints metadata), `metadata_observed_at`. Unknown quality never satisfies a floor.
4. **Images**: `ChatMessage.images` (https or base64 `data:image/*`, ≤ 4, user messages only),
   sent as OpenAI-style content parts; routing requires `supports_vision`.

### Voice

5. **Provider-independent speech** in ai-service (`karen_ai/speech/`): `SpeechToTextProvider` /
   `TextToSpeechProvider` protocols, OpenRouter adapters (`/audio/transcriptions`,
   `/audio/speech`) and mocks (default). Same key, data policy (ZDR, no data collection), retries
   and no-replay rules as text. Internal endpoints `/internal/v1/audio/{transcriptions,speech}`.
6. **Voice commands go through the same router**: the API returns the transcript for review and
   the client sends it as a normal message (`POST /v1/conversations/:id/messages`). The
   voice-agent bridge sends transcripts as CHAT with a locale hint.
7. **Spoken replies** only for assistant answers the user owns (KAREN never speaks arbitrary
   client text), synthesised sentence by sentence and streamed; aborting playback aborts the
   upstream request (interruption stops synthesis and billing).
8. **Voice catalog** (`config/voice-catalog.*.json`, generated from the live catalog's
   `supported_voices`): accent from the voice ID's locale tag (`en-IN`, `en-US`, `en-GB`,
   `hi-IN`), gender left unset until verified by listening. **Selection**: Hindi → Indian Hindi
   voice; Hinglish → Indian voice of `hinglish_voice_language`; English → saved accent; fallback
   exact → any gender → any accent → Indian English → any voice.
9. **Language detection** (`karen_ai/core/language.py`): Devanagari share → `hi`; ≥ 2 Hinglish
   markers and ≥ 12 % → `hi-Latn`; else `en`. STT's provider language refines it.
10. **Preferences**: `identity.user_preferences.voice_accent|voice_gender|voice_speed_pct|
voice_autoplay` (expand-only migration with CHECK), exposed via `/v1/me/preferences`.
11. **Cost & consent**: voice needs `AI_PROCESSING` consent; reservations (`VOICE_*_RESERVE_USD`)
    count against the same per-user daily/monthly limits; mock costs nothing; ledger +
    `ai_invocations` rows (route tier `AUDIO`, metadata only). Audio is never stored.
12. **Real-time voice** (voice-agent): `VoiceOrchestrator` streams the reply through the SSE
    bridge, speaks sentence by sentence, and on barge-in stops playback and closes the stream.

## Consequences

- Speech billing units are not documented by OpenRouter: reservations are operator-set and
  conservative; transcriptions settle to provider-reported `usage.cost`, speech to the reservation.
- **NOT VERIFIED**: live STT/TTS behaviour, Hindi/Hinglish transcription accuracy (WER), voice
  quality and Hinglish pronunciation, voice genders, real-time latency, LiveKit audio path, mobile
  audio (needs the `expo-audio` dependency, pending approval). All speech entries stay
  `verified_at: null` until a paid probe and a listening check pass.
- Quality floors and latency ceilings are engineering defaults to be calibrated with live evals.
