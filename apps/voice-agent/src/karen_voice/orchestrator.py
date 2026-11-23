"""Turn-taking voice orchestrator: final transcript -> streamed reply -> sentence TTS, with barge-in.

Architecture §6 option B (STT -> text LLM -> TTS) on top of the provider-independent Protocols in
``pipeline.py``. Natural conversation rules (ADR-0026):

- **Streaming**: reply text is spoken sentence by sentence as it arrives, so the first audio
  plays before the full answer exists (target p50 ~1 s to first audio, NOT VERIFIED).
- **Barge-in**: when the user starts speaking while KAREN is talking, playback stops at once and
  the reply generation is cancelled (closing the bridge stream cancels it upstream), so nothing
  further is generated or billed. A new final transcript also interrupts the previous turn.
- **Same router as text**: the bridge sends the transcript as a CHAT request with the detected
  language as the locale hint.

Audio I/O, VAD and the real-time transport (LiveKit) are injected; real speech providers in the
LiveKit worker are NOT VERIFIED (see apps/voice-agent/CLAUDE.md).
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import re
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass, field
from typing import Final

from karen_voice.bridge import BridgeError
from karen_voice.pipeline import AudioFrame, ConversationBridge, TextToSpeech, Transcript, TurnDetector

_logger = logging.getLogger(__name__)

# Sentence end (Latin punctuation or Devanagari danda) followed by whitespace.
_SENTENCE_END: Final = re.compile(r"(?<=[.!?।॥])\s+")
# Speak a long run without punctuation once it is this long (keeps first audio early).
MAX_PENDING_CHARS: Final = 220

AudioSink = Callable[[AudioFrame], Awaitable[None]]
Clock = Callable[[], float]


class SentenceBuffer:
    """Accumulates streamed text and releases complete sentences."""

    def __init__(self) -> None:
        self._pending = ""

    def push(self, delta: str) -> list[str]:
        self._pending += delta
        parts = _SENTENCE_END.split(self._pending)
        self._pending = parts.pop()
        ready = [p.strip() for p in parts if p.strip()]
        if len(self._pending) >= MAX_PENDING_CHARS:
            cut = self._pending.rfind(" ", 0, MAX_PENDING_CHARS)
            cut = cut if cut > 0 else MAX_PENDING_CHARS
            ready.append(self._pending[:cut].strip())
            self._pending = self._pending[cut:]
        return ready

    def flush(self) -> list[str]:
        rest, self._pending = self._pending.strip(), ""
        return [rest] if rest else []


@dataclass
class TurnMetrics:
    """Per-turn latency (ms from the final transcript) for the per-stage metrics in F06-02."""

    first_text_ms: float | None = None
    first_audio_ms: float | None = None
    sentences: int = 0
    interrupted: bool = False
    error_code: str | None = None


@dataclass
class OrchestratorStats:
    turns: int = 0
    barge_ins: int = 0
    last_turn: TurnMetrics = field(default_factory=TurnMetrics)


class VoiceOrchestrator:
    def __init__(
        self,
        *,
        bridge: ConversationBridge,
        tts: TextToSpeech,
        turn_detector: TurnDetector,
        audio_sink: AudioSink,
        session_id: str,
        user_ref: str,
        clock: Clock = time.monotonic,
    ) -> None:
        self._bridge = bridge
        self._tts = tts
        self._turns = turn_detector
        self._sink = audio_sink
        self._session_id = session_id
        self._user_ref = user_ref
        self._clock = clock
        self._task: asyncio.Task[None] | None = None
        self.stats = OrchestratorStats()

    @property
    def speaking(self) -> bool:
        return self._task is not None and not self._task.done()

    async def on_user_audio(self, frame: AudioFrame) -> None:
        """Every incoming microphone frame: barge-in when the user talks over KAREN."""
        if self.speaking and self._turns.user_started_speaking(frame):
            self.stats.barge_ins += 1
            await self.interrupt()

    async def on_final_transcript(self, transcript: Transcript) -> None:
        """A finished user turn starts a reply (interrupting any reply still playing)."""
        if not transcript.is_final or not transcript.text.strip():
            return
        await self.interrupt()
        self.stats.turns += 1
        self.stats.last_turn = TurnMetrics()
        self._task = asyncio.create_task(self._respond(transcript, self.stats.last_turn))

    async def interrupt(self) -> None:
        task, self._task = self._task, None
        if task is not None and not task.done():
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

    async def wait_idle(self) -> None:
        if self._task is not None:
            with contextlib.suppress(asyncio.CancelledError):
                await self._task

    async def _speak(self, sentence: str, language: str | None, metrics: TurnMetrics, started: float) -> None:
        metrics.sentences += 1
        async for frame in self._tts.synthesize(sentence, language=language):
            if metrics.first_audio_ms is None:
                metrics.first_audio_ms = (self._clock() - started) * 1000
            await self._sink(frame)

    async def _respond(self, transcript: Transcript, metrics: TurnMetrics) -> None:
        started = self._clock()
        buffer = SentenceBuffer()
        stream: AsyncIterator[str] = self._bridge.reply_stream(
            transcript, session_id=self._session_id, user_ref=self._user_ref
        )
        try:
            async for delta in stream:
                if metrics.first_text_ms is None:
                    metrics.first_text_ms = (self._clock() - started) * 1000
                for sentence in buffer.push(delta):
                    await self._speak(sentence, transcript.language, metrics, started)
            for sentence in buffer.flush():
                await self._speak(sentence, transcript.language, metrics, started)
        except asyncio.CancelledError:
            metrics.interrupted = True
            raise
        except BridgeError as exc:
            metrics.error_code = exc.code
            _logger.warning("voice_reply_failed", extra={"error_code": exc.code, "retryable": exc.retryable})
        finally:
            # Closing the stream closes the HTTP request: the AI service stops generating.
            aclose = getattr(stream, "aclose", None)
            if aclose is not None:
                with contextlib.suppress(Exception):
                    await aclose()
