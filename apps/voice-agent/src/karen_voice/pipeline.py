"""Speech pipeline interfaces (architecture §6, option B: STT -> text LLM -> TTS).

No real provider is wired: every speech model path is NOT VERIFIED (gateway audio, LiveKit
transport combination, Hindi/Hinglish accuracy). Implementations must be gated by
``AudioCapabilityGate`` and evaluated on Indian audio before use.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class AudioFrame:
    pcm16: bytes
    sample_rate_hz: int
    channels: int = 1


@dataclass(frozen=True)
class Transcript:
    text: str
    is_final: bool
    language: str | None
    # Offsets relative to session start (architecture §6 "transcript time offsets").
    start_ms: int
    end_ms: int
    confidence: float | None = None


class SpeechToText(Protocol):
    def transcribe(self, frames: AsyncIterator[AudioFrame]) -> AsyncIterator[Transcript]: ...


class TextToSpeech(Protocol):
    def synthesize(self, text: str, *, language: str | None) -> AsyncIterator[AudioFrame]: ...


class TurnDetector(Protocol):
    """VAD / end-of-turn detection. Barge-in: ``user_started_speaking`` interrupts playback."""

    def user_started_speaking(self, frame: AudioFrame) -> bool: ...

    def is_end_of_turn(self, transcript: Transcript, silence_ms: int) -> bool: ...


class ConversationBridge(Protocol):
    """Hands a final user transcript to the AI service text path and returns the reply text."""

    async def reply(self, transcript: Transcript, *, session_id: str, user_ref: str) -> str: ...

    def reply_stream(self, transcript: Transcript, *, session_id: str, user_ref: str) -> AsyncIterator[str]:
        """Reply text deltas; closing the iterator early (barge-in) cancels the generation."""
        ...
