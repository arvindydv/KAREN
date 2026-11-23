"""Phase 02 chat behaviour: system prompt, deterministic fast path, mock scenarios, done metadata."""

from __future__ import annotations

import datetime as dt

import pytest

from karen_ai.agents.fast_path import deterministic_reply
from karen_ai.api.app import build_completion_service
from karen_ai.contracts import ChatMessage, CompletionRequest, DeltaEvent, DoneEvent, ErrorEvent, StreamEvent
from karen_ai.gateway.base import GatewayRequest
from karen_ai.gateway.mock import MockGatewayClient, chat_responder, parse_scenario
from karen_ai.model_router.service import CompletionService
from karen_ai.observability.invocations import InMemoryInvocationSink
from karen_ai.prompts.catalog import CHAT_PROMPT_VERSION
from tests.conftest import SettingsFactory, completion_body

NOW = dt.datetime(2026, 11, 21, 4, 30, tzinfo=dt.UTC)  # 10:00 IST


def _request(**overrides: object) -> CompletionRequest:
    return CompletionRequest.model_validate(completion_body(**overrides))


def _service(make_settings: SettingsFactory, gateway: MockGatewayClient) -> CompletionService:
    service = build_completion_service(make_settings(), gateway=gateway, sink=InMemoryInvocationSink())
    service._clock = lambda: NOW
    return service


async def _events(service: CompletionService, request: CompletionRequest) -> list[StreamEvent]:
    return [e async for e in service.stream_events(await service.prepare(request, stream=True))]


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("What's the date today?", "Today is Saturday, 21 November 2026 (Asia/Kolkata)."),
        ("aaj kya date hai", "Today is Saturday, 21 November 2026 (Asia/Kolkata)."),
        ("आज कौन सी तारीख है?", "आज 21/11/2026 है (Asia/Kolkata)।"),
        ("what time is it", "It's 10:00 AM on Saturday, 21 November 2026 (Asia/Kolkata)."),
        ("अभी कितने बजे हैं", "अभी 10:00 बजे हैं (Asia/Kolkata)।"),
    ],
)
def test_deterministic_reply_matches_exact_questions(text: str, expected: str) -> None:
    assert deterministic_reply(text, timezone="Asia/Kolkata", now=NOW) == expected


@pytest.mark.parametrize(
    "text",
    [
        "What date should I book the flight?",
        "remind me what time is it in London tomorrow",
        "aaj kya khana banau",
    ],
)
def test_deterministic_reply_leaves_other_questions_to_the_model(text: str) -> None:
    assert deterministic_reply(text, timezone="Asia/Kolkata", now=NOW) is None


def test_unknown_timezone_falls_back_to_ist() -> None:
    assert deterministic_reply("what is the date", timezone="Mars/Olympus", now=NOW) == (
        "Today is Saturday, 21 November 2026 (Asia/Kolkata)."
    )


async def test_chat_date_question_never_reaches_the_gateway(make_settings: SettingsFactory) -> None:
    gateway = MockGatewayClient()
    service = _service(make_settings, gateway)
    events = await _events(
        service,
        _request(messages=[{"role": "user", "content": "aaj ki date kya hai?"}], timezone="Asia/Kolkata"),
    )
    assert gateway.calls == []
    assert [e.event for e in events] == ["start", "delta", "done"]
    assert isinstance(events[1], DeltaEvent)
    assert events[1].text.startswith("Today is Saturday")
    done = events[-1]
    assert isinstance(done, DoneEvent)
    assert done.finish_reason == "no_model"
    assert done.estimated_cost_usd == 0.0


async def test_chat_gets_catalogued_system_prompt_with_locale_and_date(
    make_settings: SettingsFactory,
) -> None:
    gateway = MockGatewayClient()
    service = _service(make_settings, gateway)
    events = await _events(service, _request(locale="hi-IN", timezone="Asia/Kolkata"))
    sent = gateway.calls[0].messages
    assert sent[0].role == "system"
    assert "hi-IN" in sent[0].content
    assert "Saturday, 21 November 2026" in sent[0].content
    assert [m.role for m in sent[1:]] == ["user"]
    done = events[-1]
    assert isinstance(done, DoneEvent)
    assert done.prompt_version == CHAT_PROMPT_VERSION
    assert done.requested_model == "mock/balanced"
    assert done.served_model == "mock/balanced"


async def test_caller_supplied_system_prompt_is_kept(make_settings: SettingsFactory) -> None:
    gateway = MockGatewayClient()
    service = _service(make_settings, gateway)
    await _events(
        service,
        _request(messages=[{"role": "system", "content": "custom"}, {"role": "user", "content": "hello"}]),
    )
    assert [m.content for m in gateway.calls[0].messages if m.role == "system"] == ["custom"]


def _gw_request(text: str) -> GatewayRequest:
    return GatewayRequest(
        request_id="req_x_0001",
        model="mock/balanced",
        messages=(ChatMessage(role="user", content=text),),
        max_output_tokens=100,
    )


def test_scenario_directives_are_parsed() -> None:
    assert parse_scenario(_gw_request("hi [[mock:slow]]").messages).delay_seconds > 0
    scenario = parse_scenario(_gw_request("hi [[mock:fail_after=2]]").messages)
    assert (scenario.fail_with, scenario.fail_after_deltas) == ("GATEWAY_PROVIDER_ERROR", 2)
    assert parse_scenario(_gw_request("[[mock:fail=GATEWAY_RATE_LIMITED]]").messages).fail_with == (
        "GATEWAY_RATE_LIMITED"
    )
    assert parse_scenario(_gw_request("[[mock:fail=NOT_A_CODE]]").messages).fail_with is None


def test_chat_responder_is_labelled_and_strips_directives() -> None:
    text = chat_responder(_gw_request("Namaste [[mock:slow]]"))
    assert "[mock]" in text
    assert "no AI model was called" in text
    assert "[[mock" not in text
    assert "Namaste" in text


async def test_scenarios_are_ignored_unless_enabled(make_settings: SettingsFactory) -> None:
    gateway = MockGatewayClient()  # scenarios=False: directive text is just text
    service = _service(make_settings, gateway)
    events = await _events(
        service, _request(messages=[{"role": "user", "content": "x [[mock:fail=GATEWAY_TIMEOUT]]"}])
    )
    assert events[-1].event == "done"


async def test_scenario_interrupted_stream_ends_with_one_error(make_settings: SettingsFactory) -> None:
    gateway = MockGatewayClient(responder=chat_responder, scenarios=True)
    service = _service(make_settings, gateway)
    events = await _events(
        service, _request(messages=[{"role": "user", "content": "x [[mock:fail_after=2]]"}])
    )
    assert [e.event for e in events] == ["start", "delta", "delta", "error"]
    error = events[-1]
    assert isinstance(error, ErrorEvent)
    assert error.code == "GATEWAY_PROVIDER_ERROR"
    assert len(gateway.calls) == 1  # never replayed


async def test_flaky_scenario_fails_once_then_succeeds(make_settings: SettingsFactory) -> None:
    gateway = MockGatewayClient(responder=chat_responder, scenarios=True)
    service = _service(make_settings, gateway)
    body = {"messages": [{"role": "user", "content": "x [[mock:flaky_after=1]]"}]}
    first = await _events(service, _request(**body))
    second = await _events(service, _request(request_id="req_test_0002", **body))
    assert first[-1].event == "error"
    assert second[-1].event == "done"
