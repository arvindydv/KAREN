from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path

import httpx2
import pytest
from fastapi import FastAPI
from pydantic import TypeAdapter

from karen_ai.api.app import create_app
from karen_ai.contracts import (
    STREAM_EVENT_ADAPTER,
    AiErrorCode,
    AiErrorEnvelope,
    CompletionResponse,
    StreamEvent,
)
from karen_ai.gateway.mock import MockGatewayClient
from tests.conftest import CONTRACT_FIXTURES, SettingsFactory, completion_body, write_registry

ClientFor = Callable[[FastAPI], httpx2.AsyncClient]
COMPLETIONS = "/internal/v1/completions"
STREAM = "/internal/v1/completions/stream"


def parse_sse(raw: str) -> list[StreamEvent]:
    """Parse ``event: <name>\\ndata: <json>\\n\\n`` frames and validate each against the contract."""
    events: list[StreamEvent] = []
    for frame in raw.split("\n\n"):
        if not frame.strip():
            continue
        lines = dict(line.split(": ", 1) for line in frame.split("\n"))
        assert set(lines) == {"event", "data"}
        event = STREAM_EVENT_ADAPTER.validate_json(lines["data"])
        assert event.event == lines["event"]
        events.append(event)
    return events


async def test_completion_returns_contract_response(app: FastAPI, client_for: ClientFor) -> None:
    response = await client_for(app).post(COMPLETIONS, json=completion_body())
    assert response.status_code == 200
    body = CompletionResponse.model_validate_json(response.text)
    assert body.is_mock
    assert body.route_tier == "BALANCED"


async def test_shared_valid_fixture_is_served(app: FastAPI, client_for: ClientFor) -> None:
    payload = (CONTRACT_FIXTURES / "completion-request.valid.json").read_bytes()
    response = await client_for(app).post(COMPLETIONS, content=payload)
    assert response.status_code == 200
    assert response.json()["request_id"] == "req_01JD3Q8Z6M4T1"


async def test_extra_field_is_rejected_with_envelope(app: FastAPI, client_for: ClientFor) -> None:
    payload = (CONTRACT_FIXTURES / "completion-request.invalid-extra-field.json").read_bytes()
    response = await client_for(app).post(COMPLETIONS, content=payload)
    assert response.status_code == 422
    envelope = AiErrorEnvelope.model_validate_json(response.text)
    assert envelope.error.code == "VALIDATION_ERROR"
    assert envelope.error.request_id == "req_01JD3Q8Z6M4T1"
    assert "invented-model" not in response.text  # never echo request content


async def test_malformed_json_is_validation_error(app: FastAPI, client_for: ClientFor) -> None:
    response = await client_for(app).post(COMPLETIONS, content=b"{not json")
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


async def test_tier_disabled_is_503(app: FastAPI, client_for: ClientFor) -> None:
    response = await client_for(app).post(COMPLETIONS, json=completion_body(route_tier="AUDIO"))
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "TIER_DISABLED"


async def test_budget_exceeded_is_403(
    make_settings: SettingsFactory, client_for: ClientFor, tmp_path: Path
) -> None:
    app = create_app(
        make_settings(karen_model_registry_path=write_registry(tmp_path / "p.json", price=100.0))
    )
    response = await client_for(app).post(COMPLETIONS, json=completion_body())
    assert response.status_code == 403
    envelope = AiErrorEnvelope.model_validate_json(response.text)
    assert envelope.error.code == "BUDGET_EXCEEDED"
    assert not envelope.error.retryable


@pytest.mark.parametrize(
    ("code", "status"),
    [
        ("GATEWAY_TIMEOUT", 504),
        ("GATEWAY_RATE_LIMITED", 429),
        ("GATEWAY_PROVIDER_ERROR", 502),
        ("GATEWAY_INVALID_RESPONSE", 502),
        ("FALLBACK_EXHAUSTED", 502),
    ],
)
async def test_gateway_errors_map_to_http_status(
    make_settings: SettingsFactory, client_for: ClientFor, code: AiErrorCode, status: int
) -> None:
    app = create_app(make_settings(), gateway=MockGatewayClient(fail_with=code))
    response = await client_for(app).post(COMPLETIONS, json=completion_body())
    assert response.status_code == status
    assert response.json()["error"]["code"] == code


async def test_stream_emits_valid_sse_events(app: FastAPI, client_for: ClientFor) -> None:
    response = await client_for(app).post(STREAM, json=completion_body())
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    events = parse_sse(response.text)
    assert events[0].event == "start"
    assert events[0].is_mock
    assert {e.event for e in events[1:-1]} == {"delta"}
    assert [e.index for e in events[1:-1] if e.event == "delta"] == list(range(len(events) - 2))
    assert events[-1].event == "done"
    text = "".join(e.text for e in events if e.event == "delta")
    assert "[mock]" in text
    assert events[-1].requested_model == "mock/balanced"


async def test_stream_partial_failure_ends_with_single_error(
    make_settings: SettingsFactory, client_for: ClientFor
) -> None:
    gateway = MockGatewayClient(fail_with="GATEWAY_TIMEOUT", fail_after_deltas=1)
    app = create_app(make_settings(), gateway=gateway)
    events = parse_sse((await client_for(app).post(STREAM, json=completion_body())).text)
    assert [e.event for e in events] == ["start", "delta", "error"]
    assert len(gateway.calls) == 1


async def test_stream_refusal_before_start_is_json_envelope(app: FastAPI, client_for: ClientFor) -> None:
    response = await client_for(app).post(STREAM, json=completion_body(route_tier="VISION"))
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "TIER_DISABLED"


async def test_no_model_stream(app: FastAPI, client_for: ClientFor) -> None:
    events = parse_sse(
        (await client_for(app).post(STREAM, json=completion_body(task_kind="DETERMINISTIC"))).text
    )
    assert [e.event for e in events] == ["start", "done"]


def test_stream_fixture_matches_parser() -> None:
    fixture = json.loads((CONTRACT_FIXTURES / "stream-events.mock.json").read_text())
    framed = "".join(f"event: {e['event']}\ndata: {json.dumps(e)}\n\n" for e in fixture)
    assert len(parse_sse(framed)) == len(fixture)
    TypeAdapter(list[StreamEvent]).validate_python(fixture)
