"""OpenRouterAudioClient against a fake endpoint (httpx2.MockTransport). No network, fake slugs.

Proves request shaping, data policy, model fallback, retry rules and no-replay; it does NOT verify
live OpenRouter speech behaviour (that needs the paid probe and a listening check).
"""

from __future__ import annotations

import base64
import json
from collections.abc import AsyncIterator
from typing import Any

import httpx2
import pytest
from pydantic import SecretStr

from karen_ai.gateway.base import GatewayError
from karen_ai.speech.base import SynthesisInput, TranscriptionInput
from karen_ai.speech.openrouter import OpenRouterAudioClient
from tests.conftest import TEST_GATEWAY_KEY

BASE = "https://gateway.test.invalid/api/v1"
STT_A, STT_B = "test-creator/stt-a", "test-creator/stt-b"
TTS = "test-creator/tts"


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

    def body(self, index: int = 0) -> dict[str, Any]:
        result: dict[str, Any] = json.loads(self.requests[index].content)
        return result


class AudioStream(httpx2.AsyncByteStream):
    def __init__(self, chunks: list[bytes], fail_after: int | None = None) -> None:
        self._chunks, self._fail_after = chunks, fail_after

    async def __aiter__(self) -> AsyncIterator[bytes]:
        for index, chunk in enumerate(self._chunks):
            if index == self._fail_after:
                raise httpx2.ReadError("connection reset by test")
            yield chunk


def client(recorder: Recorder, *, max_retries: int = 2) -> tuple[OpenRouterAudioClient, list[float]]:
    delays: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        delays.append(seconds)

    return (
        OpenRouterAudioClient(
            base_url=BASE,
            api_key=SecretStr(TEST_GATEWAY_KEY),
            timeout_seconds=5,
            max_retries=max_retries,
            http_client=httpx2.AsyncClient(transport=httpx2.MockTransport(recorder)),
            sleep=fake_sleep,
        ),
        delays,
    )


def stt_request(hint: str | None = None) -> TranscriptionInput:
    return TranscriptionInput(
        request_id="req_voice_test",
        audio=b"\x1aE\xdf\xa3 fake webm bytes",
        audio_format="webm",
        language_hint=hint,  # type: ignore[arg-type]
        models=(STT_A, STT_B),
    )


def stt_ok(**overrides: Any) -> httpx2.Response:
    body = {
        "text": " Kal subah yaad dilana ",
        "language": "hi",
        "duration": 2.4,
        "usage": {"cost": 0.000508, "seconds": 2.4},
    }
    body.update(overrides)
    return httpx2.Response(200, json=body)


# ---------------------------------------------------------------------------------- transcription


async def test_transcription_request_shape_and_result() -> None:
    recorder = Recorder(stt_ok())
    audio, _ = client(recorder)
    result = await audio.transcribe(stt_request("hi"))
    sent = recorder.requests[0]
    assert str(sent.url) == f"{BASE}/audio/transcriptions"
    assert sent.headers["authorization"] == f"Bearer {TEST_GATEWAY_KEY}"
    body = recorder.body()
    assert body["model"] == STT_A
    assert base64.b64decode(body["input_audio"]["data"]) == stt_request().audio
    assert body["input_audio"]["format"] == "webm"
    assert body["response_format"] == "verbose_json"
    assert body["language"] == "hi"
    assert body["provider"] == {"data_collection": "deny", "zdr": True}
    assert (result.text, result.language, result.duration_seconds) == ("Kal subah yaad dilana", "hi", 2.4)
    assert result.reported_cost_usd == pytest.approx(0.000508)
    assert result.served_model == STT_A


@pytest.mark.parametrize(("hint", "sent"), [("en", "en"), ("hi", "hi"), ("hi-Latn", None), (None, None)])
async def test_language_hint_mapping(hint: str | None, sent: str | None) -> None:
    recorder = Recorder(stt_ok())
    audio, _ = client(recorder)
    await audio.transcribe(stt_request(hint))
    assert recorder.body().get("language") == sent  # Hinglish is mixed speech: auto-detect


async def test_transcription_retries_then_falls_back_to_the_next_model() -> None:
    recorder = Recorder(httpx2.Response(503, json={"error": {"code": 503}}), stt_ok())
    audio, delays = client(recorder, max_retries=0)
    result = await audio.transcribe(stt_request())
    assert [r["model"] for r in (recorder.body(0), recorder.body(1))] == [STT_A, STT_B]
    assert result.served_model == STT_B
    assert result.attempts == 2
    assert delays == []


async def test_unknown_model_falls_back_but_auth_errors_stop() -> None:
    recorder = Recorder(httpx2.Response(404, json={"error": {"code": 404}}), stt_ok())
    audio, _ = client(recorder)
    assert (await audio.transcribe(stt_request())).served_model == STT_B

    recorder = Recorder(
        httpx2.Response(401, json={"error": {"code": 401, "message": f"bad key {TEST_GATEWAY_KEY}"}})
    )
    audio, _ = client(recorder)
    with pytest.raises(GatewayError) as exc:
        await audio.transcribe(stt_request())
    assert exc.value.status_code == 401
    assert len(recorder.requests) == 1
    assert TEST_GATEWAY_KEY not in exc.value.message


