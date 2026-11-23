# apps/voice-agent — rules for agents

LiveKit worker foundation for KAREN voice (architecture §2.8, §6). LiveKit is the realtime
transport; it does not replace the Vercel AI Gateway.

## NOT VERIFIED (do not claim otherwise)
- Realtime speech end to end: no STT/TTS/realtime provider is wired; only mocks exist.
- Vercel AI Gateway audio/realtime/transcription paths and their compatibility with this worker.
- Device testing (low-end Android, 3G/4G, noisy audio, echo, barge-in) and Hindi/Hinglish accuracy.
- Connection to a real LiveKit server (only verified: the CLI starts the worker, serves health on
  `VOICE_AGENT_HEALTH_PORT` and retries an unreachable URL).

## Hard rules
- `AudioCapabilityGate` must stay closed unless `KAREN_FEATURE_AUDIO_ENABLED=true` AND `KAREN_MODEL_AUDIO`
  is in the registry with the `AUDIO` tier AND `verified_at` is set. Never bypass it.
- The worker never mints client LiveKit tokens; the API (NestJS) mints short-lived user tokens.
- Never hardcode model IDs. Never log transcripts or audio. OTel uses `allow_pii=False`.
- Do not gate a payment on an ambiguous spoken amount: `parse_amount_inr` returns `None` on ambiguity
  and is an evaluation tool, not production NLU.
- Session lifecycle changes go through `VoiceSession`; invalid transitions must raise.
- Requests to the AI service are signed exactly like `apps/ai-service` (shared test vectors).

## Commands (run from apps/voice-agent)
```
uv sync
uv run karen-voice dev        # needs LIVEKIT_URL/API_KEY/API_SECRET; refuses otherwise
uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run pytest
docker build -t karen/voice-agent:dev .
```
`karen-voice` wraps `livekit.agents.cli.run_app`, which livekit-agents 1.8.x marks deprecated in
favour of the LiveKit CLI (`lk agent dev`). Revisit when upgrading livekit-agents.
