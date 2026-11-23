"""Live-mode configuration wired end to end, with only the HTTP transport faked.

The app runs with ``KAREN_AI_GATEWAY_MODE=live``, the committed live registry and the real
``OpenRouterGatewayClient``; an ``httpx2.MockTransport`` stands in for OpenRouter. No paid call is
ever made (``conftest._no_external_network`` blocks real hosts). Live behaviour itself is verified
only by the manual SP-1 probe (``karen-ai-probe``).

Model IDs are read from the committed registry file (its "Suggested env" notes), never hardcoded.
"""

from __future__ import annotations

import json
import logging
import re
from collections.abc import AsyncIterator, Callable
from pathlib import Path
from typing import Any

import httpx2
import pytest
from fastapi import FastAPI
from pydantic import SecretStr, ValidationError

from karen_ai.api.app import build_gateway, create_app, provider_preferences
from karen_ai.contracts import CompletionResponse, DoneEvent, ErrorEvent, ModelCapability, StartEvent
from karen_ai.core.settings import SERVICE_ROOT, Settings
from karen_ai.gateway.openrouter import OpenRouterGatewayClient
from karen_ai.model_router.profiles import TASK_PROFILES
from karen_ai.model_router.registry import ModelRegistry, load_registry
from karen_ai.model_router.router import RouteRequirements, worst_case_for
from karen_ai.model_router.service import REASONING_OFF_TIERS
from karen_ai.policies.budget import InMemoryDailyBudgetTracker
from tests.conftest import TEST_GATEWAY_KEY, SettingsFactory, completion_body
from tests.test_api_completions import COMPLETIONS, STREAM, parse_sse

LIVE_REGISTRY_PATH = SERVICE_ROOT / "config" / "model-registry.live.json"
ClientFor = Callable[[FastAPI], httpx2.AsyncClient]
Handler = Callable[[httpx2.Request], httpx2.Response]


# ------------------------------------------------------------------------------ helpers


def live_registry() -> ModelRegistry:
    return load_registry(LIVE_REGISTRY_PATH)


def suggested_env(registry: ModelRegistry) -> dict[str, str]:
    """``KAREN_MODEL_*`` -> slug, from the "Suggested env: ..." notes the probe writes."""
    result: dict[str, str] = {}
    for model in registry.models:
        match = re.search(r"Suggested env: ([A-Z_, ]+)", model.notes or "")
        for name in match.group(1).split(", ") if match else ():
            assert name not in result, f"{name} suggested twice"
            result[name] = model.model_id
    return result


def verified_copy(tmp_path: Path) -> Path:
    """The committed live registry with every entry marked verified (simulates a passed SP-1)."""
    data = json.loads(LIVE_REGISTRY_PATH.read_text())
    for model in data["models"]:
        model["verified_at"] = "2026-11-21"
    path = tmp_path / "model-registry.live.verified.json"
    path.write_text(json.dumps(data))
    return path


TEXT_ENV = (
    "KAREN_MODEL_ECONOMY",
    "KAREN_MODEL_ECONOMY_FALLBACK",
    "KAREN_MODEL_BALANCED",
    "KAREN_MODEL_BALANCED_FALLBACK",
    "KAREN_MODEL_REASONING",
    "KAREN_MODEL_REASONING_FALLBACK",
    "KAREN_MODEL_CODING",
    "KAREN_MODEL_DOCUMENT_ANALYSIS",
)


def live_settings(make_settings: SettingsFactory, registry_path: Path, **overrides: Any) -> Settings:
    env = suggested_env(load_registry(registry_path))
    values: dict[str, Any] = {
        "karen_ai_gateway_mode": "live",
        "openrouter_api_key": SecretStr(TEST_GATEWAY_KEY),
        "karen_model_registry_path": registry_path,
        "karen_ai_max_retries": 2,
        **{name.lower(): env.get(name) for name in TEXT_ENV},
    }
    values.update(overrides)
    return make_settings(**values)


