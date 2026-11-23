"""Voice endpoints end to end in mock mode, plus the speech service's budget and interruption rules.

Mock providers only (no network). The key property: a transcribed voice command is routed by the
same task router as typed text.
"""

from __future__ import annotations

import base64
import io
import wave
from collections.abc import AsyncIterator, Callable
from typing import Any

import httpx2
import pytest
from fastapi import FastAPI

from karen_ai.api.app import create_app, speech_routing
from karen_ai.contracts import (
    CONTRACT_VERSION,
    SPEECH_RESPONSE_HEADERS,
    CompletionResponse,
    SpeechRequest,
    TranscriptionResponse,
)
from karen_ai.core.errors import KarenAIError
from karen_ai.gateway.base import GatewayError
from karen_ai.observability.invocations import InMemoryInvocationSink
from karen_ai.policies.budget import InMemoryDailyBudgetTracker
from karen_ai.speech.base import SynthesisInput
from karen_ai.speech.mock import MOCK_TRANSCRIPT_EN, MockSpeechToText, MockTextToSpeech
from karen_ai.speech.service import SpeechLimits, SpeechService
from tests.conftest import SettingsFactory, completion_body

ClientFor = Callable[[FastAPI], httpx2.AsyncClient]
TRANSCRIBE = "/internal/v1/audio/transcriptions"
SPEECH = "/internal/v1/audio/speech"
COMPLETIONS = "/internal/v1/completions"


def transcription_body(
    audio: bytes = b"\x1aE\xdf\xa3 not a real recording", **overrides: Any
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "contract_version": CONTRACT_VERSION,
        "request_id": "req_voice_0001",
        "user_ref": "usr_hmac_test01",
        "audio_base64": base64.b64encode(audio).decode(),
        "audio_format": "webm",
    }
    body.update(overrides)
    return body


def speech_body(
    text: str = "Kal subah 7 baje yaad dila doongi, theek hai?", **overrides: Any
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "contract_version": CONTRACT_VERSION,
        "request_id": "req_speech_0001",
        "user_ref": "usr_hmac_test01",
        "text": text,
        "voice": {"accent": "american", "gender": "any", "speed": 1.0},
    }
    body.update(overrides)
    return body


@pytest.fixture
def voice_app(make_settings: SettingsFactory) -> FastAPI:
    return create_app(make_settings(karen_feature_voice_enabled=True))


# ------------------------------------------------------------------------------- feature flag


async def test_voice_is_disabled_by_default(app: FastAPI, client_for: ClientFor) -> None:
    client = client_for(app)
    for path, body in ((TRANSCRIBE, transcription_body()), (SPEECH, speech_body())):
        response = await client.post(path, json=body)
        assert response.status_code == 503
        assert response.json()["error"]["code"] == "TIER_DISABLED"


async def test_readiness_reports_voice_state(voice_app: FastAPI, client_for: ClientFor) -> None:
    body = (await client_for(voice_app).get("/health/ready")).json()
    assert body["voice_enabled"] is True
    assert body["voice_catalog_version"].endswith(".mock")


# ------------------------------------------------------------------------------- transcription


async def test_mock_transcription_is_labelled(voice_app: FastAPI, client_for: ClientFor) -> None:
    response = await client_for(voice_app).post(TRANSCRIBE, json=transcription_body())
    assert response.status_code == 200
    body = TranscriptionResponse.model_validate_json(response.text)
    assert body.is_mock
    assert body.text == MOCK_TRANSCRIPT_EN
    assert body.language == "en"


async def test_transcribed_voice_command_goes_through_the_same_task_router(
    voice_app: FastAPI, client_for: ClientFor
) -> None:
    client = client_for(voice_app)
    spoken = "Mujhe Pune mein flat lena chahiye ya rent pe rehna chahiye? Pros aur cons batao."
    transcript = TranscriptionResponse.model_validate_json(
        (await client.post(TRANSCRIBE, json=transcription_body(b"MOCK:" + spoken.encode()))).text
    )
    assert transcript.text == spoken
    assert transcript.language == "hi-Latn"
    # The caller sends the transcript exactly like typed text; the router decides the model.
    for task_kind, tier in (("CHAT", "BALANCED"), ("DECISION_SUPPORT", "REASONING")):
        response = await client.post(
            COMPLETIONS,
            json=completion_body(
                request_id=f"req_voice_{task_kind.lower()}",
                task_kind=task_kind,
                messages=[{"role": "user", "content": transcript.text}],
            ),
        )
        assert response.status_code == 200
        assert CompletionResponse.model_validate_json(response.text).route_tier == tier


