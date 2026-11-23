"""Live voice sessions (ADR-0027): streamed audio -> partial/final transcripts, ownership, spend.

Mock transcriber + in-process bus: no network. A chunk ``MOCK:<text>`` is spoken as one turn.
"""

from __future__ import annotations

import base64
import json
from collections.abc import AsyncIterator, Callable
from typing import Any

import httpx2
import pytest
from fastapi import FastAPI

from karen_ai.api.app import create_app
from karen_ai.contracts import CONTRACT_VERSION, LiveSessionStartRequest
from karen_ai.core.errors import KarenAIError
from karen_ai.core.settings import SERVICE_ROOT
from karen_ai.observability.invocations import InMemoryInvocationSink
from karen_ai.policies.budget import InMemoryDailyBudgetTracker
from karen_ai.speech.base import LiveConfig, LiveTranscriptEvent
from karen_ai.speech.catalog import load_catalog
from karen_ai.speech.live import InMemoryLiveSessionBus, LiveSessionService, language_hints
from karen_ai.speech.mock import MockLiveTranscriber, MockSpeechToText, MockTextToSpeech
from karen_ai.speech.service import SpeechLimits, SpeechRouting, SpeechService
from tests.conftest import SettingsFactory

ClientFor = Callable[[FastAPI], httpx2.AsyncClient]
BASE = "/internal/v1/audio/live-sessions"
OWNER, OTHER = "usr_hmac_owner01", "usr_hmac_other01"


def start_body(**overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "contract_version": CONTRACT_VERSION,
        "request_id": "req_live_0001",
        "user_ref": OWNER,
        "audio_format": "webm",
    }
    body.update(overrides)
    return body


def chunk_body(seq: int, audio: bytes, user_ref: str = OWNER) -> dict[str, Any]:
    return {
        "contract_version": CONTRACT_VERSION,
        "user_ref": user_ref,
        "seq": seq,
        "audio_base64": base64.b64encode(audio).decode(),
    }


def close_body(user_ref: str = OWNER) -> dict[str, Any]:
    return {"contract_version": CONTRACT_VERSION, "user_ref": user_ref}


def parse_sse(raw: str) -> list[dict[str, Any]]:
    events = []
    for block in raw.split("\n\n"):
        data = [line[6:] for line in block.splitlines() if line.startswith("data: ")]
        if data:
            events.append(json.loads(data[0]))
    return events


@pytest.fixture
def transcriber() -> MockLiveTranscriber:
    return MockLiveTranscriber()


@pytest.fixture
def live_app(make_settings: SettingsFactory, transcriber: MockLiveTranscriber) -> FastAPI:
    settings = make_settings(karen_feature_voice_enabled=True, karen_feature_voice_live_enabled=True)
    return create_app(
        settings,
        speech_providers=(MockSpeechToText(), MockTextToSpeech()),
        live_transcriber=transcriber,
        live_bus=InMemoryLiveSessionBus(),
    )


async def _events(client: httpx2.AsyncClient, session_id: str, user_ref: str = OWNER) -> list[dict[str, Any]]:
    response = await client.get(f"{BASE}/{session_id}/events", params={"user_ref": user_ref})
    assert response.status_code == 200, response.text
    return parse_sse(response.text)


async def test_live_disabled_by_default(make_settings: SettingsFactory, client_for: ClientFor) -> None:
    app = create_app(make_settings(karen_feature_voice_enabled=True))
    response = await client_for(app).post(BASE, json=start_body())
    assert response.json()["error"]["code"] == "TIER_DISABLED"


async def test_hinglish_turn_streams_partials_then_final_then_usage(
    live_app: FastAPI, client_for: ClientFor, transcriber: MockLiveTranscriber
) -> None:
    client = client_for(live_app)
    started = (await client.post(BASE, json=start_body())).json()
    sid = started["session_id"]
    assert started["is_mock"]
    assert started["max_seconds"] > 0
    assert transcriber.configs[0].language_hints == ("en", "hi")
    text = "Hey Karen, mujhe kal ke meetings ka summary batao."
    for seq, audio in enumerate([b"\x1aE\xdf\xa3 header", f"MOCK:{text}".encode()]):
        assert (await client.post(f"{BASE}/{sid}/audio", json=chunk_body(seq, audio))).status_code == 204
    assert (await client.post(f"{BASE}/{sid}/close", json=close_body())).status_code == 202
    events = await _events(client, sid)
    kinds = [e["type"] for e in events]
    assert kinds[0] == "ready"
    assert kinds[1] == "speech_started"
    assert kinds.count("partial") == len(text.split())
    final = next(e for e in events if e["type"] == "end_of_turn")
    assert final["text"] == text
    assert final["language"] == "hi-Latn"
    closed = events[-1]
    assert closed["type"] == "closed"
    usage = closed["usage"]
    assert usage["reason"] == "client_closed"
    assert usage["status"] == "succeeded"
    assert usage["is_mock"]
    assert usage["estimated_cost_usd"] == 0.0
    assert usage["audio_seconds"] > 0


async def test_language_preference_narrows_provider_hints() -> None:
    assert language_hints("hi") == ("hi",)
    assert language_hints("en") == ("en",)
    assert language_hints("hi-Latn") == ("en", "hi")


