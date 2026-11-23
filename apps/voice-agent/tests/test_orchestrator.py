"""Voice turn-taking: streamed reply -> sentence TTS, barge-in cancellation, streaming bridge.

Fakes only (no LiveKit, no network). Real speech providers and devices are NOT VERIFIED.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from typing import Any

import httpx2
import pytest
from pydantic import SecretStr

from karen_voice.bridge import STREAM_PATH, AiServiceConversationBridge, BridgeError
from karen_voice.orchestrator import MAX_PENDING_CHARS, SentenceBuffer, VoiceOrchestrator
from karen_voice.pipeline import AudioFrame, Transcript
from tests.conftest import TEST_HMAC_SECRET

SPEECH = AudioFrame(pcm16=b"\x10\x00" * 160, sample_rate_hz=16_000)
SILENCE = AudioFrame(pcm16=b"\x00\x00" * 160, sample_rate_hz=16_000)


def final(text: str, language: str | None = "hi-Latn") -> Transcript:
    return Transcript(text=text, is_final=True, language=language, start_ms=0, end_ms=900)


class ScriptedBridge:
    def __init__(self, deltas: list[str], *, delay: float = 0.0, error: BridgeError | None = None) -> None:
        self._deltas, self._delay, self._error = deltas, delay, error
        self.closed = 0
        self.started = 0

    async def reply(self, transcript: Transcript, *, session_id: str, user_ref: str) -> str:
        return "".join(self._deltas)

    async def reply_stream(
        self, transcript: Transcript, *, session_id: str, user_ref: str
    ) -> AsyncIterator[str]:
        self.started += 1
        try:
            for delta in self._deltas:
                if self._delay:
                    await asyncio.sleep(self._delay)
                yield delta
            if self._error is not None:
                raise self._error
        finally:
            self.closed += 1


class RecordingTTS:
    def __init__(self, *, delay: float = 0.0) -> None:
        self.spoken: list[tuple[str, str | None]] = []
        self._delay = delay

    async def synthesize(self, text: str, *, language: str | None) -> AsyncIterator[AudioFrame]:
        self.spoken.append((text, language))
        for _ in range(3):
            if self._delay:
                await asyncio.sleep(self._delay)
            yield SPEECH


class EnergyDetector:
    def user_started_speaking(self, frame: AudioFrame) -> bool:
        return any(frame.pcm16)

    def is_end_of_turn(self, transcript: Transcript, silence_ms: int) -> bool:
        return silence_ms >= 700


def orchestrator(bridge: ScriptedBridge, tts: RecordingTTS, played: list[AudioFrame]) -> VoiceOrchestrator:
    async def sink(frame: AudioFrame) -> None:
        played.append(frame)

    return VoiceOrchestrator(
        bridge=bridge,
        tts=tts,
        turn_detector=EnergyDetector(),
        audio_sink=sink,
        session_id="sess_test",
        user_ref="usr_hmac_test01",
    )


def is_speaking(voice: VoiceOrchestrator) -> bool:
    return voice.speaking  # a call, so type narrowing does not carry across awaits


# ------------------------------------------------------------------------------ sentence buffer


def test_sentence_buffer_releases_latin_and_devanagari_sentences() -> None:
    buffer = SentenceBuffer()
    assert buffer.push("Kal subah ") == []
    assert buffer.push("7 baje. Theek") == ["Kal subah 7 baje."]
    assert buffer.push(" hai? कल मिलते हैं। ") == ["Theek hai?", "कल मिलते हैं।"]
    assert buffer.flush() == []


def test_sentence_buffer_splits_long_unpunctuated_runs() -> None:
    buffer = SentenceBuffer()
    ready = buffer.push("shabd " * 60)
    assert ready
    assert all(len(s) <= MAX_PENDING_CHARS for s in ready)


# ---------------------------------------------------------------------------------- turn flow


async def test_reply_is_spoken_sentence_by_sentence_in_the_transcript_language() -> None:
    bridge, tts = ScriptedBridge(["Haan, ", "kal 7 baje. ", "Main yaad ", "dila doongi."]), RecordingTTS()
    played: list[AudioFrame] = []
    voice = orchestrator(bridge, tts, played)
    await voice.on_final_transcript(final("Kal subah 7 baje yaad dilana"))
    await voice.wait_idle()
    assert tts.spoken == [("Haan, kal 7 baje.", "hi-Latn"), ("Main yaad dila doongi.", "hi-Latn")]
    assert len(played) == 6
    metrics = voice.stats.last_turn
    assert metrics.sentences == 2
    assert metrics.first_audio_ms is not None
    assert metrics.first_text_ms is not None
    assert not metrics.interrupted
    assert bridge.closed == 1


async def test_partial_or_empty_transcripts_do_not_start_a_turn() -> None:
    bridge, tts = ScriptedBridge(["x."]), RecordingTTS()
    played: list[AudioFrame] = []
    voice = orchestrator(bridge, tts, played)
    await voice.on_final_transcript(Transcript("kal sub", False, "hi-Latn", 0, 300))
    await voice.on_final_transcript(final("   "))
    assert bridge.started == 0
    assert not voice.speaking


async def test_barge_in_stops_playback_and_cancels_the_generation() -> None:
    sentences = [f"Vaakya number {i}. " for i in range(20)]
    bridge, tts = ScriptedBridge(sentences, delay=0.01), RecordingTTS(delay=0.005)
    played: list[AudioFrame] = []
    voice = orchestrator(bridge, tts, played)
    await voice.on_final_transcript(final("Mujhe Goa trip plan karni hai"))
    await asyncio.sleep(0.05)
    assert is_speaking(voice)
    await voice.on_user_audio(SILENCE)  # background silence never interrupts
    assert is_speaking(voice)
    await voice.on_user_audio(SPEECH)  # the user talks over KAREN
    assert not is_speaking(voice)
    spoken_at_interrupt = len(tts.spoken)
    await asyncio.sleep(0.05)
    assert len(tts.spoken) == spoken_at_interrupt  # nothing more is synthesised
    assert spoken_at_interrupt < len(sentences)
    assert bridge.closed == 1  # stream closed -> generation cancelled upstream
    assert voice.stats.barge_ins == 1
    assert voice.stats.last_turn.interrupted


async def test_a_new_turn_interrupts_the_previous_reply() -> None:
    bridge, tts = ScriptedBridge([f"Lamba jawab {i}. " for i in range(20)], delay=0.01), RecordingTTS()
    played: list[AudioFrame] = []
    voice = orchestrator(bridge, tts, played)
    await voice.on_final_transcript(final("Pehla sawaal"))
    await asyncio.sleep(0.03)
    await voice.on_final_transcript(final("Ruko, doosra sawaal"))
    await asyncio.sleep(0.03)
    await voice.interrupt()
    assert bridge.started == 2
    assert bridge.closed == 2
    assert voice.stats.turns == 2


async def test_bridge_failure_ends_the_turn_quietly_after_speaking_what_arrived() -> None:
    bridge = ScriptedBridge(["Ek baat. "], error=BridgeError("GATEWAY_TIMEOUT", retryable=True))
    tts = RecordingTTS()
    played: list[AudioFrame] = []
    voice = orchestrator(bridge, tts, played)
    await voice.on_final_transcript(final("Kuch batao"))
    await voice.wait_idle()
    assert [t for t, _ in tts.spoken] == ["Ek baat."]
    assert voice.stats.last_turn.error_code == "GATEWAY_TIMEOUT"


# ------------------------------------------------------------------------- streaming bridge (SSE)


def _sse(*events: dict[str, Any]) -> bytes:
    return b"".join(f"event: {e['event']}\ndata: {json.dumps(e)}\n\n".encode() for e in events)


def _bridge(handler: Any) -> tuple[AiServiceConversationBridge, list[httpx2.Request]]:
    seen: list[httpx2.Request] = []

    def record(request: httpx2.Request) -> httpx2.Response:
        seen.append(request)
        result: httpx2.Response = handler(request)
        return result

    client = httpx2.AsyncClient(base_url="http://ai.test", transport=httpx2.MockTransport(record))
    return (
        AiServiceConversationBridge(
            client=client, hmac_secret=SecretStr(TEST_HMAC_SECRET), system_prompt="Be brief."
        ),
        seen,
    )


async def test_streaming_bridge_yields_deltas_and_sends_locale_hint() -> None:
    body = _sse(
        {
            "event": "start",
            "request_id": "r",
            "route_tier": "BALANCED",
            "served_model": None,
            "is_mock": True,
        },
        {"event": "delta", "index": 0, "text": "Namaste. "},
        {"event": "delta", "index": 1, "text": "Kaise ho?"},
        {"event": "done", "finish_reason": "stop"},
    )
    bridge, seen = _bridge(
        lambda _r: httpx2.Response(200, content=body, headers={"content-type": "text/event-stream"})
    )
    deltas = [
        d async for d in bridge.reply_stream(final("Namaste"), session_id="s1", user_ref="usr_hmac_test01")
    ]
    assert deltas == ["Namaste. ", "Kaise ho?"]
    sent = json.loads(seen[0].content)
    assert seen[0].url.path == STREAM_PATH
    assert sent["task_kind"] == "CHAT"
    assert sent["locale"] == "hi-IN"
    assert "x-karen-signature" in seen[0].headers


@pytest.mark.parametrize(
    ("response", "code"),
    [
        (
            httpx2.Response(
                200,
                content=_sse(
                    {"event": "error", "code": "GATEWAY_RATE_LIMITED", "message": "x", "retryable": True}
                ),
                headers={"content-type": "text/event-stream"},
            ),
            "GATEWAY_RATE_LIMITED",
        ),
        (
            httpx2.Response(
                403, json={"error": {"code": "BUDGET_EXCEEDED", "message": "x", "retryable": False}}
            ),
            "BUDGET_EXCEEDED",
        ),
    ],
)
async def test_streaming_bridge_maps_errors(response: httpx2.Response, code: str) -> None:
    bridge, _ = _bridge(lambda _r: response)
    with pytest.raises(BridgeError) as exc:
        _ = [
            d async for d in bridge.reply_stream(final("x", "en"), session_id="s", user_ref="usr_hmac_test01")
        ]
    assert exc.value.code == code


async def test_english_transcript_sends_an_indian_english_locale() -> None:
    body = _sse({"event": "done", "finish_reason": "stop"})
    bridge, seen = _bridge(
        lambda _r: httpx2.Response(200, content=body, headers={"content-type": "text/event-stream"})
    )
    _ = [
        d
        async for d in bridge.reply_stream(
            final("Book a cab", "en"), session_id="s", user_ref="usr_hmac_test01"
        )
    ]
    assert json.loads(seen[0].content)["locale"] == "en-IN"
