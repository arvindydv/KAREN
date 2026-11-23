from __future__ import annotations

import asyncio
import dataclasses
from collections.abc import AsyncGenerator
from pathlib import Path

import anyio
import pytest

from karen_ai.api.app import build_completion_service
from karen_ai.contracts import CompletionRequest, DeltaEvent, DoneEvent, ErrorEvent, StartEvent
from karen_ai.core.errors import KarenAIError
from karen_ai.gateway.base import GatewayRequest, GatewayResult
from karen_ai.gateway.mock import MockGatewayClient, chat_responder
from karen_ai.model_router.service import CompletionService
from karen_ai.observability.invocations import InMemoryInvocationSink
from karen_ai.policies.budget import InMemoryDailyBudgetTracker, Reservation
from tests.conftest import SettingsFactory, completion_body, write_registry


def _service(
    make_settings: SettingsFactory,
    gateway: MockGatewayClient,
    sink: InMemoryInvocationSink,
    **overrides: object,
) -> CompletionService:
    return build_completion_service(make_settings(**overrides), gateway=gateway, sink=sink)


def _request(**overrides: object) -> CompletionRequest:
    return CompletionRequest.model_validate(completion_body(**overrides))


async def test_no_model_path_makes_zero_gateway_calls(make_settings: SettingsFactory) -> None:
    gateway, sink = MockGatewayClient(), InMemoryInvocationSink()
    service = _service(make_settings, gateway, sink)
    response = await service.complete(_request(task_kind="DETERMINISTIC"))
    assert response.route_tier == "NO_MODEL"
    assert response.finish_reason == "no_model"
    assert response.requested_model is None
    assert response.estimated_cost_usd == 0.0
    events = [
        e
        async for e in service.stream_events(
            await service.prepare(_request(task_kind="DETERMINISTIC"), stream=True)
        )
    ]
    assert [e.event for e in events] == ["start", "done"]
    assert gateway.calls == []
    assert sink.records == []


async def test_mock_completion_and_invocation_record(make_settings: SettingsFactory) -> None:
    gateway, sink = MockGatewayClient(), InMemoryInvocationSink()
    service = _service(make_settings, gateway, sink)
    response = await service.complete(_request(task_id="task_123", prompt_version="chat.v0"))
    assert response.is_mock
    assert response.route_tier == "BALANCED"
    assert response.requested_model == response.served_model == "mock/balanced"
    assert response.output_text.startswith("[mock]")
    assert response.usage.input_tokens is not None
    assert response.usage.cached_tokens is None
    assert len(gateway.calls) == 1
    assert gateway.calls[0].max_output_tokens == 1500
    [record] = sink.records
    assert record.status == "succeeded"
    assert record.user_id_hash == "usr_hmac_test01"
    assert record.task_id == "task_123"
    assert record.prompt_version == "chat.v0"
    assert record.final_cost_usd is None
    assert record.is_mock
    dumped = record.model_dump_json()
    assert "yaad dilana" not in dumped  # no prompt content in records


@pytest.mark.parametrize(
    ("task_kind", "disabled"),
    [("CHAT", True), ("EXTRACTION", True), ("COMPARISON", False), ("CODING", False)],
)
async def test_hidden_reasoning_is_off_on_fast_tiers_only(
    make_settings: SettingsFactory, task_kind: str, disabled: bool
) -> None:
    gateway = MockGatewayClient()
    service = _service(make_settings, gateway, InMemoryInvocationSink())
    await service.complete(_request(task_kind=task_kind))
    assert gateway.calls[0].disable_reasoning is disabled


async def test_max_output_tokens_is_clamped(make_settings: SettingsFactory) -> None:
    gateway = MockGatewayClient()
    service = _service(make_settings, gateway, InMemoryInvocationSink(), karen_ai_max_output_tokens=300)
    await service.complete(_request(max_output_tokens=5000))
    assert gateway.calls[0].max_output_tokens == 300