async def test_devanagari_transcript_is_detected_as_hindi(voice_app: FastAPI, client_for: ClientFor) -> None:
    audio = b"MOCK:" + "कल सुबह सात बजे याद दिलाना।".encode()
    response = await client_for(voice_app).post(TRANSCRIBE, json=transcription_body(audio))
    assert TranscriptionResponse.model_validate_json(response.text).language == "hi"


@pytest.mark.parametrize(
    ("body", "code"),
    [
        (transcription_body(audio_format="exe"), "VALIDATION_ERROR"),
        (transcription_body(duration_ms=120_000), "VALIDATION_ERROR"),
        (transcription_body(audio_base64="not base64!!"), "VALIDATION_ERROR"),
        (transcription_body(max_cost_usd=0.000_001), "BUDGET_EXCEEDED"),
    ],
)
async def test_transcription_refusals(
    voice_app: FastAPI, client_for: ClientFor, body: dict[str, Any], code: str
) -> None:
    response = await client_for(voice_app).post(TRANSCRIBE, json=body)
    assert response.json()["error"]["code"] == code
    assert "not base64" not in response.text  # validation errors never echo values


# ------------------------------------------------------------------------------------- speech


async def test_speech_streams_audio_with_voice_headers(voice_app: FastAPI, client_for: ClientFor) -> None:
    response = await client_for(voice_app).post(SPEECH, json=speech_body())
    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/wav"
    headers = SPEECH_RESPONSE_HEADERS
    # Hinglish text: Indian voice even though the saved accent is American.
    assert response.headers[headers["language"]] == "hi-Latn"
    assert response.headers[headers["voiceId"]] == "mock-en-IN-female"
    assert response.headers[headers["isMock"]] == "true"
    assert response.headers[headers["textTruncated"]] == "false"
    assert float(response.headers[headers["estimatedCostUsd"]]) > 0
    with wave.open(io.BytesIO(response.content)) as wav:
        assert wav.getnframes() > 0


@pytest.mark.parametrize(
    ("text", "accent", "voice"),
    [
        ("Your cab is booked for 7 am.", "british", "mock-en-GB"),
        ("Your cab is booked for 7 am.", "american", "mock-en-US"),
        ("आपकी कैब सुबह सात बजे बुक है।", "american", "mock-hi-IN-female"),
    ],
)
async def test_voice_follows_language_and_accent(
    voice_app: FastAPI, client_for: ClientFor, text: str, accent: str, voice: str
) -> None:
    body = speech_body(text, voice={"accent": accent, "gender": "any", "speed": 1.0})
    response = await client_for(voice_app).post(SPEECH, json=body)
    assert response.headers[SPEECH_RESPONSE_HEADERS["voiceId"]] == voice


async def test_speech_refusals_happen_before_audio(voice_app: FastAPI, client_for: ClientFor) -> None:
    client = client_for(voice_app)
    too_expensive = await client.post(SPEECH, json=speech_body(max_cost_usd=0.000_001))
    assert too_expensive.status_code == 403
    assert too_expensive.json()["error"]["code"] == "BUDGET_EXCEEDED"
    only_markdown = await client.post(SPEECH, json=speech_body("** ``` **"))
    assert only_markdown.json()["error"]["code"] == "VALIDATION_ERROR"


# ------------------------------------------------------------------------- service-level rules


class _CountingTTS(MockTextToSpeech):
    """Concatenable stand-in for a real (billed, unpriced) provider; records each sentence."""

    @property
    def is_mock(self) -> bool:
        return False

    @property
    def concatenable(self) -> bool:
        return True

    async def synthesize(self, request: SynthesisInput) -> AsyncIterator[bytes]:
        self.calls.append(request)
        yield request.text.encode()


class _FailingTTS(_CountingTTS):
    async def synthesize(self, request: SynthesisInput) -> AsyncIterator[bytes]:
        self.calls.append(request)
        if len(self.calls) == 2:
            raise GatewayError("GATEWAY_PROVIDER_ERROR", "Gateway upstream error (HTTP 502).", retryable=True)
        yield request.text.encode()


