"""Deterministic mock speech components for tests and local wiring. Not speech models."""

from __future__ import annotations

from collections.abc import AsyncIterator, Sequence
from typing import Final

from karen_voice.pipeline import AudioFrame, Transcript

SAMPLE_RATE_HZ: Final = 16_000


class ScriptedSpeechToText:
    """Emits pre-scripted transcripts, one per received frame."""

    def __init__(self, script: Sequence[str], *, language: str = "hi-Latn") -> None:
        self._script = list(script)
        self._language = language

    async def transcribe(self, frames: AsyncIterator[AudioFrame]) -> AsyncIterator[Transcript]:
        offset_ms = 0
        index = 0
        async for frame in frames:
            if index >= len(self._script):
                break
            duration_ms = len(frame.pcm16) * 1000 // (2 * frame.sample_rate_hz * frame.channels)
            yield Transcript(
                text=self._script[index],
                is_final=True,
                language=self._language,
                start_ms=offset_ms,
                end_ms=offset_ms + duration_ms,
                confidence=None,
            )
            offset_ms += duration_ms
            index += 1


class SilentTextToSpeech:
    """Produces silence proportional to text length (20 ms per character)."""

    async def synthesize(self, text: str, *, language: str | None) -> AsyncIterator[AudioFrame]:
        del language
        samples = SAMPLE_RATE_HZ * 20 // 1000
        for _ in text:
            yield AudioFrame(pcm16=b"\x00\x00" * samples, sample_rate_hz=SAMPLE_RATE_HZ)


class EnergyTurnDetector:
    """Toy VAD: any non-zero sample means speech; end of turn after a silence threshold."""

    def __init__(self, end_of_turn_silence_ms: int = 700) -> None:
        self._threshold = end_of_turn_silence_ms

    def user_started_speaking(self, frame: AudioFrame) -> bool:
        return any(frame.pcm16)

    def is_end_of_turn(self, transcript: Transcript, silence_ms: int) -> bool:
        return transcript.is_final and silence_ms >= self._threshold


class EchoConversationBridge:
    async def reply(self, transcript: Transcript, *, session_id: str, user_ref: str) -> str:
        del session_id, user_ref
        return f"[mock] heard {len(transcript.text.split())} word(s)"
