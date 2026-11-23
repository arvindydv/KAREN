# Voice with Deepgram (STT + TTS)

Decision record: [ADR-0027](../adr/0027-deepgram-speech-provider.md) (builds on ADR-0026).
Status 2026-11-22: the paid probe passed (Nova-3, Flux Multilingual live, Flux TTS, Aura-2; 20 voices,
listening check confirmed by the owner) and voice works end to end locally (ADR-0028). Flux live
input must be WebM/Ogg Opus (MP3 is rejected).

## 1. Architecture

```
Browser (mic, MediaRecorder 250 ms Opus)            Mobile (settings only; capture needs expo-audio)
   │  POST /api/v1/voice/sessions/{id}/audio  (base64 chunk, seq)        ▲ SSE events
   ▼                                                                     │
Web BFF (same-origin, CSRF, cookie→bearer) ──────────────────────────────┘
   ▼
NestJS API  — auth, AI_PROCESSING consent, conversation ownership, 1 live session/user,
   │          per-user rate + spend limits (reserve → settle once), ai_invocations + ledger
   ▼  signed internal HTTP (HMAC)
ai-service  — SpeechService / LiveSessionService, voice catalog, budget, invocation records
   │          Redis Streams bus: chunks → the replica holding the provider stream
   ▼  Authorization: Token <DEEPGRAM_API_KEY> (never leaves ai-service)
Deepgram   — Nova-3 (batch STT) · Flux Multilingual (live STT + turn detection) · Flux TTS / Aura-2
```

Conversation flow: speech → live transcript (partials) → `end_of_turn` → the client sends the
text with `POST /v1/conversations/{id}/messages` and `Idempotency-Key: voice-<session>-<turn>` →
the **existing** task classifier and model router (OpenRouter) answer → when done, the client
requests `POST /v1/conversations/{id}/messages/{mid}/speech` → Deepgram TTS audio streams back
sentence by sentence. Typed messages are untouched; voice and text share history, auth, routing,
usage tracking, budgets, safety and persistence.

Barge-in: when Deepgram reports `StartOfTurn` (`speech_started`) while KAREN is speaking or
generating, the client stops playback (which aborts synthesis upstream, so nothing more is billed)
and cancels the running answer.

## 2. Models and voices (from Deepgram docs, read 2026-11-22)

| Use                    | Catalog ID                        | Why                                                                                                                                                                             | Price (PAYG)                                                 |
| ---------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Voice messages (batch) | `deepgram/nova-3`                 | Nova-3 `language=multi` code-switching (55 languages incl. `hi` per the models overview); monolingual `hi` model improved 2026-11-17; smart formatting included                 | $0.0052/min (multilingual pre-recorded; monolingual $0.0043) |
| Live conversation      | `deepgram/flux-general-multi`     | Conversational model with end-of-turn detection; languages en, es, fr, de, **hi**, ru, pt, ja, it, nl; mid-sentence switches; repeatable `language_hint`; accepts WebM/Ogg Opus | $0.0078/min                                                  |
| Spoken replies         | `deepgram/flux-tts` (`/v2/speak`) | Only family with **Indian English** (`flux-priya-en`, `flux-meena-en` F; `flux-naveen-en` M) and **Hindi** voices (14); GA 2026-08-12                                           | $0.045/1k chars                                              |
| Spoken replies (alt.)  | `deepgram/aura-2` (`/v1/speak`)   | American/British only; cheaper                                                                                                                                                  | $0.030/1k chars                                              |

Why not one model for everything: Flux is the live, turn-aware model (no batch endpoint
documented); Nova-3 is the documented batch model with multilingual code-switching and language
detection; Aura-2 has **no** Indian-English or Hindi voice, so Indian/Hindi replies need Flux TTS.

Voices in the catalog (gender as documented by Deepgram): Indian English Priya, Meena (F),
Naveen (M); Hindi Anjali, Divya, Shreya (F), Arjun, Vikram, Rahul (M); American Hannah, Alexis (F),
Cliff, Miles (M); British Gemma (F), Kit, Colin (M); Aura-2 Thalia/Apollo (US), Pandora/Draco (GB).