def _service(
    make_settings: SettingsFactory, tts: MockTextToSpeech, budget: InMemoryDailyBudgetTracker
) -> SpeechService:
    settings = make_settings(karen_feature_voice_enabled=True)
    return SpeechService(
        stt=MockSpeechToText(),
        tts=tts,
        catalog=settings.voice_catalog,
        routing=speech_routing(settings),
        budget=budget,
        sink=InMemoryInvocationSink(),
        limits=SpeechLimits(
            stt_reserve_usd=0.01, tts_reserve_usd=0.02, max_request_cost_usd=0.1, max_speech_chars=2000
        ),
    )


async def test_speech_is_synthesised_sentence_by_sentence(make_settings: SettingsFactory) -> None:
    tts, budget = _CountingTTS(), InMemoryDailyBudgetTracker(1.0)
    service = _service(make_settings, tts, budget)
    prepared = await service.prepare_speech(
        SpeechRequest.model_validate(speech_body("Pehla. Doosra. Teesra."))
    )
    audio = b"".join([chunk async for chunk in service.stream_speech(prepared)])
    assert [c.text for c in tts.calls] == ["Pehla.", "Doosra.", "Teesra."]
    assert audio == b"Pehla.Doosra.Teesra."
    assert await budget.spent_today() == pytest.approx(0.02)


async def test_interruption_stops_synthesis_and_still_settles_the_budget(
    make_settings: SettingsFactory,
) -> None:
    tts, budget = _CountingTTS(), InMemoryDailyBudgetTracker(1.0)
    service = _service(make_settings, tts, budget)
    prepared = await service.prepare_speech(SpeechRequest.model_validate(speech_body("Ek. Do. Teen. Chaar.")))
    stream = service.stream_speech(prepared)
    first = await anext(stream)
    await stream.aclose()  # the user interrupted playback / closed the connection
    assert first == b"Ek."
    assert len(tts.calls) == 1  # later sentences were never synthesised (never billed)
    assert await budget.spent_today() == pytest.approx(0.02)


async def test_mid_stream_tts_failure_ends_the_stream_without_replay(make_settings: SettingsFactory) -> None:
    tts, budget = _FailingTTS(), InMemoryDailyBudgetTracker(1.0)
    service = _service(make_settings, tts, budget)
    prepared = await service.prepare_speech(SpeechRequest.model_validate(speech_body("Ek. Do. Teen.")))
    chunks = [chunk async for chunk in service.stream_speech(prepared)]
    assert chunks == [b"Ek."]
    assert len(tts.calls) == 2
    assert await budget.spent_today() == pytest.approx(0.02)


async def test_daily_budget_refuses_before_any_provider_call(make_settings: SettingsFactory) -> None:
    tts, budget = _CountingTTS(), InMemoryDailyBudgetTracker(0.015)
    service = _service(make_settings, tts, budget)
    with pytest.raises(KarenAIError) as exc:
        await service.prepare_speech(SpeechRequest.model_validate(speech_body()))
    assert exc.value.code == "BUDGET_EXCEEDED"
    assert tts.calls == []


async def test_long_text_is_truncated_at_a_sentence_and_flagged(make_settings: SettingsFactory) -> None:
    service = _service(make_settings, _CountingTTS(), InMemoryDailyBudgetTracker(1.0))
    service._limits = SpeechLimits(0.01, 0.02, 0.1, max_speech_chars=100)
    text = "Yeh pehla vaakya hai. " * 20
    prepared = await service.prepare_speech(SpeechRequest.model_validate(speech_body(text)))
    assert prepared.truncated
    assert len(prepared.text) <= 100
    assert prepared.text.endswith(".")


async def test_speech_records_are_metadata_only(make_settings: SettingsFactory) -> None:
    sink = InMemoryInvocationSink()
    settings = make_settings(karen_feature_voice_enabled=True)
    app = create_app(settings, sink=sink)
    async with httpx2.AsyncClient(transport=httpx2.ASGITransport(app=app), base_url="http://t") as client:
        await client.post(TRANSCRIBE, json=transcription_body(b"MOCK:private voice note about my bank"))
        await client.post(SPEECH, json=speech_body("Your balance is low."))
    assert [r.route_tier for r in sink.records] == ["AUDIO", "AUDIO"]
    dumped = " ".join(r.model_dump_json() for r in sink.records)
    assert "bank" not in dumped
    assert "balance" not in dumped