async def test_rate_limit_is_retried_with_backoff_within_one_model() -> None:
    recorder = Recorder(httpx2.Response(429, json={"error": {"code": 429}}), stt_ok())
    audio, delays = client(recorder)
    result = await audio.transcribe(stt_request())
    assert result.served_model == STT_A
    assert len(delays) == 1


async def test_all_models_failing_raises_the_last_error_with_total_attempts() -> None:
    recorder = Recorder(httpx2.Response(503, json={"error": {"code": 503}}))
    audio, _ = client(recorder, max_retries=1)
    with pytest.raises(GatewayError) as exc:
        await audio.transcribe(stt_request())
    assert exc.value.retryable
    assert exc.value.attempts == 4  # 2 attempts x 2 models
    assert len(recorder.requests) == 4


async def test_response_without_text_is_invalid() -> None:
    audio, _ = client(Recorder(httpx2.Response(200, json={"language": "en"})))
    with pytest.raises(GatewayError) as exc:
        await audio.transcribe(stt_request())
    assert exc.value.code == "GATEWAY_INVALID_RESPONSE"


# ------------------------------------------------------------------------------------- speech


def tts_request(speed: float = 1.0) -> SynthesisInput:
    return SynthesisInput(
        request_id="req_speech_test", text="Namaste.", model=TTS, voice_id="hi-IN-Test", speed=speed
    )


def audio_response(chunks: list[bytes], *, fail_after: int | None = None) -> httpx2.Response:
    return httpx2.Response(
        200, headers={"content-type": "audio/mpeg"}, stream=AudioStream(chunks, fail_after)
    )


async def test_speech_request_shape_and_streamed_bytes() -> None:
    recorder = Recorder(audio_response([b"ID3", b"\xff\xfbframe1", b"\xff\xfbframe2"]))
    audio, _ = client(recorder)
    chunks = [c async for c in audio.synthesize(tts_request())]
    assert b"".join(chunks) == b"ID3\xff\xfbframe1\xff\xfbframe2"
    sent = recorder.requests[0]
    assert str(sent.url) == f"{BASE}/audio/speech"
    body = recorder.body()
    assert body == {
        "model": TTS,
        "input": "Namaste.",
        "voice": "hi-IN-Test",
        "response_format": "mp3",
        "provider": {"data_collection": "deny", "zdr": True},
    }
    assert audio.media_type == "audio/mpeg"
    assert audio.concatenable


async def test_speed_is_sent_only_when_not_default() -> None:
    recorder = Recorder(audio_response([b"\xff\xfb"]))
    audio, _ = client(recorder)
    _ = [c async for c in audio.synthesize(tts_request(speed=1.2))]
    assert recorder.body()["speed"] == 1.2


async def test_speech_failure_before_audio_is_retried() -> None:
    recorder = Recorder(httpx2.Response(503, json={"error": {"code": 503}}), audio_response([b"\xff\xfb"]))
    audio, delays = client(recorder)
    assert [c async for c in audio.synthesize(tts_request())] == [b"\xff\xfb"]
    assert len(delays) == 1


async def test_speech_failure_after_audio_is_never_replayed() -> None:
    recorder = Recorder(audio_response([b"\xff\xfbone", b"\xff\xfbtwo"], fail_after=1))
    audio, delays = client(recorder)
    received: list[bytes] = []

    async def consume() -> None:
        async for chunk in audio.synthesize(tts_request()):
            received.append(chunk)

    with pytest.raises(GatewayError) as exc:
        await consume()
    assert received == [b"\xff\xfbone"]
    assert exc.value.partial
    assert len(recorder.requests) == 1
    assert delays == []


async def test_speech_client_error_is_typed_without_echo() -> None:
    upstream = {
        "error": {
            "code": 400,
            "message": "voice said: <text echo>",
            "metadata": {"error_type": "invalid_request"},
        }
    }
    audio, delays = client(Recorder(httpx2.Response(400, json=upstream)))
    with pytest.raises(GatewayError) as exc:
        _ = [c async for c in audio.synthesize(tts_request())]
    assert exc.value.code == "GATEWAY_PROVIDER_ERROR"
    assert not exc.value.retryable
    assert "text echo" not in exc.value.message
    assert delays == []


async def test_empty_audio_is_invalid() -> None:
    audio, _ = client(Recorder(audio_response([])), max_retries=0)
    with pytest.raises(GatewayError) as exc:
        _ = [c async for c in audio.synthesize(tts_request())]
    assert exc.value.code == "GATEWAY_INVALID_RESPONSE"
