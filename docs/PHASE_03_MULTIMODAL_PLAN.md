# Multimodal assistant — architecture and implementation plan

- **Date:** 2026-11-21. **Status:** in implementation (owner instruction 2026-11-21). Decision record: ADR-0026.
- **Builds on:** Phase 02 chat (ADR-0021/0022/0023), OpenRouter gateway (ADR-0025), content policy (ADR-0024).
- **Hard constraints kept:** mock mode is the default and the only mode tests use; no paid call without the
  owner's explicit approval; the OpenRouter key stays in ai-service; no model, voice or price is
  invented: every ID and price comes from the live catalog (`GET /models`, free) and stays
  `verified_at: null` until a paid probe passes; no audio is stored (AUDIO_RETENTION is not yet available).

## 1. What exists (inspected before planning)

| Area                      | State before this work                                                                                                                                                                                                                                                                                               |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Routing                   | `task_kind` → tier → env-pinned model; task routes for CODING/DOCUMENT_ANALYSIS; per-tier fallbacks; registry has capabilities + flat prices only                                                                                                                                                                    |
| Voice                     | `apps/voice-agent`: LiveKit shell, closed audio gate, `SpeechToText`/`TextToSpeech`/`TurnDetector` Protocols with **mocks only**, non-streaming text bridge; no orchestrator, no barge-in                                                                                                                            |
| API / clients             | No voice endpoints, no audio packages, web blocks the mic (`Permissions-Policy: microphone=()`), BFF proxy caps bodies at 64 KiB                                                                                                                                                                                     |
| Preferences               | `identity.user_preferences.language` (`en/hi/hinglish`) + `script`; no voice/accent/speed; the language preference is never sent to the AI                                                                                                                                                                           |
| Live catalog (2026-11-21) | Text models with Artificial Analysis indices on many entries; per-endpoint TTFT/throughput (`/models/{id}/endpoints`, free with key); **30 transcription models** (`/api/v1/audio/transcriptions`) and **42 speech models** (`/api/v1/audio/speech`), incl. voices tagged `en-IN-*`, `hi-IN-*`, `en-US-*`, `en-GB-*` |

## 2. Target architecture

```
            text ─────────────────────────────┐
client ─┤                                       ▼
            voice ─► API /v1/voice/transcriptions ─► ai-service STT ─► transcript (+ language)
                         (consent, limits, no storage)                      │
                                                                            ▼
                               same POST /v1/conversations/:id/messages (identical router path)
                                                                            │
   ai-service ModelRouter: task profile → candidates (capability, quality floor, context,
   budget) → cheapest qualified → fallbacks (next cheapest, equivalent) → OpenRouter
                                                                            │
                               SSE token stream to client (unchanged, ADR-0022)
                                                                            ▼
   API /v1/conversations/:id/messages/:mid/speech ─► ai-service TTS: language detection →
   voice selection (language × accent × gender, with fallbacks) → sentence-chunked synthesis,
   streamed audio; client abort = interruption (synthesis stops, nothing further billed)
```

Realtime full-duplex voice (LiveKit, barge-in mid-utterance) reuses the same STT/TTS adapters,
router and voice selection through the `voice-agent` orchestrator (phase 5).

### 2.1 Routing (ai-service)

- **Task profiles** (code, versioned): each `task_kind` declares its tier (budget class and
  reporting), required capabilities, a minimum quality index and a latency preference. New task
  kinds: `RESEARCH`, `DECISION_SUPPORT`, `IMAGE_UNDERSTANDING` (additive, unreleased contract v2).
- **Registry metadata** (optional fields): `quality_index` (catalog Artificial Analysis
  intelligence index), `latency_p50_ms` / `throughput_p50_tps` (best ZDR endpoint, last 30 min),
  `metadata_observed_at`. Generated by `karen-ai-probe`; never hand-typed.
- **Selection**: a pinned `KAREN_MODEL_*` wins (operator override). Otherwise: candidates = models
  listing the tier, meeting capabilities, quality floor, context, and (live) verified; ranked by
  worst-case cost for _this_ request, then latency, then quality; primary = cheapest; fallbacks =
  next two equivalent candidates. **Budget-aware**: candidates whose worst case exceeds the
  request/service cap are dropped before ranking; if none remains → `BUDGET_EXCEEDED` (no call).
