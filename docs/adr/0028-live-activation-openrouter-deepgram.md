# 0028 — Live activation of OpenRouter and Deepgram; hidden reasoning off on fast tiers

- Status: Accepted · Date: 2026-11-22
- Builds on: ADR-0025 (OpenRouter), ADR-0026 (routing, voice), ADR-0027 (Deepgram).

## Context

The owner asked for real models and working speech. The paid probes ran for the first time on
2026-11-22 (OpenRouter SP-1 ≈ $0.02, Deepgram speech probe ≈ $0.05 per run, two runs).

## Findings (verified live 2026-11-22)

1. **OpenRouter**: all 8 registry models passed complete + stream through `OpenRouterGatewayClient`
   with `data_collection=deny, zdr=true`; usage, `usage.cost` and `gen-` IDs are returned; invalid
   key → 401. An **unknown** model slug is rejected with 400 even when a valid fallback follows in
   `models` (fallback covers failures of valid models, not invalid IDs; KAREN only sends registry
   slugs, so routing is unaffected).
2. **Hidden reasoning ate the answer**: with no `reasoning` parameter, Haiku 5.5, GPT-6 Luna,
   DeepSeek V4.1 Flash and GPT-6.1 Terra reason by default; at 400 output tokens Haiku spent all
   400 on reasoning and returned an **empty** chat answer (`finish_reason=length`).
   `reasoning: {"enabled": false}` turned reasoning off on all four (answers returned);
   `effort: "low"` did not on Haiku. Mandatory-reasoning models (Sonnet 5.5) reject it with 400.
3. **Deepgram**: TTS works for all 20 catalog voices; Nova-3 batch STT round-trips English and
   Hindi (match 0.85 / 0.75–0.81, languages detected correctly); Flux Multilingual live STT works on
   streamed WebM/Ogg Opus (partials, `StartOfTurn`, `EndOfTurn`, en and hi). Flux **rejects MP3**
   and answers `CloseStream` on a stream that never received audio with
   `Error UNPARSABLE_CLIENT_MESSAGE`.
4. End to end through the public API (local stack): typed Hinglish chat → real answer; spoken
   reply (Flux TTS, Indian-English voice for Hinglish); push-to-talk transcription; live session
   with turn detection; usage recorded against per-user limits.

## Decision

1. `GatewayRequest.disable_reasoning`; the completion service sets it for ECONOMY, BALANCED and
   VISION (`REASONING_OFF_TIERS`), and the OpenRouter client sends `reasoning: {"enabled": false}`.
   REASONING keeps the model default. A test forbids a `reasoning=mandatory` model on those tiers.
2. `DeepgramLiveStream.finish()` closes the socket instead of sending `CloseStream` when no audio
   was sent, so a session closed before the user speaks ends without an error event.
3. The speech probe's live check streams a real Ogg/Opus clip (Aura TTS, `encoding=opus`) and
   requires transcript events, instead of opening and closing an empty stream.
4. Registry (`model-registry.live.json`) and Deepgram catalog entries carry `verified_at:
2026-11-22`. Voices were marked after the owner confirmed the listening check.

## Consequences / still NOT VERIFIED

- REASONING-tier models can still spend a small `max_output_tokens` on reasoning; the API's default
  `CHAT_MAX_OUTPUT_TOKENS=1000` was sufficient in testing but is not a guarantee.
- Hindi/Hinglish WER at scale, Flux turn detection on noisy real-world Indian speech, mobile audio
  capture (`expo-audio` pending), the India endpoint, and the LiveKit voice-agent path remain
  **NOT VERIFIED**. Upstream provider data terms still need the owner's review (architecture §9).
