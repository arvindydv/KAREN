"""Deterministic, offline speech providers for tests, local dev and mock mode.

Output is labelled: the mock transcript says no speech model was called, and mock audio is silence.
For tests, audio whose bytes start with ``MOCK:`` is "transcribed" to the UTF-8 text that follows,
so voice commands can be driven end to end through the real router without any network.
"""

from __future__ import annotations

import asyncio
import io
import struct
import wave
from collections.abc import AsyncIterator
from typing import Final

from karen_ai.speech.base import (
    LiveConfig,
    LiveTranscriptEvent,
    SynthesisInput,
    SynthesisUsage,
    TranscriptionInput,
    TranscriptionOutput,
)

MOCK_STT_MODEL: Final = "mock/stt"
MOCK_TRANSCRIPT_PREFIX: Final = b"MOCK:"
MOCK_TRANSCRIPT_EN: Final = "[mock] voice note received; no speech model was called"
MOCK_TRANSCRIPT_HI: Final = "[mock] आवाज़ संदेश मिला; कोई स्पीच मॉडल नहीं बुलाया गया"
_SAMPLE_RATE: Final = 16_000
_MS_PER_CHAR: Final = 40
_MAX_MOCK_AUDIO_MS: Final = 30_000
_CHUNK_BYTES: Final = 8_192


class MockSpeechToText:
    def __init__(self) -> None:
        self.calls: list[TranscriptionInput] = []

    @property
    def is_mock(self) -> bool:
        return True

    async def transcribe(self, request: TranscriptionInput) -> TranscriptionOutput:
        self.calls.append(request)
        if request.audio.startswith(MOCK_TRANSCRIPT_PREFIX):
            text = request.audio[len(MOCK_TRANSCRIPT_PREFIX) :].decode("utf-8", errors="replace").strip()
            language = None  # let KAREN detect it from the text, as with a real provider
        elif request.language_hint == "hi":
            text, language = MOCK_TRANSCRIPT_HI, "hi"
        else:
            text, language = MOCK_TRANSCRIPT_EN, "en"
        return TranscriptionOutput(
            text=text,
            language=language,
            duration_seconds=None,
            served_model=MOCK_STT_MODEL,
            reported_cost_usd=0.0,
            attempts=1,
        )

    async def aclose(self) -> None:
        return None


def silent_wav(duration_ms: int) -> bytes:
    """A valid mono 16-bit PCM WAV file of silence."""
    frames = _SAMPLE_RATE * duration_ms // 1000
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(_SAMPLE_RATE)
        wav.writeframes(struct.pack(f"<{frames}h", *([0] * frames)))
    return buffer.getvalue()


class MockTextToSpeech:
    def __init__(self) -> None:
        self.calls: list[SynthesisInput] = []

    @property
    def is_mock(self) -> bool:
        return True

    @property
    def media_type(self) -> str:
        return "audio/wav"

    @property
    def concatenable(self) -> bool:
        return False  # WAV files cannot simply be appended: synthesise the whole text at once

    async def synthesize(self, request: SynthesisInput) -> AsyncIterator[bytes]:
        self.calls.append(request)
        audio = silent_wav(min(len(request.text) * _MS_PER_CHAR, _MAX_MOCK_AUDIO_MS))
        for start in range(0, len(audio), _CHUNK_BYTES):
            yield audio[start : start + _CHUNK_BYTES]
        if request.on_usage is not None:
            request.on_usage(
                SynthesisUsage(characters=len(request.text), provider_request_id=None, served_model=None)
            )

    async def aclose(self) -> None:
        return None


# --------------------------------------------------------------------- live sessions, mock

MOCK_LIVE_ERROR: Final = b"MOCK-ERROR"
# Each streamed chunk counts as this much audio (browser MediaRecorder timeslice).
MOCK_CHUNK_SECONDS: Final = 0.25


class MockLiveStream:
    """Deterministic live session: a chunk ``MOCK:<text>`` is "spoken" as one complete turn.

    Emits ``speech_started``, one ``partial`` per word, then ``end_of_turn`` — so turn detection,
    partial transcripts and barge-in can be exercised end to end without any network. Other chunks
    count as silence. ``MOCK-ERROR`` simulates a provider failure.
    """

    def __init__(self) -> None:
        self._queue: asyncio.Queue[LiveTranscriptEvent | None] = asyncio.Queue()
        self._queue.put_nowait(LiveTranscriptEvent(kind="ready", provider_request_id=None))
        self._seconds = 0.0
        self._turn = 0
        self._closed = False
        self.received: list[bytes] = []

    async def send_audio(self, chunk: bytes) -> None:
        if self._closed:
            return
        self.received.append(chunk)
        self._seconds += MOCK_CHUNK_SECONDS
        if chunk.startswith(MOCK_LIVE_ERROR):
            await self._queue.put(LiveTranscriptEvent(kind="error", error_code="PROVIDER_ERROR"))
            await self._queue.put(None)
            self._closed = True
            return
        if not chunk.startswith(MOCK_TRANSCRIPT_PREFIX):
            return
        text = chunk[len(MOCK_TRANSCRIPT_PREFIX) :].decode("utf-8", errors="replace").strip()
        words = text.split()
        turn = self._turn
        self._turn += 1
        await self._queue.put(
            LiveTranscriptEvent(kind="speech_started", turn_index=turn, audio_seconds=self._seconds)
        )
        for count in range(1, len(words) + 1):
            await self._queue.put(
                LiveTranscriptEvent(kind="partial", text=" ".join(words[:count]), turn_index=turn)
            )
        await self._queue.put(
            LiveTranscriptEvent(kind="end_of_turn", text=text, turn_index=turn, audio_seconds=self._seconds)
        )

    async def events(self) -> AsyncIterator[LiveTranscriptEvent]:
        while True:
            event = await self._queue.get()
            if event is None:
                return
            yield event

    async def finish(self) -> None:
        if not self._closed:
            self._closed = True
            await self._queue.put(None)

    async def abort(self) -> None:
        await self.finish()


class MockLiveTranscriber:
    def __init__(self) -> None:
        self.configs: list[LiveConfig] = []
        self.streams: list[MockLiveStream] = []

    @property
    def is_mock(self) -> bool:
        return True

    async def connect(self, config: LiveConfig) -> MockLiveStream:
        self.configs.append(config)
        stream = MockLiveStream()
        self.streams.append(stream)
        return stream