- **Images**: `ChatMessage.images` (https or `data:image/*` URLs, size/count capped) for
  `IMAGE_UNDERSTANDING`; requires `supports_vision`; sent as OpenAI-style content parts.

### 2.2 Speech (ai-service, provider-independent)

- `SpeechToTextProvider` / `TextToSpeechProvider` protocols; adapters: `OpenRouterSpeechToText`
  (`POST /audio/transcriptions`, JSON + base64, `verbose_json` for detected language),
  `OpenRouterTextToSpeech` (`POST /audio/speech`, mp3), and mocks (default).
- Same data policy as text (`provider.zdr`, `data_collection: deny`), same retry rules, same
  key handling, metadata-only invocation records (never audio or transcript text).
- **Voice catalog** (`config/voice-catalog.json`, generated from the catalog's `supported_voices`):
  entries `{voice_id, model_id, language, accent, gender}`. **Voice selection** is a pure function:
  `(response language, saved accent, gender, speed) → voice`, fallback order exact → any gender →
  any accent of the language → default Indian English → mock.
- **Language detection** (runtime, deterministic): Devanagari share → `hi`; Hinglish markers →
  `hi-Latn`; else `en`; STT's detected language is preferred for transcripts. Hindi always uses
  `hi-IN` voices; Hinglish uses the configured code-switching voice (default: Indian English
  voice for Latin script) — quality **NOT VERIFIED** until listened to.
- **Cost**: STT/TTS billing units are not documented by OpenRouter. Pre-call worst case uses
  operator-set rates (`KAREN_VOICE_*_MAX_COST_*`) with hard duration/character caps; settlement
  uses the provider-reported `usage.cost` when present, else the worst case.

### 2.3 API, data and clients

- **Preferences** (`identity.user_preferences`, expand-only migration): `voice_accent`
  (`indian|american|british`, default `indian`), `voice_gender` (`female|male|any`),
  `voice_speed_pct` (80–125, default 100), `voice_autoplay` (default false). Exposed through the
  existing `GET/PATCH /v1/me/preferences` (If-Match), zod → OpenAPI → generated client.
- **Endpoints** (consent `AI_PROCESSING`, per-user reserve/settle limits, rate limits):
  `POST /v1/voice/transcriptions` (base64 audio, ≤ 60 s / 1.5 MB, never stored) and
  `POST /v1/conversations/:id/messages/:mid/speech` (server reads the persisted assistant text it
  owns — clients cannot make KAREN speak arbitrary text; streams audio).
- **Web**: mic button (MediaRecorder, opus/webm), listen button and optional autoplay, stop on
  interruption; `Permissions-Policy: microphone=(self)`; dedicated BFF routes for audio.
  **Mobile**: same with `expo-audio` (new dependency, pinned, release-age checked).

## 3. Phases

| Phase | Scope                                                                                                                                                      | Exit check                                                   |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 1     | Routing engine: task profiles, new task kinds, registry metadata, cost/quality/latency selection, budget-aware candidates, image content parts             | ai-service + contract tests, golden routing evals            |
| 2     | Speech core in ai-service: STT/TTS protocols, OpenRouter + mock adapters, voice catalog + selection, language detection, internal endpoints, probe support | unit tests, fake-transport tests, voice-selection evals      |
| 3     | API: preference columns + migration, voice endpoints, limits/consent, ai-service client, contracts/OpenAPI                                                 | API unit + integration tests                                 |
| 4     | Web + mobile: settings, mic input, listen/autoplay, interruption                                                                                           | web unit + e2e (mock), mobile jest                           |
| 5     | Realtime: voice-agent orchestrator (VAD turn-taking, barge-in, streaming bridge with cancellation) on the same adapters                                    | orchestrator tests with fakes; real LiveKit **NOT VERIFIED** |

## 4. Owner decisions and approvals needed

1. Paid probe for text, STT and TTS candidates (spend cap) — nothing live is enabled before it.
2. Listen-test Hindi and Hinglish voices before enabling TTS for users.
3. Approve `expo-audio` (mobile) and the web `Permissions-Policy` change.
4. Legal review: voice processing copy under `AI_PROCESSING`; audio is transcribed and discarded.
