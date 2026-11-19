from __future__ import annotations

from pathlib import Path

import pytest

from karen_ai.api.app import build_completion_service
from karen_ai.contracts import CompletionRequest, DeltaEvent, DoneEvent, ErrorEvent, StartEvent
from karen_ai.core.errors import KarenAIError
from karen_ai.gateway.mock import MockGatewayClient
from karen_ai.model_router.service import CompletionService
from karen_ai.observability.invocations import InMemoryInvocationSink
from karen_ai.policies.budget import InMemoryDailyBudgetTracker
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


async def test_max_output_tokens_is_clamped(make_settings: SettingsFactory) -> None:
    gateway = MockGatewayClient()
    service = _service(make_settings, gateway, InMemoryInvocationSink(), karen_ai_max_output_tokens=300)
    await service.complete(_request(max_output_tokens=5000))
    assert gateway.calls[0].max_output_tokens == 300


async def test_per_request_budget_rejection(make_settings: SettingsFactory, tmp_path: Path) -> None:
    registry = write_registry(tmp_path / "priced.json", price=100.0)  # USD per 1M tokens, test-only
    gateway = MockGatewayClient()
    service = _service(make_settings, gateway, InMemoryInvocationSink(), karen_model_registry_path=registry)
    # 1500 output tokens x $100/1M = $0.15 > $0.10 default per-request cap.
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
    registry = write_registry(tmp_path / "priced.json", price=100.0)
    tracker = InMemoryDailyBudgetTracker(0.05)
    gateway = MockGatewayClient()
    service = build_completion_service(
        make_settings(karen_model_registry_path=registry),
        gateway=gateway,
        sink=InMemoryInvocationSink(),
        budget=tracker,
    )
    await service.complete(_request(max_output_tokens=200))  # worst case ~$0.02, settles at usage cost
    assert 0 < await tracker.spent_today() < 0.01
    await tracker.reserve(0.04)  # concurrent in-flight spend elsewhere in the process
    with pytest.raises(KarenAIError) as exc:
        await service.complete(_request(max_output_tokens=200))
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
