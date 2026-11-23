# 0031 — Human-speed voice conversations: speak while writing, live phone listening, "Hello KAREN" on the web

- Status: **Superseded by ADR-0035** (voice removed 2026-11-23; code on `archive/phase-02-voice`) · was Accepted · Date: 2026-11-22
- Builds on: ADR-0027 (live voice), ADR-0029 (spoken style), ADR-0030 (mobile voice).

## Context

The owner found talking to KAREN slow and unnatural and disliked the voice. Measured per stage
(live stack, 2026-11-22): batch STT 1.7–1.9 s; model first token 1.7–2.6 s; and **KAREN could not
speak until the whole answer was written**, after which the phone downloaded the entire reply
before playing — Deepgram Flux TTS streams at about real time (≈8 s of audio takes ≈8 s), so a
phone turn took ≈25 s; the web ≈6 s after the message was sent.

## Decision

1. **Speak while writing** (API): `speech()` accepts an answer that is still streaming. It splits
   the text into deterministic speech segments (`speech-segments.ts`: sentence ends incl. `: ;`
   and danda; the first segment may end at a comma after 40 chars) and synthesises each as soon
   as it exists. Web: one chained stream (next segment prefetched while the current plays; an
   empty segment is retried once, never after audio). Phone: one progressive `GET …/speech`
   stream (new bearer-only GET form for native players), falling back to `?segment=N` clips
   (204 = no more). Only the first segment of an answer counts against the voice rate limit.
   The response `close` event (not the request's) detects a listener hanging up.
2. **Live listening on the phone**: expo-audio's microphone stream (16 kHz PCM) feeds the existing
   live-session API (new live format `pcm16` → Deepgram `encoding=linear16&sample_rate=16000`),
   so Deepgram detects the end of each turn; the session stays open for the whole conversation
   (follow-ups and interruptions without reconnecting). Record → upload → batch STT is removed.
3. **Turn-taking**: Flux end-of-turn defaults `eot_threshold 0.55`, `eot_timeout_ms 1500`
   (measured: turn ends ≈0.9 s after speech instead of ≈1.0–1.05 s; 0.5/1200 gave 0.7 s but risks
   cutting off thinking pauses).
4. **Spoken style** (`chat.v3`): short first sentence, conversational tone, and an explicit rule to
   never narrate the reply ("I'll reply in English…" was observed live). Spoken turns ask
   OpenRouter for the fastest endpoint (`provider.sort=latency`, verified accepted). A `VOICE` task
   route (`KAREN_MODEL_VOICE`) allows pinning a low-latency model for spoken turns; **left unset**:
   Llama 4 Scout was faster in isolation (0.55 s first token) but with KAREN's prompt its advantage
   shrank and it ignored the spoken style (lists, long answers), so spoken turns stay on the
   BALANCED selection (Haiku).
5. **Voice choice**: `POST /v1/voice/preview {voice_id}` speaks a fixed server-owned sample line
   (no promised actions) so users can hear voices before choosing ("Play sample" on web and phone).
6. **"Hello KAREN" on the web, on-device**: `vosk-browser@0.0.8` (Apache-2.0) with the Vosk small
   Indian-English model (pinned SHA-256, fetched by `pnpm --filter @karen/web wake-model:fetch`,
   served from `/models/`, cached for a year, not committed) runs in a Web Worker with a two-phrase
   grammar ("hello karen", "hi karen" — "hey" is not in the model's vocabulary). Room audio never
   leaves the computer. CSP adds `'wasm-unsafe-eval'` and `worker-src 'self' blob:` (WebAssembly
   compilation only, no JS eval, no remote scripts). A turn that is only the wake phrase is ignored;
   "Hello KAREN, <question>" sends just the question (web and phone).

## Verified (live, local stack)

- Phone flow simulated over HTTP with real Deepgram/OpenRouter: end of speech → first audio byte
  ≈4.6 s (was ≈25 s); end of turn ≈0.9–1.0 s.
- Web (real Chromium, fake microphone): message sent → KAREN speaking ≈3.2–3.7 s (was 4.8–7.7 s);
  interruption still works; "Hello KAREN" starts a conversation with no clicks (model 37.6 MB,
  detected ≈0.8 s after the phrase).

## Consequences / NOT VERIFIED

- Phone native paths (expo-audio microphone stream, progressive GET playback, speaker echo while
  the mic stays open) need a development build on real devices; the segment fallback covers a
  player that cannot stream. iOS/Android echo cancellation of the PCM stream is unknown — the
  shared echo guard is the safety net.
- Remaining latency is mostly the model's first token (≈1.5–2.5 s) and Flux TTS first byte
  (≈1.2–1.4 s); the faster Aura-2 voices are American/British only.
- The browser wake model adds a one-time ≈38 MB download when the switch is first turned on; the
  deploy pipeline must run `wake-model:fetch` (or host the file) for production.
