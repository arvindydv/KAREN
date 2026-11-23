# 0032 — Voice mode UI, a fast voice model, India speech region and tighter turn-taking

- Status: **Superseded by ADR-0035** (voice removed 2026-11-23; code on `archive/phase-02-voice`) · was Accepted · Date: 2026-11-22
- Builds on: ADR-0029/0030/0031.

## Context

The owner asked for KAREN to answer ~1.5 s after they stop talking, for "Hey KAREN" to work, and
for talking to keep an immersive orb screen with no transcript. Measured (live, local stack) after
ADR-0031: end of turn ≈0.9 s; model first token 1.5–2.5 s; Deepgram TTS first audio ≈1.2 s (US
endpoint); send → first audio ≈2.9–3.3 s.

## Decision

1. **Voice model**: spoken turns (`reply_style=spoken`) are pinned via `KAREN_MODEL_VOICE` to
   `meta-llama/llama-4-maverick` (verified by the SP-1 probe; ZDR endpoint). Measured over 12 warm
   calls with the real spoken prompt: time to first word median 1.07 s / max 1.57 s, vs Claude Haiku
   1.56 / 2.30 and Gemini 3.1 Flash-Lite 1.60 / 6.24 (bad tail). GPT-OSS-120B was fastest (first
   sentence ≈1.0 s) but switched scripts mid-answer and replied to Hinglish in Devanagari — rejected
   on quality. Typed chat keeps the BALANCED selection (Haiku); the registry entry has no catalog
   quality score, so automatic routing never picks it.
2. **Speech region**: `DEEPGRAM_REGION=in` recommended (and set locally): TTS first audio median
   0.81 s vs 1.23 s on the global endpoint; live end-of-turn unchanged (≈0.7 s); audio processed in
   India.
3. **Turn-taking**: Flux `eot_threshold 0.5`, `eot_timeout_ms 1000` (code defaults): turn ends
   ≈0.63–0.74 s after speech.
4. **Voice mode** (web + phone): whenever a voice conversation runs, an immersive full-screen orb
   replaces the chat — greeting, one-line status, suggestion cards (asked out loud), no transcript.
   The orb animates by state (breathing = listening, swirling = thinking, pulsing = speaking);
   tapping it talks / interrupts / ends the turn; ✕ leaves voice mode (hands-free keeps listening
   for the wake word). The conversation is still saved to the chat history.

## Verified (live, local stack, 2026-11-22)

- API path, send → first audio byte: typically 1.3–1.75 s (8 turns; one at 3.3 s). Adding end of
  turn ≈0.7 s → KAREN starts speaking ≈2.0–2.4 s after the user stops.
- Web (real Chromium, fake microphone): "Hello KAREN" and "Hey KAREN" both wake the on-device
  listener ("hey" is heard as "hi"); voice mode opens by itself; KAREN speaks ≈2.1 s after the turn
  is sent (through the web BFF).

## Not achieved / NOT VERIFIED

- The 1.5 s target is not met: the remaining time is the model's first token (≈0.7–1.9 s through
  OpenRouter from India) and TTS first audio (≈0.5–0.8 s). Further options, not built: speculative
  generation on Flux `EagerEndOfTurn` (≈0.3 s; needs cancel-safe message handling), a short instant
  acknowledgement sound at end of turn (perceived latency), or a model hosted closer to India.
- Phone: "Hey KAREN" needs the KAREN development build with the voice modules plus an on-device
  recogniser and English offline speech pack; it cannot work in Expo Go. Voice mode on the phone is
  covered by unit/screen tests only.