async def test_duplicate_and_out_of_order_chunks_are_dropped(
    live_app: FastAPI, client_for: ClientFor, transcriber: MockLiveTranscriber
) -> None:
    client = client_for(live_app)
    sid = (await client.post(BASE, json=start_body())).json()["session_id"]
    for seq, audio in [(0, b"a"), (1, b"b"), (1, b"b"), (0, b"a"), (2, b"c")]:
        await client.post(f"{BASE}/{sid}/audio", json=chunk_body(seq, audio))
    await client.post(f"{BASE}/{sid}/close", json=close_body())
    await _events(client, sid)
    assert transcriber.streams[0].received == [b"a", b"b", b"c"]


async def test_another_user_cannot_touch_the_session(live_app: FastAPI, client_for: ClientFor) -> None:
    client = client_for(live_app)
    sid = (await client.post(BASE, json=start_body())).json()["session_id"]
    for response in (
        await client.post(f"{BASE}/{sid}/audio", json=chunk_body(0, b"x", user_ref=OTHER)),
        await client.post(f"{BASE}/{sid}/close", json=close_body(OTHER)),
        await client.get(f"{BASE}/{sid}/events", params={"user_ref": OTHER}),
        await client.post(f"{BASE}/lv_{'a' * 32}/audio", json=chunk_body(0, b"x")),
    ):
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "NOT_FOUND"
    await client.post(f"{BASE}/{sid}/close", json=close_body())


async def test_oversized_chunk_is_refused(live_app: FastAPI, client_for: ClientFor) -> None:
    client = client_for(live_app)
    sid = (await client.post(BASE, json=start_body())).json()["session_id"]
    response = await client.post(f"{BASE}/{sid}/audio", json=chunk_body(0, b"x" * 40_000))
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    await client.post(f"{BASE}/{sid}/close", json=close_body())


async def test_provider_error_closes_the_session(live_app: FastAPI, client_for: ClientFor) -> None:
    client = client_for(live_app)
    sid = (await client.post(BASE, json=start_body())).json()["session_id"]
    await client.post(f"{BASE}/{sid}/audio", json=chunk_body(0, b"MOCK-ERROR"))
    events = await _events(client, sid)
    assert any(e["type"] == "error" and e["retryable"] for e in events)
    assert events[-1]["usage"]["reason"] == "provider_error"
    assert events[-1]["usage"]["status"] == "failed"


# ------------------------------------------------------------------ service-level spend rules


class _BilledTranscriber(MockLiveTranscriber):
    """A non-mock stand-in reporting provider audio seconds, as Deepgram Flux does."""

    @property
    def is_mock(self) -> bool:
        return False

    async def connect(self, config: LiveConfig) -> Any:
        stream = await super().connect(config)
        stream._queue.put_nowait(LiveTranscriptEvent(kind="partial", text="x", audio_seconds=30.0))
        return stream


def _priced_service(budget: InMemoryDailyBudgetTracker, sink: InMemoryInvocationSink) -> LiveSessionService:
    catalog = load_catalog(SERVICE_ROOT / "config" / "voice-catalog.deepgram.json")
    live_models = catalog.usable_stt(require_verified=False, provider="deepgram", mode="live")
    speech = SpeechService(
        stt=MockSpeechToText(),
        tts=MockTextToSpeech(),
        catalog=catalog,
        routing=SpeechRouting(
            stt_provider="deepgram", tts_provider="mock", batch_models=(), voices=(), live_models=live_models
        ),
        budget=budget,
        sink=sink,
        limits=SpeechLimits(0.01, 0.02, max_request_cost_usd=0.1, max_speech_chars=2000),
    )
    return LiveSessionService(
        transcriber=_BilledTranscriber(),
        speech=speech,
        bus=InMemoryLiveSessionBus(),
        models=live_models,
        max_seconds=300,
        idle_seconds=1,
    )


async def _drain(service: LiveSessionService, sid: str) -> list[dict[str, Any]]:
    stream: AsyncIterator[Any] = await service.events(sid, OWNER, None)
    return [item[1] async for item in stream if item is not None]


async def test_reserves_worst_case_then_settles_to_provider_audio_seconds() -> None:
    budget, sink = InMemoryDailyBudgetTracker(1.0), InMemoryInvocationSink()
    service = _priced_service(budget, sink)
    started = await service.start(LiveSessionStartRequest.model_validate(start_body()))
    # 300 s at the catalog's per-minute live price is reserved up front.
    price = load_catalog(SERVICE_ROOT / "config" / "voice-catalog.deepgram.json").stt_model(
        started.served_model
    )
    assert price is not None
    assert price.price is not None
    assert started.reserved_cost_usd == pytest.approx(5 * price.price.usd)
    events = await _drain(service, started.session_id)  # idle timeout closes it (1 s)
    usage = events[-1]["usage"]
    assert usage["reason"] == "idle_timeout"
    assert usage["audio_seconds"] == pytest.approx(30.0)
    assert usage["estimated_cost_usd"] == pytest.approx(0.5 * price.price.usd)
    assert await budget.spent_today() == pytest.approx(0.5 * price.price.usd)
    record = sink.records[-1]
    assert record.route_tier == "AUDIO"
    assert record.served_provider == "deepgram"
    assert record.audio_seconds == pytest.approx(30.0)
    assert not record.is_mock


async def test_budget_refusal_happens_before_the_provider_is_contacted() -> None:
    service = _priced_service(InMemoryDailyBudgetTracker(0.0001), InMemoryInvocationSink())
    with pytest.raises(KarenAIError) as exc:
        await service.start(LiveSessionStartRequest.model_validate(start_body()))
    assert exc.value.code == "BUDGET_EXCEEDED"
    assert isinstance(service.transcriber, MockLiveTranscriber)
    assert service.transcriber.configs == []
