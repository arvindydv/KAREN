"""DeepgramSpeechClient against fake endpoints (httpx2.MockTransport, fake WebSocket). No network.

Model and voice IDs are read from ``config/voice-catalog.deepgram.json`` (never hardcoded). The
response bodies below are shaped like Deepgram's documented responses; they prove request shaping,
parsing, retry/no-replay rules and usage reporting — NOT live Deepgram behaviour or accuracy.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator, Mapping
from typing import Any
from urllib.parse import parse_qs, urlsplit

import httpx2
import pytest
from pydantic import SecretStr
from websockets.exceptions import ConnectionClosedOK

from karen_ai.core.errors import KarenAIError
from karen_ai.core.settings import SERVICE_ROOT
from karen_ai.gateway.base import GatewayError
from karen_ai.speech.base import LiveConfig, SynthesisInput, SynthesisUsage, TranscriptionInput
from karen_ai.speech.catalog import load_catalog
from karen_ai.speech.deepgram import (
    DeepgramSpeechClient,
    batch_language_params,
    flux_event,
    parse_batch_transcription,
)
from karen_ai.speech.service import transcript_language

CATALOG = load_catalog(SERVICE_ROOT / "config" / "voice-catalog.deepgram.json")
BATCH_MODEL = CATALOG.usable_stt(require_verified=False, provider="deepgram", mode="batch")[0]
LIVE_MODEL = CATALOG.usable_stt(require_verified=False, provider="deepgram", mode="live")[0]
VOICES = CATALOG.usable_voices(require_verified=False, provider="deepgram")
FLUX_VOICE = next(v for v in VOICES if v.model_id.endswith("flux-tts") and v.language == "hi")
AURA_VOICE = next(v for v in VOICES if "aura" in v.model_id)
TEST_KEY = "dg-test-key-not-real-0000000000"


def listen_body(transcript: str, *, language: str | None = None, duration: float = 2.5) -> dict[str, Any]:
    channel: dict[str, Any] = {"alternatives": [{"transcript": transcript, "confidence": 0.9, "words": []}]}
    if language:
        channel["detected_language"] = language
    return {
        "metadata": {"request_id": "dg-req-1", "duration": duration, "channels": 1},
        "results": {"channels": [channel]},
    }


class Recorder:
    def __init__(self, *responses: httpx2.Response | Exception) -> None:
        self._responses = list(responses)
        self.requests: list[httpx2.Request] = []

    def __call__(self, request: httpx2.Request) -> httpx2.Response:
        self.requests.append(request)
        item = self._responses.pop(0) if len(self._responses) > 1 else self._responses[0]
        if isinstance(item, Exception):
            raise item
        return item

    def query(self, index: int = 0) -> dict[str, list[str]]:
        return parse_qs(urlsplit(str(self.requests[index].url)).query)


class AudioStream(httpx2.AsyncByteStream):
    def __init__(self, chunks: list[bytes], fail_after: int | None = None) -> None:
        self._chunks, self._fail_after = chunks, fail_after

    async def __aiter__(self) -> AsyncIterator[bytes]:
        for index, chunk in enumerate(self._chunks):
            if index == self._fail_after:
                raise httpx2.ReadError("connection reset by test")
            yield chunk


def make_client(recorder: Recorder, **kwargs: Any) -> tuple[DeepgramSpeechClient, list[float]]:
    delays: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        delays.append(seconds)

    return (
        DeepgramSpeechClient(
            api_key=SecretStr(TEST_KEY),
            timeout_seconds=5,
            max_retries=kwargs.pop("max_retries", 2),
            http_client=httpx2.AsyncClient(transport=httpx2.MockTransport(recorder)),
            sleep=fake_sleep,
            **kwargs,
        ),
        delays,
    )


def stt_input(hint: Any = None, models: tuple[str, ...] = (BATCH_MODEL,)) -> TranscriptionInput:
    return TranscriptionInput(
        request_id="req_voice_0001",
        audio=b"\x1aE\xdf\xa3fake",
        audio_format="webm",
        language_hint=hint,
        models=models,
    )


# ------------------------------------------------------------------------------- batch STT


async def test_batch_request_shape_auth_and_privacy_params() -> None:
    recorder = Recorder(httpx2.Response(200, json=listen_body("hello")))
    client, _ = make_client(recorder)
    out = await client.transcribe(stt_input())
    request = recorder.requests[0]
    assert request.url.host == "api.deepgram.com"
    assert request.url.path == "/v1/listen"
    assert request.headers["authorization"] == f"Token {TEST_KEY}"
    assert request.headers["content-type"] == "audio/webm"
    assert request.content == b"\x1aE\xdf\xa3fake"
    query = recorder.query()
    assert query["model"] == [BATCH_MODEL.removeprefix("deepgram/")]
    assert query["language"] == ["multi"]
    assert query["language_hint"] == ["en", "hi"]
    assert query["smart_format"] == ["true"]
    assert query["mip_opt_out"] == ["true"]
    assert (out.text, out.duration_seconds, out.provider_request_id) == ("hello", 2.5, "dg-req-1")
    assert out.served_model == BATCH_MODEL
    assert out.reported_cost_usd is None


def test_language_params_per_hint() -> None:
    assert batch_language_params("hi") == [("language", "hi")]
    assert batch_language_params("en") == [("language", "en")]
    assert batch_language_params("hi-Latn")[0] == ("language", "multi")
    assert batch_language_params(None)[0] == ("language", "multi")


async def test_india_region_uses_the_india_host() -> None:
    recorder = Recorder(httpx2.Response(200, json=listen_body("ok")))
    client, _ = make_client(recorder, region="in")
    await client.transcribe(stt_input())
    assert recorder.requests[0].url.host == "api.in.deepgram.com"


@pytest.mark.parametrize(
    ("transcript", "provider_language", "expected"),
    [
        ("Can you explain this architecture?", "en", "en"),
        ("मुझे authentication system समझाओ।", "hi", "hi"),
        ("Hey Karen, mujhe kal ke meetings ka summary batao.", "hi", "hi-Latn"),
        ("Mujhe authentication system samjhao, kya hai yeh?", None, "hi-Latn"),
    ],
)
async def test_english_hindi_and_hinglish_transcripts(
    transcript: str, provider_language: str | None, expected: str
) -> None:
    recorder = Recorder(httpx2.Response(200, json=listen_body(transcript, language=provider_language)))
    client, _ = make_client(recorder)
    out = await client.transcribe(stt_input())
    assert out.text == transcript  # meaning preserved: no translation, terms untouched
    assert transcript_language(out.text, out.language) == expected


def test_multilingual_languages_array_is_read_when_no_detected_language() -> None:
    body = listen_body("namaste")
    body["results"]["channels"][0]["alternatives"][0]["languages"] = ["hi", "en"]
    assert parse_batch_transcription(body)[1] == "hi"


async def test_retries_5xx_then_succeeds() -> None:
    recorder = Recorder(
        httpx2.Response(503, json={"err_code": "X"}), httpx2.Response(200, json=listen_body("ok"))
    )
    client, delays = make_client(recorder)
    out = await client.transcribe(stt_input())
    assert out.text == "ok"
    assert out.attempts == 2
    assert len(delays) == 1


async def test_payment_required_is_not_retried_and_never_echoes_upstream_text() -> None:
    recorder = Recorder(
        httpx2.Response(402, json={"err_code": "ASR_PAYMENT_REQUIRED", "err_msg": "secret transcript text"})
    )
    client, delays = make_client(recorder)
    with pytest.raises(GatewayError) as exc:
        await client.transcribe(stt_input())
    assert not exc.value.retryable
    assert delays == []
    assert len(recorder.requests) == 1
    assert "secret transcript" not in str(exc.value)
    assert TEST_KEY not in str(exc.value)


async def test_model_not_enabled_falls_through_to_next_catalog_model() -> None:
    recorder = Recorder(httpx2.Response(403, json={}), httpx2.Response(200, json=listen_body("ok")))
    client, _ = make_client(recorder)
    out = await client.transcribe(stt_input(models=("deepgram/model-a", "deepgram/model-b")))
    assert out.served_model == "deepgram/model-b"


async def test_invalid_body_is_a_typed_error() -> None:
    client, _ = make_client(Recorder(httpx2.Response(200, json={"metadata": {}})))
    with pytest.raises(GatewayError) as exc:
        await client.transcribe(stt_input())
    assert exc.value.code == "GATEWAY_INVALID_RESPONSE"


async def test_non_deepgram_model_ids_are_refused() -> None:
    client, _ = make_client(Recorder(httpx2.Response(200, json=listen_body("x"))))
    with pytest.raises(KarenAIError) as exc:
        await client.transcribe(stt_input(models=("test-creator/stt",)))
    assert exc.value.code == "CAPABILITY_UNAVAILABLE"


# -------------------------------------------------------------------------------------- TTS


def tts_input(voice: Any, speed: float = 1.0, usage: list[SynthesisUsage] | None = None) -> SynthesisInput:
    return SynthesisInput(
        request_id="req_speech_0001",
        text="Namaste. Main KAREN hoon.",
        model=voice.model_id,
        voice_id=voice.voice_id,
        speed=speed,
        on_usage=usage.append if usage is not None else None,
    )


async def test_flux_voice_uses_v2_speak_with_mp3_and_reports_usage() -> None:
    headers = {"content-type": "audio/mpeg", "dg-request-id": "dg-tts-1", "dg-char-count": "24"}
    recorder = Recorder(httpx2.Response(200, headers=headers, stream=AudioStream([b"ID3a", b"b"])))
    client, _ = make_client(recorder)
    usage: list[SynthesisUsage] = []
    audio = b"".join([c async for c in client.synthesize(tts_input(FLUX_VOICE, usage=usage))])
    request = recorder.requests[0]
    assert audio == b"ID3ab"
    assert request.url.path == "/v2/speak"
    assert recorder.query()["model"] == [FLUX_VOICE.voice_id]
    assert recorder.query()["encoding"] == ["mp3"]
    assert "speed" not in recorder.query()
    assert json.loads(request.content) == {"text": "Namaste. Main KAREN hoon."}
    assert usage == [
        SynthesisUsage(characters=24, provider_request_id="dg-tts-1", served_model=FLUX_VOICE.voice_id)
    ]


async def test_aura_voice_uses_v1_speak_and_sends_speed() -> None:
    recorder = Recorder(httpx2.Response(200, stream=AudioStream([b"x"])))
    client, _ = make_client(recorder)
    _ = [c async for c in client.synthesize(tts_input(AURA_VOICE, speed=1.2))]
    assert recorder.requests[0].url.path == "/v1/speak"
    assert recorder.query()["speed"] == ["1.20"]


async def test_tts_retries_before_audio_but_never_after() -> None:
    recorder = Recorder(httpx2.Response(429, json={}), httpx2.Response(200, stream=AudioStream([b"a"])))
    client, delays = make_client(recorder)
    assert [c async for c in client.synthesize(tts_input(FLUX_VOICE))] == [b"a"]
    assert len(delays) == 1

    broken = Recorder(httpx2.Response(200, stream=AudioStream([b"a", b"b"], fail_after=1)))
    client, delays = make_client(broken)
    received: list[bytes] = []

    async def consume() -> None:
        async for chunk in client.synthesize(tts_input(FLUX_VOICE)):
            received.append(chunk)

    with pytest.raises(GatewayError) as exc:
        await consume()
    assert received == [b"a"]
    assert exc.value.partial
    assert len(broken.requests) == 1
    assert delays == []


# ------------------------------------------------------------------------- live streaming, Flux


def test_flux_messages_are_normalised() -> None:
    assert flux_event({"type": "Connected", "request_id": "r1"}) is not None
    started = flux_event({"type": "TurnInfo", "event": "StartOfTurn", "turn_index": 0, "transcript": ""})
    update = flux_event({"type": "TurnInfo", "event": "Update", "turn_index": 0, "transcript": "mujhe kal "})
    end = flux_event(
        {
            "type": "TurnInfo",
            "event": "EndOfTurn",
            "turn_index": 0,
            "transcript": "mujhe kal ki meetings batao",
            "audio_window_end": 3.2,
            "languages": ["hi", "en"],
        }
    )
    assert started is not None
    assert started.kind == "speech_started"
    assert update is not None
    assert (update.kind, update.text) == ("partial", "mujhe kal")
    assert end is not None
    assert (end.kind, end.language, end.audio_seconds) == ("end_of_turn", "hi", 3.2)
    error = flux_event({"type": "Error", "code": "X", "description": "has user text"})
    assert error is not None
    assert error.kind == "error"
    assert error.text == ""
    assert flux_event({"type": "ConfigureSuccess"}) is None


class FakeSocket:
    def __init__(self, messages: list[str]) -> None:
        self._messages = messages
        self.sent: list[bytes | str] = []
        self.closed = False

    async def send(self, data: bytes | str) -> None:
        self.sent.append(data)

    def __aiter__(self) -> AsyncIterator[str]:
        return self._iterate()

    async def _iterate(self) -> AsyncIterator[str]:
        for message in self._messages:
            yield message
        raise ConnectionClosedOK(None, None)

    async def close(self) -> None:
        self.closed = True


async def test_live_connect_url_auth_and_stream() -> None:
    socket = FakeSocket(
        [
            json.dumps({"type": "Connected", "request_id": "dg-live-1"}),
            json.dumps({"type": "TurnInfo", "event": "EndOfTurn", "turn_index": 0, "transcript": "hello"}),
        ]
    )
    seen: dict[str, Any] = {}

    async def connector(url: str, headers: Mapping[str, str]) -> Any:
        seen["url"], seen["headers"] = url, dict(headers)
        return socket

    client, _ = make_client(Recorder(httpx2.Response(200)), ws_connect=connector)
    stream = await client.connect(
        LiveConfig(
            request_id="req_live_0001", model=LIVE_MODEL, language_hints=("en", "hi"), audio_format="webm"
        )
    )
    parts = urlsplit(seen["url"])
    query = parse_qs(parts.query)
    assert (parts.scheme, parts.path) == ("wss", "/v2/listen")
    assert query["model"] == [LIVE_MODEL.removeprefix("deepgram/")]
    assert query["language_hint"] == ["en", "hi"]
    assert "encoding" not in query
    assert seen["headers"]["Authorization"] == f"Token {TEST_KEY}"
    await stream.send_audio(b"opus")
    events = [e async for e in stream.events()]
    await stream.finish()
    assert [e.kind for e in events] == ["ready", "end_of_turn"]
    assert socket.sent == [b"opus", json.dumps({"type": "CloseStream"})]


async def test_live_finish_without_audio_closes_instead_of_close_stream() -> None:
    # Flux answers CloseStream on an empty stream with an Error (observed live); a session the user
    # closed before speaking must end quietly.
    socket = FakeSocket([json.dumps({"type": "Connected", "request_id": "dg-live-2"})])

    async def connector(url: str, headers: Mapping[str, str]) -> Any:
        return socket

    client, _ = make_client(Recorder(httpx2.Response(200)), ws_connect=connector)
    stream = await client.connect(
        LiveConfig(request_id="req_live_0002", model=LIVE_MODEL, language_hints=(), audio_format="webm")
    )
    await stream.finish()
    assert socket.sent == []
    assert socket.closed
    await stream.send_audio(b"late")
    assert socket.sent == []


def test_live_pcm16_tells_deepgram_the_encoding_and_rate() -> None:
    # Phone microphone stream (ADR-0031): raw audio has no container, so Deepgram needs both.
    client, _ = make_client(Recorder(httpx2.Response(200)))
    url = client.live_url(
        LiveConfig(request_id="req_live_pcm1", model=LIVE_MODEL, language_hints=("en",), audio_format="pcm16")
    )
    query = parse_qs(urlsplit(url).query)
    assert query["encoding"] == ["linear16"]
    assert query["sample_rate"] == ["16000"]
    webm = client.live_url(
        LiveConfig(request_id="req_live_web1", model=LIVE_MODEL, language_hints=(), audio_format="webm")
    )
    assert "encoding" not in parse_qs(urlsplit(webm).query)


async def test_live_requires_a_flux_model() -> None:
    client, _ = make_client(Recorder(httpx2.Response(200)))
    with pytest.raises(KarenAIError):
        client.live_url(
            LiveConfig(request_id="r" * 8, model=BATCH_MODEL, language_hints=(), audio_format="webm")
        )