async def test_per_request_budget_rejection(make_settings: SettingsFactory, tmp_path: Path) -> None:
    # USD per 1M tokens, test-only; the CHAT system prompt (~1.4k tokens, chat.v4) counts too.
    registry = write_registry(tmp_path / "priced.json", price=40.0)
    gateway = MockGatewayClient()
    service = _service(make_settings, gateway, InMemoryInvocationSink(), karen_model_registry_path=registry)
    # 1500 output tokens x $40/1M = $0.06, plus the prompt, > $0.10 default per-request cap.
    with pytest.raises(KarenAIError) as exc:
        await service.complete(_request())
    assert exc.value.code == "BUDGET_EXCEEDED"
    # The caller's own cap is honoured too.
    with pytest.raises(KarenAIError):
        await service.complete(_request(max_output_tokens=100, max_cost_usd=0.001))
    assert gateway.calls == []
    ok = await service.complete(_request(max_output_tokens=100))
    assert ok.estimated_cost_usd is not None
    assert ok.estimated_cost_usd > 0


async def test_daily_budget_rejection(make_settings: SettingsFactory, tmp_path: Path) -> None:
    # SUMMARY: same BALANCED tier without the CHAT system prompt, so token estimates stay tiny.
    registry = write_registry(tmp_path / "priced.json", price=100.0)
    tracker = InMemoryDailyBudgetTracker(0.05)
    gateway = MockGatewayClient()
    service = build_completion_service(
        make_settings(karen_model_registry_path=registry),
        gateway=gateway,
        sink=InMemoryInvocationSink(),
        budget=tracker,
    )
    await service.complete(
        _request(task_kind="SUMMARY", max_output_tokens=200)
    )  # worst case ~$0.02, settles at usage cost
    assert 0 < await tracker.spent_today() < 0.01
    await tracker.reserve(0.04)  # concurrent in-flight spend elsewhere in the process
    with pytest.raises(KarenAIError) as exc:
        await service.complete(_request(task_kind="SUMMARY", max_output_tokens=200))
    assert exc.value.code == "BUDGET_EXCEEDED"
    assert len(gateway.calls) == 1


async def test_disabled_tier_is_refused(make_settings: SettingsFactory) -> None:
    gateway = MockGatewayClient()
    service = _service(make_settings, gateway, InMemoryInvocationSink())
    with pytest.raises(KarenAIError) as exc:
        await service.complete(_request(route_tier="VISION"))
    assert exc.value.code == "TIER_DISABLED"
    assert gateway.calls == []


async def test_gateway_failure_is_recorded(make_settings: SettingsFactory) -> None:
    gateway, sink = MockGatewayClient(fail_with="GATEWAY_TIMEOUT"), InMemoryInvocationSink()
    service = _service(make_settings, gateway, sink)
    with pytest.raises(KarenAIError) as exc:
        await service.complete(_request())
    assert exc.value.code == "GATEWAY_TIMEOUT"
    assert sink.records[0].status == "failed"
    assert sink.records[0].error_class == "GATEWAY_TIMEOUT"


async def test_stream_error_after_partial_output_is_terminal(make_settings: SettingsFactory) -> None:
    gateway, sink = (
        MockGatewayClient(fail_with="GATEWAY_PROVIDER_ERROR", fail_after_deltas=2),
        InMemoryInvocationSink(),
    )
    service = _service(make_settings, gateway, sink)
    events = [e async for e in service.stream_events(await service.prepare(_request(), stream=True))]
    assert isinstance(events[0], StartEvent)
    assert [type(e) for e in events[1:3]] == [DeltaEvent, DeltaEvent]
    assert isinstance(events[-1], ErrorEvent)
    assert not any(isinstance(e, DoneEvent) for e in events)
    assert len(gateway.calls) == 1  # no replay
    assert sink.records[0].first_token_at is not None


async def test_client_disconnect_mid_stream_settles_budget_and_records_cancel(
    make_settings: SettingsFactory, tmp_path: Path
) -> None:
    """Failure drill (roadmap F00-02): the caller hangs up after the first delta.

    The reservation must be settled conservatively (never leaked as in-flight, never refunded
    to zero, since the provider may still bill), the invocation recorded as cancelled, and the
    gateway call never replayed.
    """
    registry = write_registry(tmp_path / "priced.json", price=40.0)
    tracker = InMemoryDailyBudgetTracker(1.0)
    gateway, sink = MockGatewayClient(), InMemoryInvocationSink()
    service = build_completion_service(
        make_settings(karen_model_registry_path=registry), gateway=gateway, sink=sink, budget=tracker
    )
    prepared = await service.prepare(_request(max_output_tokens=200), stream=True)
    assert prepared.reservation is not None
    stream = service.stream_events(prepared)
    assert isinstance(stream, AsyncGenerator)
    assert isinstance(await anext(stream), StartEvent)
    assert isinstance(await anext(stream), DeltaEvent)
    await stream.aclose()  # what Starlette does when the HTTP client disconnects

    assert await tracker.spent_today() == pytest.approx(prepared.estimated_cost_usd)
    assert tracker._reserved == {}  # nothing left in flight
    [record] = sink.records
    assert record.status == "cancelled"
    assert record.first_token_at is not None
    assert len(gateway.calls) == 1


