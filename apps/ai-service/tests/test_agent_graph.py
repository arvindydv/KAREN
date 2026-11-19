from __future__ import annotations

import datetime as dt

from karen_ai.agents.conversation import build_conversation_graph, is_deterministic_date_question
from karen_ai.api.app import build_completion_service
from karen_ai.gateway.base import GatewayRequest
from karen_ai.gateway.mock import MockGatewayClient
from karen_ai.observability.invocations import InMemoryInvocationSink
from tests.conftest import SettingsFactory


def scripted(request: GatewayRequest) -> str:
    return (
        "reminder"
        if request.model == "mock/economy"
        else "[mock] Theek hai, reminder set karne ka proposal ready hai."
    )


async def test_graph_classifies_then_responds_via_router(make_settings: SettingsFactory) -> None:
    gateway = MockGatewayClient(responder=scripted)
    service = build_completion_service(make_settings(), gateway=gateway, sink=InMemoryInvocationSink())
    graph = build_conversation_graph(service)
    state = await graph.ainvoke(
        {
            "request_id": "req_graph_0001",
            "user_ref": "usr_hmac_graph",
            "user_message": "Kal 5 baje yaad dilana",
        }
    )
    assert state["intent"] == "reminder"
    assert state["route_tiers"] == ["ECONOMY", "BALANCED"]
    assert state["reply"].startswith("[mock]")
    assert state["is_mock"] is True
    assert [c.model for c in gateway.calls] == ["mock/economy", "mock/balanced"]


async def test_unknown_classifier_output_is_not_trusted(make_settings: SettingsFactory) -> None:
    service = build_completion_service(
        make_settings(), gateway=MockGatewayClient(), sink=InMemoryInvocationSink()
    )
    state = await build_conversation_graph(service).ainvoke(
        {"request_id": "req_graph_0002", "user_ref": "usr_hmac_graph", "user_message": "hello"}
    )
    assert state["intent"] == "unknown"


async def test_date_question_uses_no_model(make_settings: SettingsFactory) -> None:
    gateway = MockGatewayClient()
    service = build_completion_service(make_settings(), gateway=gateway, sink=InMemoryInvocationSink())
    fixed = dt.datetime(2026, 11, 19, 20, 0, tzinfo=dt.UTC)
    state = await build_conversation_graph(service, clock=lambda: fixed).ainvoke(
        {"request_id": "req_graph_0003", "user_ref": "usr_hmac_graph", "user_message": "Aaj kya date hai?"}
    )
    assert state["route_tiers"] == ["NO_MODEL"]
    assert state["reply"] == "Today is Friday, 20 November 2026 (IST)."
    assert gateway.calls == []


def test_date_question_detector() -> None:
    assert is_deterministic_date_question("What is the date today?")
    assert is_deterministic_date_question("aaj kaun si tarikh hai")
    assert not is_deterministic_date_question("Book a table for today")
