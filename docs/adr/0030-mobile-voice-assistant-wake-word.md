# 0030 — Talking to KAREN on mobile: tap-to-talk, "Hey KAREN" on-device wake word, spoken answers

- Status: Accepted · Date: 2026-11-22
- Builds on: ADR-0027 (voice), ADR-0029 (spoken style, echo guard). Dependency policy: ADR-0010.

## Context

The owner wants the mobile app to work like an advanced assistant: talk to KAREN, hear her
answer, and start a conversation by saying "Hey KAREN" without touching the screen. The web live
mode streams audio continuously to the backend; doing that while idle (to catch a wake word)
would send ambient speech off the phone, cost money per minute and contradict KAREN's privacy
rules. expo-audio records to files only (no streaming chunks), so the web's live protocol cannot be
reused as is.

## Decision

1. **Dependencies (owner-approved 2026-11-22, pinned, ≥ 7 days old)**: `expo-audio@58.0.12`
   (official; record turns, play answers), `expo-speech-recognition@58.0.1` (MIT; the phone's speech
   recogniser for the wake word), `expo-file-system@58.0.13` / `expo-asset@58.0.21` (official;
   already in the tree via `expo`, now direct). A development build is required (no Expo Go).
2. **Wake word on the device only**: the phone's recogniser runs with
   `requiresOnDeviceRecognition: true`, biased towards "Hey KAREN", matched by
   `matchWakePhrase` (`@karen/domain`; greeting + name required, common misspellings accepted, so
   a sentence about "Karan" does not wake her). Phones without on-device recognition or an English
   offline language pack get tap-to-talk only, with an explanation. Picovoice Porcupine was
   considered (more accurate, less battery) and declined for now: it needs an account, a custom
   model and a commercial licence; the wake listener is an interface, so it can be swapped in.
3. **Foreground only, user-controlled**: a "Hey KAREN" switch (device setting, off by default)
   on the chat screens; listening runs only while the app is in the foreground, consent is
   granted, voice is enabled and offered. A status bar always shows when the microphone is in use.
   iOS does not allow third-party background wake words; Android background listening was not
   built.
4. **Conversation loop** (`apps/mobile/src/features/voice/assistant.ts`, unit-tested with fakes):
   wake → record the question (m4a, end of speech from the level meter, `endpointer.ts`) →
   backend transcription (`POST /v1/voice/transcriptions`, same consent/limits/model as web) →
   send with `input_mode: voice` → wait for the answer → play it
   (`POST …/messages/{id}/speech`, user's saved voice) → follow-up window without the wake word →
   back to wake. "Hey KAREN, <question>" in one breath skips the recording. While KAREN speaks,
   "Hey KAREN" or a stop word interrupts (echo-guarded; iOS voice processing on); a tap always does.
   The new-chat screen hands the conversation to the chat screen after the wake word (question kept
   in memory, never in the URL).
5. The echo/barge-in guard moved from the web app to `@karen/domain` (`voice-turn.ts`), shared by
   web and mobile.

## Consequences

- Recordings and reply audio are temporary files deleted right after use; nothing is stored.
- No API, contract or database change (uses ADR-0029's `input_mode`).
- **NOT VERIFIED** (no device or native toolchain was available): native builds, the on-device
  recogniser on real Android/iOS phones (availability, accuracy of "Hey KAREN", restart beeps on
  some Android recognisers, battery use), recording/playback audio routing, voice interruption
  while playing through the phone speaker, metering thresholds. Expo doctor reports patch
  versions held back by the release-age policy.