Selection (`karen_ai/speech/voices.py`): preferred voice (if it speaks the reply's language) →
Hindi always a Hindi voice → Hinglish an Indian-English voice → English in the saved accent →
fallbacks any gender → any accent → Indian English → any voice. A bad combination never fails the
reply. Speed: Deepgram documents speed for English voices only (Flux 0.5–1.5, Aura-2 0.7–1.5);
KAREN offers 70–150 % and speaks Hindi voices at normal speed.

Sources: developers.deepgram.com — `/docs/models-languages-overview`, `/docs/flux/quickstart`,
`/reference/speech-to-text/listen-flux`, `/docs/multilingual-code-switching`,
`/docs/language-detection`, `/reference/speech-to-text/listen-pre-recorded`,
`/docs/flux-tts/voices`, `/reference/speak/v-2/audio/generate`, `/docs/tts-models`,
`/docs/tts-voice-controls`, `/reference/regional-endpoints`, `/reference/auth/tokens/grant`,
`/docs/errors`; pricing: deepgram.com/pricing (read 2026-11-22; STT marked "promo", no end date).

### Verified vs. not verified

Verified (documentation + KAREN tests with fakes): request shapes, parameters, response parsing,
retry/no-replay rules, usage capture, cost arithmetic, ownership and limits.

**NOT VERIFIED** (needs the paid probe and listening checks): live Deepgram responses; Hindi and
Hinglish accuracy (WER) for Nova-3 multi vs. monolingual `hi`; whether Hinglish transcripts come
back in Latin or Devanagari script; Flux turn detection on Indian speech and noisy audio; voice
quality, Hindi pronunciation and Hinglish reading by Indian-English voices; `dg-char-count` on
`/v2/speak`; the India endpoint (`api.in.deepgram.com`) end to end; whether `mip_opt_out` changes
price; WebSocket close codes.

## 3. Language handling

- Detection (`karen_ai/core/language.py`): Devanagari ≥ 50 % of letters or ≥ ⅓ of words → `hi`;
  Hinglish markers → `hi-Latn`; else `en`. Provider "hi" on Latin text → Hinglish.
- `reply_language` preference: `auto` (default; reply in the language of the latest message) or a
  fixed `en` / `hi` / `hi-Latn`, applied to typed and spoken messages (prompt `chat.v2`) and used as
  the STT language hint. Proper nouns, technical terms, API names and code are never translated.
- The browser language is never used to decide the spoken language.

## 4. API and events

Public (`@karen/api-contracts`, OpenAPI regenerated):

| Route                                               | Notes                                                                                                                                                       |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/voice/options`                             | voices (from the verified catalog), speed range, `live_available`, `is_mock`                                                                                |
| `POST /v1/voice/sessions`                           | `{conversation_id?, audio_format: webm                                                                                                                      | ogg, language?}`→`{session_id, max_seconds, idle_seconds, is_mock}`; consent; 1 active per user; reserves `VOICE_LIVE_RESERVE_USD` |
| `POST /v1/voice/sessions/{id}/audio`                | `{seq, audio_base64}` ≤ 32 KiB; duplicates by `seq` dropped; rate-limited                                                                                   |
| `POST /v1/voice/sessions/{id}/close`                | ends the session and settles usage                                                                                                                          |
| `GET /v1/voice/sessions/{id}/events`                | SSE: `ready`, `speech_started`, `partial`, `end_of_turn {text, language}`, `error`, `closed {reason, audio_seconds}`; resume with `Last-Event-ID`/`?after=` |
| `POST /v1/voice/transcriptions`                     | push-to-talk (Nova-3) — unchanged contract                                                                                                                  |
| `POST /v1/conversations/{id}/messages/{mid}/speech` | spoken reply in the saved voice — unchanged contract                                                                                                        |

Internal (`@karen/ai-model-contracts` v3, signed): `GET /internal/v1/audio/voices`,
`POST /internal/v1/audio/live-sessions`, `.../{id}/audio`, `.../{id}/close`, `GET .../{id}/events`.

Sessions end by themselves after `KAREN_VOICE_LIVE_MAX_SECONDS` of audio or
`KAREN_VOICE_LIVE_IDLE_SECONDS` without audio. Another user's session returns 404.

## 5. Security and privacy

- `DEEPGRAM_API_KEY` exists only in ai-service (`SecretStr`, never logged or returned). No
  Deepgram token is ever minted for clients; clients reach only KAREN's own origin.
- Every voice route is authenticated; audio/transcription routes require ACTIVE `AI_PROCESSING`
  consent; conversation and session ownership are checked server-side (API and ai-service).
- Limits: per-user request and chunk rates, 32 KiB chunks, 700 kB clips, one live session per
  user, per-user daily/monthly spend (reserve → settle once), service-wide daily budget.
- Data minimisation: audio is never stored or logged (Redis holds live chunks for seconds, with
  TTLs); transcripts are not logged and appear only in the owner's event stream; the conversation
  stores only the text the user sends. `mip_opt_out=true` by default. Account deletion and
  retention apply to messages as before; there is no separate voice store.
- Provider errors are mapped to typed codes; upstream text (which may contain speech) is never
  echoed. Retries only before any audio was delivered; never after.

## 6. Usage and cost tracking

Per call the ai-service records (metadata only): provider, model/voice, Deepgram request ID, audio
seconds or characters, latency, status, estimated cost. The API writes `ai_invocations`
(`route_tier=AUDIO`) and the usage ledger. Prices are edited in the catalog (`price.usd`,
`observed_at`, `source`) — never in code. Estimates are not invoices.

## 7. Local setup

1. Mock mode (default, free): `KAREN_FEATURE_VOICE_ENABLED=true` and
   `KAREN_FEATURE_VOICE_LIVE_ENABLED=true` in `apps/ai-service/.env`. Mock chunks `MOCK:<text>`
   produce a full turn; mock audio is labelled silence.
2. Deepgram (paid, owner approval required):
   ```bash
   cd apps/ai-service
   # .env (gitignored): DEEPGRAM_API_KEY=<key>   (optionally DEEPGRAM_REGION=in)
   uv run karen-ai-speech-probe                                   # plan + worst-case cost, no calls
   uv run karen-ai-speech-probe --confirm-paid-calls --samples-dir /tmp/karen-voices
   # listen to /tmp/karen-voices/*.mp3 (language, accent, gender, Hindi/Hinglish pronunciation), then:
   uv run karen-ai-speech-probe --confirm-paid-calls --mark-verified --voices-listened
   ```
   Then set `KAREN_VOICE_STT_PROVIDER=deepgram`, `KAREN_VOICE_TTS_PROVIDER=deepgram`,
   `KAREN_VOICE_CATALOG_PATH=config/voice-catalog.deepgram.json`, `KAREN_FEATURE_VOICE_ENABLED=true`,
   `KAREN_FEATURE_VOICE_LIVE_ENABLED=true`, and restart `uv run karen-ai-dev`.
   `KAREN_AI_MAX_REQUEST_COST_USD` must cover the largest single reservation (live session ≈ $0.039).

## 8. Testing

- ai-service: `tests/test_deepgram_speech.py` (fake HTTP/WebSocket), `tests/test_live_sessions.py`,
  `tests/test_voice_providers.py`, contract fixtures in `packages/ai-model-contracts/fixtures`.
- API: unit (`ai-service.client.test.ts`, `voice.service.test.ts`, `voice-live.service.test.ts`) and
  integration (`test/voice-live.int.test.ts`, contract-validating AI stub).
- Web: `live-voice.test.ts`, `voice-events-proxy.test.ts`, `voice-settings.test.tsx`; mobile
  `voice-settings.test.ts`. No test makes a network call; `tests/conftest.py` blocks DNS.

## 9. Known limitations

- Nothing live is verified (see §2). Prices are list prices from one reading of the pricing page.
- Spoken replies start after the answer is complete (no token-streamed TTS yet); voice turns are
  answered in a short spoken style (`input_mode: voice` → `reply_style: spoken`, ADR-0029).
- Mobile (ADR-0030): tap-to-talk and on-device "Hey KAREN" with turn-based recording (expo-audio
  records files, no live streaming); NOT VERIFIED on physical devices.
- A spoken reply is charged at its pre-computed estimate when interrupted after audio started
  (the API cannot see the exact characters streamed); the service budget settles exactly.
- If the ai-service replica holding a live session dies, the session just ends; its reservation
  is released by TTL. The LiveKit voice-agent path is separate and NOT VERIFIED.
- Echo: browser echo cancellation plus a client turn guard (ADR-0029) that ignores transcripts made
  of KAREN's own recent words and interrupts only on real words; thresholds are not yet tuned on
  real devices.