class FakeGateway:
    """Records requests; replies from a queue (the last reply repeats)."""

    def __init__(self, *replies: httpx2.Response | Exception | Handler) -> None:
        self._replies = list(replies)
        self.requests: list[httpx2.Request] = []

    def __call__(self, request: httpx2.Request) -> httpx2.Response:
        self.requests.append(request)
        reply = self._replies.pop(0) if len(self._replies) > 1 else self._replies[0]
        if isinstance(reply, Exception):
            raise reply
        return reply(request) if callable(reply) else reply

    def body(self, index: int = 0) -> dict[str, Any]:
        result: dict[str, Any] = json.loads(self.requests[index].content)
        return result


class _Frames(httpx2.AsyncByteStream):
    def __init__(self, frames: list[bytes], fail_after: int | None) -> None:
        self._frames, self._fail_after = frames, fail_after

    async def __aiter__(self) -> AsyncIterator[bytes]:
        for index, frame in enumerate(self._frames):
            if index == self._fail_after:
                raise httpx2.ReadError("connection reset by test")
            yield frame


def sse(
    model: str, parts: list[str], *, fail_after: int | None = None, usage: bool = True
) -> httpx2.Response:
    def frame(data: dict[str, Any]) -> bytes:
        base = {"id": "gen-01LIVETEST", "object": "chat.completion.chunk", "created": 1, "model": model}
        return f"data: {json.dumps({**base, **data})}\n\n".encode()

    frames = [
        frame({"choices": [{"index": 0, "delta": {"content": p}, "finish_reason": None}]}) for p in parts
    ]
    frames.append(frame({"choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]}))
    if usage:
        frames.append(frame({"choices": [], "usage": {"prompt_tokens": 40, "completion_tokens": 3}}))
    frames.append(b"data: [DONE]\n\n")
    return httpx2.Response(
        200, headers={"content-type": "text/event-stream"}, stream=_Frames(frames, fail_after)
    )


def completion(model: str) -> httpx2.Response:
    return httpx2.Response(
        200,
        json={
            "id": "gen-01LIVECOMPLETE",
            "object": "chat.completion",
            "created": 1,
            "model": model,
            "choices": [
                {"index": 0, "message": {"role": "assistant", "content": "Namaste!"}, "finish_reason": "stop"}
            ],
            "usage": {"prompt_tokens": 40, "completion_tokens": 3, "total_tokens": 43},
        },
    )


def live_app(settings: Settings, fake: FakeGateway, *, daily_budget: float | None = None) -> FastAPI:
    gateway = OpenRouterGatewayClient(
        base_url=settings.openrouter_base_url,
        api_key=settings.openrouter_api_key or SecretStr(""),
        timeout_seconds=settings.karen_ai_request_timeout_seconds,
        max_retries=settings.karen_ai_max_retries,
        provider=provider_preferences(settings),
        http_client=httpx2.AsyncClient(transport=httpx2.MockTransport(fake)),
        sleep=_no_sleep,
    )
    budget = InMemoryDailyBudgetTracker(daily_budget or settings.karen_ai_daily_budget_usd)
    return create_app(settings, gateway=gateway, budget=budget)


async def _no_sleep(_: float) -> None:
    return None


# ------------------------------------------------------------------- committed configuration


def test_committed_live_registry_is_valid_and_priced() -> None:
    registry = live_registry()
    env = suggested_env(registry)
    assert {"KAREN_MODEL_ECONOMY", "KAREN_MODEL_BALANCED", "KAREN_MODEL_REASONING"} <= set(env)
    # Every workload has a model: chat/reasoning/extraction tiers, coding, documents, vision.
    assert {"KAREN_MODEL_CODING", "KAREN_MODEL_VISION"} <= set(env)
    vision = registry.get(env["KAREN_MODEL_VISION"])
    assert vision is not None
    assert vision.supports_vision
    for entry in registry.models:
        assert not entry.model_id.startswith("mock/")
        assert entry.input_usd_per_million_tokens > 0
        assert entry.output_usd_per_million_tokens > 0
        assert entry.supports_streaming
        assert entry.notes  # provenance + verification status are recorded


def test_mandatory_reasoning_models_are_never_on_tiers_that_disable_reasoning() -> None:
    # Fast tiers send reasoning={"enabled": false}; OpenRouter answers 400 for models whose
    # reasoning is mandatory (observed live 2026-11-22), so such a model there would always fail.
    for entry in live_registry().models:
        if "reasoning=mandatory" in (entry.notes or ""):
            assert not set(entry.tiers) & REASONING_OFF_TIERS, entry.model_id


def test_unverified_registry_keeps_live_mode_fail_closed(make_settings: SettingsFactory) -> None:
    if all(m.verified_at for m in live_registry().models):
        pytest.skip("committed registry is verified; refusal is covered by test_settings")
    with pytest.raises(ValidationError, match="verified_at=null"):
        live_settings(make_settings, LIVE_REGISTRY_PATH)


def test_live_mode_without_key_refuses_to_start(make_settings: SettingsFactory, tmp_path: Path) -> None:
    with pytest.raises(ValidationError, match="OPENROUTER_API_KEY is required"):
        live_settings(make_settings, verified_copy(tmp_path), openrouter_api_key=None)


def test_live_configuration_builds_real_client_without_leaking_key(
    make_settings: SettingsFactory, tmp_path: Path
) -> None:
    settings = live_settings(make_settings, verified_copy(tmp_path))
    assert settings.openrouter_base_url == "https://openrouter.ai/api/v1"
    gateway = build_gateway(settings)
    assert isinstance(gateway, OpenRouterGatewayClient)
    assert not gateway.is_mock
    assert TEST_GATEWAY_KEY not in repr(settings)
    assert TEST_GATEWAY_KEY not in str(settings.model_dump())


def test_live_worst_case_fits_api_reservation(make_settings: SettingsFactory, tmp_path: Path) -> None:
    """The API reserves CHAT_REQUEST_RESERVE_USD (default 0.10) and sends it as max_cost_usd.

    A full-context BALANCED chat at the service output cap must fit, or every chat is refused.
    """
    settings = live_settings(make_settings, verified_copy(tmp_path))
    registry = settings.registry
    balanced = [m for m in registry.models if "BALANCED" in m.tiers]
    worst_input_tokens = 24_000 // 2  # CHAT_CONTEXT_MAX_CHARS with a pessimistic 2 chars/token
    worst = max(
        (
            worst_input_tokens * m.input_usd_per_million_tokens
            + settings.karen_ai_max_output_tokens * m.output_usd_per_million_tokens
        )
        / 1_000_000
        for m in balanced
    )
    assert worst < min(0.10, settings.karen_ai_max_request_cost_usd)


# ------------------------------------------------------------------- end to end (fake transport)


async def test_live_stream_end_to_end(
    make_settings: SettingsFactory, tmp_path: Path, client_for: ClientFor, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    settings = live_settings(make_settings, verified_copy(tmp_path))
    balanced = settings.karen_model_balanced or ""
    fake = FakeGateway(sse(balanced, ["Nam", "aste"]))
    response = await client_for(live_app(settings, fake)).post(
        STREAM, json=completion_body(messages=[{"role": "user", "content": "Mera plan banao"}])
    )
    assert response.status_code == 200
    events = parse_sse(response.text)
    start, done = events[0], events[-1]
    assert isinstance(start, StartEvent)
    assert not start.is_mock
    assert isinstance(done, DoneEvent)
    assert done.gateway_request_id == "gen-01LIVETEST"
    assert done.served_model == balanced
    assert done.usage.output_tokens == 3
    assert done.estimated_cost_usd is not None
    assert done.estimated_cost_usd > 0
    # Request shape actually sent to the gateway.
    sent = fake.requests[0]
    assert str(sent.url) == "https://openrouter.ai/api/v1/chat/completions"
    assert sent.headers["authorization"] == f"Bearer {TEST_GATEWAY_KEY}"
    body = fake.body()
    assert body["model"] == balanced
    assert body["stream"] is True
    assert body["max_tokens"] <= settings.karen_ai_max_output_tokens
    assert body["provider"] == {"data_collection": "deny", "zdr": True}
    if settings.karen_model_balanced_fallback:
        assert body["models"] == [balanced, settings.karen_model_balanced_fallback]
    # The key and the prompt never appear in our responses or logs.
    assert TEST_GATEWAY_KEY not in response.text
    assert TEST_GATEWAY_KEY not in caplog.text
    assert "Mera plan banao" not in caplog.text


async def test_live_completion_end_to_end(
    make_settings: SettingsFactory, tmp_path: Path, client_for: ClientFor
) -> None:
    settings = live_settings(make_settings, verified_copy(tmp_path))
    fake = FakeGateway(completion(settings.karen_model_balanced or ""))
    response = await client_for(live_app(settings, fake)).post(COMPLETIONS, json=completion_body())
    assert response.status_code == 200
    body = CompletionResponse.model_validate_json(response.text)
    assert not body.is_mock
    assert body.gateway_request_id == "gen-01LIVECOMPLETE"
    assert body.output_text == "Namaste!"


async def test_live_rate_limit_is_retried_then_streams(
    make_settings: SettingsFactory, tmp_path: Path, client_for: ClientFor
) -> None:
    settings = live_settings(make_settings, verified_copy(tmp_path))
    fake = FakeGateway(
        httpx2.Response(429, json={"error": {"code": 429}}),
        sse(settings.karen_model_balanced or "", ["ok"]),
    )
    response = await client_for(live_app(settings, fake)).post(STREAM, json=completion_body())
    events = parse_sse(response.text)
    assert isinstance(events[-1], DoneEvent)
    assert len(fake.requests) == 2


@pytest.mark.parametrize(
    "case",
    [
        (
            httpx2.Response(401, json={"error": {"code": 401, "metadata": {"error_type": "authentication"}}}),
            "GATEWAY_PROVIDER_ERROR",
            False,
            1,
        ),
        (
            httpx2.Response(
                402, json={"error": {"code": 402, "metadata": {"error_type": "payment_required"}}}
            ),
            "GATEWAY_PROVIDER_ERROR",
            False,
            1,
        ),
        (
            httpx2.Response(
                403, json={"error": {"code": 403, "metadata": {"error_type": "content_policy_violation"}}}
            ),
            "GATEWAY_PROVIDER_ERROR",
            False,
            1,
        ),
        (httpx2.ReadTimeout("slow upstream"), "GATEWAY_TIMEOUT", True, 3),
        (httpx2.Response(503, json={}), "FALLBACK_EXHAUSTED", True, 3),
    ],
)
async def test_live_failures_end_stream_with_one_typed_error(
    make_settings: SettingsFactory,
    tmp_path: Path,
    client_for: ClientFor,
    case: tuple[httpx2.Response | Exception, str, bool, int],
) -> None:
    reply, code, retryable, calls = case
    settings = live_settings(make_settings, verified_copy(tmp_path))
    fake = FakeGateway(reply)
    response = await client_for(live_app(settings, fake)).post(STREAM, json=completion_body())
    events = parse_sse(response.text)
    errors = [e for e in events if isinstance(e, ErrorEvent)]
    assert len(errors) == 1
    assert events[-1] is errors[0]
    assert errors[0].code == code
    assert errors[0].retryable is retryable
    assert len(fake.requests) == calls  # 4xx never retried; retries bounded by KAREN_AI_MAX_RETRIES
    assert TEST_GATEWAY_KEY not in response.text


async def test_live_mid_stream_drop_is_never_replayed(
    make_settings: SettingsFactory, tmp_path: Path, client_for: ClientFor
) -> None:
    settings = live_settings(make_settings, verified_copy(tmp_path))
    fake = FakeGateway(sse(settings.karen_model_balanced or "", ["Nam", "aste"], fail_after=1))
    response = await client_for(live_app(settings, fake)).post(STREAM, json=completion_body())
    events = parse_sse(response.text)
    assert [e.event for e in events] == ["start", "delta", "error"]
    assert len(fake.requests) == 1  # no replay after a delta reached the caller


async def test_live_budget_refusal_happens_before_any_gateway_call(
    make_settings: SettingsFactory, tmp_path: Path, client_for: ClientFor
) -> None:
    settings = live_settings(make_settings, verified_copy(tmp_path))
    fake = FakeGateway(sse(settings.karen_model_balanced or "", ["never"]))
    app = live_app(settings, fake)
    tiny_cap = completion_body(max_cost_usd=0.000_000_1)
    response = await client_for(app).post(STREAM, json=tiny_cap)
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "BUDGET_EXCEEDED"
    assert fake.requests == []


async def test_live_missing_stream_usage_is_priced_conservatively(
    make_settings: SettingsFactory, tmp_path: Path, client_for: ClientFor
) -> None:
    """If an upstream stream ever ends without usage, the reserved worst case is charged."""
    settings = live_settings(make_settings, verified_copy(tmp_path))
    fake = FakeGateway(sse(settings.karen_model_balanced or "", ["ok"], usage=False))
    response = await client_for(live_app(settings, fake)).post(STREAM, json=completion_body())
    done = parse_sse(response.text)[-1]
    assert isinstance(done, DoneEvent)
    assert done.usage.output_tokens is None
    assert done.estimated_cost_usd is not None
    assert done.estimated_cost_usd > 0


async def test_tests_cannot_reach_the_real_gateway() -> None:
    async with httpx2.AsyncClient() as client:
        with pytest.raises(httpx2.ConnectError, match="blocked in tests"):
            await client.get("https://openrouter.ai/api/v1/models")


# ------------------------------------------------------------------- task-based routing (live config)


@pytest.mark.parametrize(
    "case",
    [
        ("CHAT", "KAREN_MODEL_BALANCED", "BALANCED"),
        ("EXTRACTION", "KAREN_MODEL_ECONOMY", "ECONOMY"),
        ("COMPLEX_PLANNING", "KAREN_MODEL_REASONING", "REASONING"),
        ("CODING", "KAREN_MODEL_CODING", "REASONING"),
    ],
)
async def test_live_task_kind_routes_to_its_model(
    make_settings: SettingsFactory, tmp_path: Path, client_for: ClientFor, case: tuple[str, str, str]
) -> None:
    task_kind, env_name, tier = case
    settings = live_settings(make_settings, verified_copy(tmp_path))
    expected = getattr(settings, env_name.lower())
    fake = FakeGateway(completion(expected))
    response = await client_for(live_app(settings, fake)).post(
        COMPLETIONS, json=completion_body(task_kind=task_kind)
    )
    assert response.status_code == 200
    body = CompletionResponse.model_validate_json(response.text)
    assert body.route_tier == tier
    assert body.requested_model == expected
    sent = fake.body()
    assert sent["model"] == expected
    if task_kind == "CODING":
        # The specialist degrades to the general tier model (then the tier fallback).
        tier_model = getattr(settings, f"karen_model_{tier.lower()}")
        assert sent["models"][:2] == [expected, tier_model]


async def test_live_served_fallback_model_is_priced_at_its_own_registry_price(
    make_settings: SettingsFactory, tmp_path: Path, client_for: ClientFor
) -> None:
    settings = live_settings(make_settings, verified_copy(tmp_path))
    fallback = settings.karen_model_balanced_fallback
    assert fallback is not None
    fake = FakeGateway(completion(fallback))
    response = await client_for(live_app(settings, fake)).post(COMPLETIONS, json=completion_body())
    body = CompletionResponse.model_validate_json(response.text)
    entry = settings.registry.get(fallback)
    assert entry is not None
    expected = (40 * entry.input_usd_per_million_tokens + 3 * entry.output_usd_per_million_tokens) / 1_000_000
    assert body.served_model == fallback
    assert body.estimated_cost_usd == pytest.approx(expected)


# ------------------------------------------------------------- automatic least-cost selection


AUTO_CASES = [
    ("CHAT", "BALANCED"),
    ("EXTRACTION", "ECONOMY"),
    ("DOCUMENT_ANALYSIS", "BALANCED"),
    ("COMPLEX_PLANNING", "REASONING"),
    ("DECISION_SUPPORT", "REASONING"),
    ("RESEARCH", "REASONING"),
    ("CODING", "REASONING"),
]


def _unpinned(make_settings: SettingsFactory, tmp_path: Path) -> Settings:
    return live_settings(make_settings, verified_copy(tmp_path), **{name.lower(): None for name in TEXT_ENV})


@pytest.mark.parametrize("case", AUTO_CASES)
async def test_live_auto_routing_picks_the_cheapest_qualified_model(
    make_settings: SettingsFactory, tmp_path: Path, client_for: ClientFor, case: tuple[str, str]
) -> None:
    """Property check against the committed registry: no model IDs are hardcoded here."""
    task_kind, tier = case
    settings = _unpinned(make_settings, tmp_path)
    fake = FakeGateway(lambda request: completion(json.loads(request.content)["model"]))
    response = await client_for(live_app(settings, fake)).post(
        COMPLETIONS, json=completion_body(task_kind=task_kind)
    )
    assert response.status_code == 200, response.text
    body = CompletionResponse.model_validate_json(response.text)
    assert body.route_tier == tier
    chosen = settings.registry.get(body.requested_model or "")
    assert chosen is not None
    profile = TASK_PROFILES[task_kind]  # type: ignore[index]
    sent = fake.body()
    req = RouteRequirements(stream=False, input_tokens=1, max_output_tokens=sent["max_tokens"])

    def qualified(m: ModelCapability) -> bool:
        return (
            tier in m.tiers
            and (profile.min_quality_index is None or (m.quality_index or -1) >= profile.min_quality_index)
            and (
                profile.max_latency_p50_ms is None
                or m.latency_p50_ms is None
                or m.latency_p50_ms <= profile.max_latency_p50_ms
            )
            and (not profile.needs_json_schema or m.supports_json_schema)
        )

    assert qualified(chosen)
    cheapest = min(worst_case_for(m, req) for m in settings.registry.models if qualified(m))
    assert worst_case_for(chosen, req) == pytest.approx(cheapest)
    # Fallbacks (if any) are other qualified models, sent primary first.
    assert sent.get("models", [chosen.model_id])[0] == chosen.model_id
    for fallback in sent.get("models", [])[1:]:
        entry = settings.registry.get(fallback)
        assert entry is not None
        assert qualified(entry)


async def test_live_image_understanding_routes_to_a_vision_model_with_content_parts(
    make_settings: SettingsFactory, tmp_path: Path, client_for: ClientFor
) -> None:
    settings = live_settings(
        make_settings,
        verified_copy(tmp_path),
        karen_feature_vision_enabled=True,
        **{name.lower(): None for name in TEXT_ENV},
    )
    fake = FakeGateway(lambda request: completion(json.loads(request.content)["model"]))
    image = {"url": "data:image/png;base64,iVBORw0KGgo=", "detail": "low"}
    payload = completion_body(
        task_kind="IMAGE_UNDERSTANDING",
        messages=[{"role": "user", "content": "Is bill mein total kitna hai?", "images": [image]}],
    )
    response = await client_for(live_app(settings, fake)).post(COMPLETIONS, json=payload)
    assert response.status_code == 200, response.text
    body = CompletionResponse.model_validate_json(response.text)
    assert body.route_tier == "VISION"
    chosen = settings.registry.get(body.requested_model or "")
    assert chosen is not None
    assert chosen.supports_vision
    user = fake.body()["messages"][-1]
    assert user["content"] == [
        {"type": "text", "text": "Is bill mein total kitna hai?"},
        {"type": "image_url", "image_url": {"url": image["url"], "detail": "low"}},
    ]


async def test_live_auto_routing_respects_the_request_budget(
    make_settings: SettingsFactory, tmp_path: Path, client_for: ClientFor
) -> None:
    """A tiny caller cap leaves no qualified reasoning model: refused before any gateway call."""
    settings = _unpinned(make_settings, tmp_path)
    fake = FakeGateway(lambda request: completion(json.loads(request.content)["model"]))
    response = await client_for(live_app(settings, fake)).post(
        COMPLETIONS, json=completion_body(task_kind="RESEARCH", max_cost_usd=0.000_001)
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "BUDGET_EXCEEDED"
    assert fake.requests == []