class _CostReportingGateway(MockGatewayClient):
    """Mock that also reports a gateway-side cost, as OpenRouter's ``usage.cost`` would."""

    async def complete(self, request: GatewayRequest) -> GatewayResult:
        result = await super().complete(request)
        return dataclasses.replace(result, reported_cost_usd=0.123, served_provider="TestProvider")


async def test_task_route_and_reported_cost_reach_the_invocation_record(
    make_settings: SettingsFactory, tmp_path: Path
) -> None:
    registry = write_registry(
        tmp_path / "r.json", price=1.0, changes={"mock/balanced": {"tiers": ["BALANCED", "REASONING"]}}
    )
    gateway, sink = _CostReportingGateway(), InMemoryInvocationSink()
    service = _service(
        make_settings, gateway, sink, karen_model_registry_path=registry, karen_model_coding="mock/balanced"
    )
    response = await service.complete(_request(task_kind="CODING"))
    assert response.route_tier == "REASONING"
    assert response.requested_model == "mock/balanced"
    assert gateway.calls[0].fallback_models == ("mock/reasoning",)
    [record] = sink.records
    assert record.task_route == "CODING"
    assert record.served_provider == "TestProvider"
    assert record.gateway_reported_cost_usd == pytest.approx(0.123)
    # Budgets and the contract cost stay on registry prices, never the gateway's own figure.
    assert response.estimated_cost_usd != pytest.approx(0.123)
    assert record.estimated_cost_usd == response.estimated_cost_usd


async def test_chat_without_task_route_records_none(make_settings: SettingsFactory) -> None:
    gateway, sink = MockGatewayClient(), InMemoryInvocationSink()
    await _service(make_settings, gateway, sink).complete(_request())
    assert sink.records[0].task_route is None
    assert sink.records[0].gateway_reported_cost_usd is None


class _YieldingTracker(InMemoryDailyBudgetTracker):
    """Settles after a real suspension point, like the Redis tracker's network round trip."""

    async def settle(self, reservation: Reservation, actual_usd: float) -> None:
        await asyncio.sleep(0)
        await super().settle(reservation, actual_usd)


async def test_cancelled_stream_still_settles_budget_and_records(
    make_settings: SettingsFactory, tmp_path: Path
) -> None:
    """Regression: Starlette (ASGI spec < 2.4, as uvicorn reports) cancels the response task's
    anyio cancel scope on client disconnect. Cancellation is level-triggered there, so an
    unshielded ``await`` in the stream's ``finally`` was cancelled too: the reservation leaked
    as in-flight for the day and no invocation record was written."""
    tracker = _YieldingTracker(1.0)
    gateway = MockGatewayClient(responder=chat_responder, scenarios=True)
    sink = InMemoryInvocationSink()
    settings = make_settings(karen_model_registry_path=write_registry(tmp_path / "r.json", price=1.0))
    service = build_completion_service(settings, gateway=gateway, sink=sink, budget=tracker)
    prepared = await service.prepare(
        _request(messages=[{"role": "user", "content": "[[mock:slow]] hello there"}]), stream=True
    )
    first_delta = anyio.Event()

    async def consume() -> None:
        async for event in service.stream_events(prepared):
            if isinstance(event, DeltaEvent):
                first_delta.set()

    async with anyio.create_task_group() as task_group:
        task_group.start_soon(consume)
        await first_delta.wait()
        task_group.cancel_scope.cancel()  # what StreamingResponse does on http.disconnect
    for _ in range(5):  # let shielded clean-up finish
        await asyncio.sleep(0)

    assert prepared.estimated_cost_usd > 0
    assert tracker._reserved == {}
    assert await tracker.spent_today() == pytest.approx(prepared.estimated_cost_usd)
    [record] = sink.records
    assert record.status == "cancelled"
