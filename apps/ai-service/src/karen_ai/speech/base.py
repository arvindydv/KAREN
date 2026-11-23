"""Provider-independent speech interfaces (ADR-0026).

KAREN code talks to ``SpeechToTextProvider`` / ``TextToSpeechProvider`` / ``LiveTranscriber``
only; Deepgram (ADR-0027), OpenRouter and the mocks are interchangeable implementations. Audio
bytes and transcript text never appear in logs, errors or invocation records.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from typing import Literal, Protocol

from karen_ai.contracts import AudioInputFormat, SpeechLanguage


@dataclass(frozen=True)
class TranscriptionInput:
    request_id: str
    audio: bytes
    audio_format: AudioInputFormat
    language_hint: SpeechLanguage | None
    # Ordered preference; a provider may try the next one on a retryable failure.
    models: tuple[str, ...]


@dataclass(frozen=True)
class TranscriptionOutput:
    text: str
    # Provider-reported language code (ISO 639-1 or similar), normalised later.
    language: str | None
    duration_seconds: float | None
    served_model: str | None
    reported_cost_usd: float | None
    attempts: int
    # Provider request id (e.g. Deepgram ``metadata.request_id``) for usage reconciliation.
    provider_request_id: str | None = None


@dataclass(frozen=True)
class SynthesisUsage:
    """What one synthesis request consumed, reported by the provider when it can."""

    characters: int
    provider_request_id: str | None
    served_model: str | None


@dataclass(frozen=True)
class SynthesisInput:
    request_id: str
    text: str
    model: str
    voice_id: str
    speed: float
    # Called once per successful provider request with its usage (billing, reconciliation).
    on_usage: Callable[[SynthesisUsage], None] | None = None


class SpeechToTextProvider(Protocol):
    @property
    def is_mock(self) -> bool: ...

    async def transcribe(self, request: TranscriptionInput) -> TranscriptionOutput: ...

    async def aclose(self) -> None: ...


class TextToSpeechProvider(Protocol):
    @property
    def is_mock(self) -> bool: ...

    @property
    def media_type(self) -> str:
        """Content type of the produced audio (e.g. ``audio/mpeg``)."""
        ...

    @property
    def concatenable(self) -> bool:
        """True when separately synthesised chunks can be joined into one playable stream."""
        ...

    def synthesize(self, request: SynthesisInput) -> AsyncIterator[bytes]:
        """Yield audio bytes, or raise ``GatewayError`` before the first byte.

        Implementations must never restart a synthesis after bytes were yielded.
        """
        ...

    async def aclose(self) -> None: ...


# ------------------------------------------------------------------------------ live (ADR-0027)

LiveEventKind = Literal["ready", "speech_started", "partial", "end_of_turn", "error", "closed"]


@dataclass(frozen=True)
class LiveConfig:
    request_id: str
    model: str
    # Expected languages (ISO 639-1); empty = provider default (multilingual auto-detection).
    language_hints: tuple[str, ...]
    # Container/codec of the audio the client streams (browser MediaRecorder: webm/opus;
    # phone: pcm16 = raw 16-bit 16 kHz mono).
    audio_format: Literal["webm", "ogg", "pcm16"]


@dataclass(frozen=True)
class LiveTranscriptEvent:
    """A provider-neutral live transcription event. ``text`` is never logged."""

    kind: LiveEventKind
    text: str = ""
    language: str | None = None
    turn_index: int | None = None
    # Seconds of audio the provider has processed so far (billing input), when reported.
    audio_seconds: float | None = None
    provider_request_id: str | None = None
    # error events only: a stable code (no upstream text).
    error_code: str | None = None


class LiveStream(Protocol):
    async def send_audio(self, chunk: bytes) -> None: ...

    def events(self) -> AsyncIterator[LiveTranscriptEvent]:
        """Normalised events until the provider closes the stream."""
        ...

    async def finish(self) -> None:
        """Ask the provider to flush and close (remaining events still arrive)."""
        ...

    async def abort(self) -> None: ...


class LiveTranscriber(Protocol):
    @property
    def is_mock(self) -> bool: ...

    async def connect(self, config: LiveConfig) -> LiveStream:
        """Open a streaming session, or raise ``GatewayError`` (nothing is billed then)."""
        ...
