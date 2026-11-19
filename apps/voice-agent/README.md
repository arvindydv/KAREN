# KAREN voice agent (`apps/voice-agent`)

Python 3.12 LiveKit worker foundation (`livekit-agents` 1.8.10, `AgentServer` API).

What exists and is tested:
- `VoiceSettings` (credentials optional to import; `karen-voice dev|start` refuses without them).
- `VoiceSession` lifecycle state machine: CONNECTING → ACTIVE ⇄ RECONNECTING → ENDED / FAILED,
  bound to LiveKit room `reconnecting`/`reconnected`/`disconnected` events.
- `AudioCapabilityGate` — closed and `NOT VERIFIED` by default.
- Speech pipeline protocols (`SpeechToText`, `TextToSpeech`, `TurnDetector`, `ConversationBridge`)
  with deterministic mocks, and `AiServiceConversationBridge` (signed call to the AI service text path).
- Hindi/Hinglish amount slot scorer (`pandrah sau` = ₹1,500 vs `pandrah hazaar` = ₹15,000) with the
  synthetic dataset in `evals/datasets/voice/`.

What is **NOT VERIFIED**: realtime speech, gateway audio, any STT/TTS provider, a real LiveKit
server connection, device/network testing. With the gate open, a job still ends because no verified
speech pipeline is wired.

Token boundary: the worker never mints client tokens; the NestJS API will mint short-lived LiveKit
access tokens for users.

Run: `cp .env.example .env`, fill the three `LIVEKIT_*` values, `uv run karen-voice dev`.
Health: `GET http://localhost:8200/` (LiveKit worker HTTP server; 503 until registered).
