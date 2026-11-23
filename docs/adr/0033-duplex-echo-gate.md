# 0033 — Duplex echo gate: KAREN must never answer her own voice

- Status: **Superseded by ADR-0035** (voice removed 2026-11-23; code on `archive/phase-02-voice`) · was Accepted · Date: 2026-11-22
- Builds on: ADR-0029 (transcript echo guard), ADR-0031 (live phone listening), ADR-0032.

## Context

In live voice conversations KAREN was "talking to herself": the microphone stays open while she
speaks (so the user can interrupt), her voice leaks from the speaker into the microphone, Deepgram
Flux transcribes it, and the echo comes back as a user turn that she then answers — a loop.

The ADR-0029 guard compares transcripts with the answer's text. That cannot be the main defence:

- the phone's expo-audio PCM stream has **no echo cancellation**, so the full-volume echo is heard;
- the recogniser's transcript of her voice often does not match her text (Hinglish written in Latin
  script can come back in Devanagari; misheard words drop overlap below the 70 % rule);
- on the phone the guard only applied while speaking/thinking, but Flux reports `EndOfTurn` ~0.7–1 s
  after the audio — i.e. the echoed last sentence usually arrived _after_ playback ended and was sent;
- on the web, "speaking" started when the speech response headers arrived, not when audio played.

## Decision

1. **`DuplexGate`** (`@karen/domain`, pure, shared): while KAREN speaks, and for a 600 ms tail,
   microphone audio is **not forwarded** to recognition — silence is sent instead, so the stream stays
   continuous. The local microphone level is still measured. Voice barge-in is allowed **only while
   her echo stays quiet** (peak < 0.025 RMS: headphones or working echo cancellation): then a voice
   ≥ 4× her loudest echo (and ≥ 0.06 RMS), unbroken for 450 ms, opens the gate and reports a
   **barge-in**. A loud stretch that does not last (a loud syllable, knock, cough) raises the echo
   peak instead. With loud echo (speakerphone, laptop speakers without cancellation) only a tap
   interrupts her. (First version used an adaptive average that ignored loud frames; her own louder
   syllables then counted as the user and cut her off mid-sentence — fixed.)
2. **Web**: mic → Web Audio (analyser for level, gain → `MediaStreamDestination` for recording).
   The gain is ramped to 0/1 by the gate every 40 ms. If the `AudioContext` cannot run, the raw
   microphone is recorded (never a deaf KAREN) and only the transcript guard applies. The live phase
   becomes `speaking` on the audio element's first `playing` event; stopping playback always
   returns the phase to `listening` (the gate can never stay closed).
3. **Phone**: each PCM buffer's level goes through the gate; gated buffers are replaced by zeros.
   The assistant's phase drives the gate; `VoiceAssistant.bargeIn()` stops speaking and listens.
4. A level barge-in only **stops playback**; the answer being written is cancelled only when the
   user's words arrive as a turn (a false barge-in never loses an answer).
5. The transcript echo guard stays as a second line of defence, now with a shared
   `ECHO_TAIL_MS = 3000` after playback ends on both platforms.

6. **Phone playback = sentence clips only** (`POST …/speech?segment=N`, next one prefetched). The
   progressive `GET …/speech` stream is no longer used by the app: native players re-request URLs
   (AVPlayer's `Range: bytes=0-1` probe, ExoPlayer retries after a stall) and each request restarted
   synthesis from the first sentence, so KAREN repeated herself. A clip that fails to play ends
   instead of hanging the conversation.
7. **Turn-taking**: `DEEPGRAM_EOT_THRESHOLD 0.6`, `DEEPGRAM_EOT_TIMEOUT_MS 1500`. 0.5/1000
   (ADR-0032) cut sentences at thinking pauses into two turns (KAREN started, was cancelled, started
   again); 0.7/2000 was then too slow after short phrases. 0.6/1500 is the middle — NOT measured.
8. **Fast start** (web + phone): the microphone records from the moment a conversation starts,
   while the live session (API → ai-service → Deepgram) is still connecting; that audio is queued
   and sent first, in order. "Hey KAREN, <question>" in one breath is no longer lost and nobody
   waits for "connecting". `stop()` during connect closes the new session. Leading wake words in a
   turn ("KAREN, …", or only "KAREN") are stripped (`stripLeadingWakeWords`).
9. **Instant feedback**: a soft two-note chime (Web Audio, no file) the moment the web wake word
   is heard; the phone already vibrates.
10. **Web gate fallback**: if Web Audio cannot run (no user gesture yet when the wake word starts
    the conversation), the gate mutes the microphone track instead (records silence while KAREN
    speaks; tap to interrupt) — never the raw microphone. Audio-context wait cut to 250 ms.
11. **First speech segment** may end at a comma after 24 characters (was 40): phones play whole
    sentence clips synthesised at about real time, so a shorter first clip means earlier speech.

## Consequences

- KAREN cannot hear herself through the recogniser while she speaks, on any device, regardless of
  echo-cancellation quality.
- The first ~450 ms of a user interrupting her is not transcribed (it is what triggers the barge-in).
- On loud speakers without echo cancellation, talking over her does not interrupt; tapping the orb
  always does. A false interruption is worse than none.
- Phone: a short pause between sentence clips (new player per clip).

## NOT VERIFIED

Thresholds are engineering defaults covered by unit tests with synthetic levels; they need tuning on
real devices (laptop speakers, phone speakerphone, earphones, noisy rooms). Safari's
`MediaRecorder` on a `MediaStreamDestination` and the phone build are not device-tested.
