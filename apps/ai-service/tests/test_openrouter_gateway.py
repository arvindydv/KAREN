"""OpenRouterGatewayClient against a fake OpenAI-compatible endpoint (httpx2.MockTransport).

No network and no real model IDs. This proves our request shaping, retry policy and error
mapping against OpenRouter's documented shapes; it does NOT verify live OpenRouter behaviour.
"""

from __future__ import annotations

import dataclasses
import json
from collections.abc import AsyncIterator, Callable
from typing import Any

import httpx2
import pytest
from pydantic import SecretStr

from karen_ai.contracts import ChatMessage
from karen_ai.gateway.base import GatewayDelta, GatewayError, GatewayRequest, GatewayStreamEnd
from karen_ai.gateway.openrouter import OpenRouterGatewayClient, ProviderPreferences
from tests.conftest import TEST_GATEWAY_KEY

BASE_URL = "https://gateway.test.invalid/api/v1"
MODEL = "test-creator/test-model"
FALLBACK = "test-creator/test-fallback"
Handler = Callable[[httpx2.Request], httpx2.Response]


def completion_json(**overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "id": "gen-1763550000-TESTCOMPLETE",
        "object": "chat.completion",
        "created": 1763550000,
        "model": MODEL,
        "provider": "TestProvider",
        "system_fingerprint": None,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": "Namaste"},
                "finish_reason": "stop",
                "native_finish_reason": "end_turn",
            }
        ],
        "usage": {
            "prompt_tokens": 12,
            "completion_tokens": 3,
            "total_tokens": 15,
            "cost": 0.0000027,
            "is_byok": False,
            "prompt_tokens_details": {"cached_tokens": 8},
            "completion_tokens_details": {"reasoning_tokens": 1},
        },
    }
    body.update(overrides)
    return body


def chunk(
    content: str | None = None,
    finish: str | None = None,
    *,
    usage: dict[str, Any] | None = None,
    generation_id: str = "gen-1763550000-TESTSTREAM",
) -> bytes:
    data: dict[str, Any] = {
        "id": generation_id,
        "object": "chat.completion.chunk",
        "created": 1763550000,
        "model": MODEL,
        "provider": "TestProvider",
        "choices": [{"index": 0, "delta": {"content": content}, "finish_reason": finish}],
    }
    if usage:
        data["usage"] = usage
    return f"data: {json.dumps(data)}\n\n".encode()


def error_chunk(code: int, error_type: str) -> bytes:
    """OpenRouter's mid-stream error: HTTP stays 200, a chunk carries a top-level ``error``."""
    data = {
        "id": "gen-1763550000-TESTSTREAM",
        "object": "chat.completion.chunk",
        "created": 1763550000,
        "model": MODEL,
        "provider": "TestProvider",
        "error": {
            "code": code,
            "message": "upstream said: <prompt echo>",
            "metadata": {"error_type": error_type},
        },
        "choices": [{"index": 0, "delta": {"content": ""}, "finish_reason": "error"}],
    }
    return f"data: {json.dumps(data)}\n\n".encode()


PROCESSING = b": OPENROUTER PROCESSING\n\n"
DONE = b"data: [DONE]\n\n"


class SSEStream(httpx2.AsyncByteStream):
    def __init__(self, frames: list[bytes], *, fail_after: int | None = None) -> None:
        self._frames, self._fail_after = frames, fail_after

    async def __aiter__(self) -> AsyncIterator[bytes]:
        for index, frame in enumerate(self._frames):
            if index == self._fail_after:
                raise httpx2.ReadError("connection reset by test")
            yield frame


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


def make_client(
    recorder: Recorder, *, max_retries: int = 2, provider: ProviderPreferences | None = None
) -> tuple[OpenRouterGatewayClient, list[float]]:
    delays: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        delays.append(seconds)

    client = OpenRouterGatewayClient(
        base_url=BASE_URL,
        api_key=SecretStr(TEST_GATEWAY_KEY),
        timeout_seconds=5,
        max_retries=max_retries,
        provider=provider,
        http_client=httpx2.AsyncClient(transport=httpx2.MockTransport(recorder)),
        sleep=fake_sleep,
    )
    return client, delays


def request(*, fallback: bool = False) -> GatewayRequest:
    return GatewayRequest(
        request_id="req_gateway_test",
        model=MODEL,
        messages=(ChatMessage(role="system", content="Be careful."), ChatMessage(role="user", content="Hi")),
        max_output_tokens=256,
        fallback_models=(FALLBACK,) if fallback else (),
    )


def sse_response(frames: list[bytes], *, fail_after: int | None = None) -> httpx2.Response:
    return httpx2.Response(
        200,
        headers={"content-type": "text/event-stream", "x-generation-id": "gen-header-stream"},
        stream=SSEStream(frames, fail_after=fail_after),
    )


# ------------------------------------------------------------------------- request + response shape


async def test_completion_success_maps_usage_cost_provider_and_request_shape() -> None:
    recorder = Recorder(httpx2.Response(200, json=completion_json()))
    client, _ = make_client(recorder)
    result = await client.complete(request())
    assert result.text == "Namaste"
    assert result.finish_reason == "stop"
    assert result.served_model == MODEL
    assert result.served_provider == "TestProvider"
    assert result.gateway_request_id == "gen-1763550000-TESTCOMPLETE"
    assert result.reported_cost_usd == pytest.approx(0.0000027)
    assert result.attempts == 1
    assert (result.usage.input_tokens, result.usage.output_tokens) == (12, 3)
    assert (result.usage.cached_tokens, result.usage.reasoning_tokens) == (8, 1)
    sent = recorder.requests[0]
    assert str(sent.url) == f"{BASE_URL}/chat/completions"
    assert sent.headers["authorization"] == f"Bearer {TEST_GATEWAY_KEY}"
    body = recorder.body()
    assert body["model"] == MODEL
    assert body["max_tokens"] == 256
    assert [m["role"] for m in body["messages"]] == ["system", "user"]
    assert "models" not in body
    assert "stream_options" not in body  # deprecated upstream; usage is returned by default


async def test_default_provider_policy_denies_data_collection_and_requires_zdr() -> None:
    recorder = Recorder(httpx2.Response(200, json=completion_json()))
    client, _ = make_client(recorder)
    await client.complete(request())
    assert recorder.body()["provider"] == {"data_collection": "deny", "zdr": True}


async def test_provider_policy_is_configurable() -> None:
    recorder = Recorder(httpx2.Response(200, json=completion_json()))
    client, _ = make_client(recorder, provider=ProviderPreferences(data_collection="allow", zdr=False))
    await client.complete(request())
    assert recorder.body()["provider"] == {"data_collection": "allow"}


async def test_reasoning_is_disabled_only_when_requested() -> None:
    recorder = Recorder(httpx2.Response(200, json=completion_json()))
    client, _ = make_client(recorder)
    await client.complete(request())
    assert "reasoning" not in recorder.body()
    await client.complete(dataclasses.replace(request(), disable_reasoning=True))
    assert recorder.body(1)["reasoning"] == {"enabled": False}


async def test_fallback_is_sent_as_models_array_primary_first() -> None:
    recorder = Recorder(httpx2.Response(200, json=completion_json(model=FALLBACK)))
    client, _ = make_client(recorder)
    result = await client.complete(request(fallback=True))
    body = recorder.body()
    assert body["model"] == MODEL
    assert body["models"] == [MODEL, FALLBACK]
    assert result.served_model == FALLBACK  # the response names the model that served/billed


async def test_missing_usage_cost_and_ids_stay_null() -> None:
    body = completion_json(usage=None, id="chatcmpl-without-generation-prefix")
    body.pop("provider")
    client, _ = make_client(Recorder(httpx2.Response(200, json=body)))
    result = await client.complete(request())
    assert result.usage.input_tokens is None
    assert result.usage.cached_tokens is None
    assert result.reported_cost_usd is None
    assert result.served_provider is None
    assert result.gateway_request_id == "chatcmpl-without-generation-prefix"


async def test_generation_id_header_is_used_when_body_id_is_not_a_generation_id() -> None:
    body = completion_json(id="chatcmpl-x")
    response = httpx2.Response(200, json=body, headers={"x-generation-id": "gen-from-header"})
    client, _ = make_client(Recorder(response))
    assert (await client.complete(request())).gateway_request_id == "gen-from-header"


@pytest.mark.parametrize("cost", [-1, "0.01", True])
async def test_non_numeric_or_negative_reported_cost_is_ignored(cost: object) -> None:
    usage = {**completion_json()["usage"], "cost": cost}
    client, _ = make_client(Recorder(httpx2.Response(200, json=completion_json(usage=usage))))
    assert (await client.complete(request())).reported_cost_usd is None


async def test_finish_reason_error_in_completion_is_a_provider_error() -> None:
    choices = [{"index": 0, "message": {"role": "assistant", "content": ""}, "finish_reason": "error"}]
    client, _ = make_client(Recorder(httpx2.Response(200, json=completion_json(choices=choices))))
    with pytest.raises(GatewayError) as exc:
        await client.complete(request())
    assert exc.value.code == "GATEWAY_PROVIDER_ERROR"
    assert not exc.value.retryable


async def test_invalid_body_is_invalid_response() -> None:
    client, _ = make_client(Recorder(httpx2.Response(200, json=completion_json(choices=[]))))
    with pytest.raises(GatewayError) as exc:
        await client.complete(request())
    assert exc.value.code == "GATEWAY_INVALID_RESPONSE"


# ----------------------------------------------------------------------------------- retry policy


async def test_rate_limit_is_retried_with_backoff_then_mapped() -> None:
    recorder = Recorder(httpx2.Response(429, json={"error": {"code": 429, "message": "slow down"}}))
    client, delays = make_client(recorder, max_retries=2)
    with pytest.raises(GatewayError) as exc:
        await client.complete(request())
    assert exc.value.code == "GATEWAY_RATE_LIMITED"
    assert exc.value.retryable
    assert exc.value.attempts == 3
    assert len(recorder.requests) == 3
    assert len(delays) == 2
    assert all(0 < d <= 4.0 for d in delays)


async def test_short_retry_after_is_honoured() -> None:
    recorder = Recorder(
        httpx2.Response(429, json={"error": {"code": 429}}, headers={"retry-after": "2"}),
        httpx2.Response(200, json=completion_json()),
    )
    client, delays = make_client(recorder)
    result = await client.complete(request())
    assert result.attempts == 2
    assert delays == [2.0]


async def test_long_retry_after_is_not_waited_out() -> None:
    recorder = Recorder(httpx2.Response(503, json={"error": {"code": 503}}, headers={"retry-after": "60"}))
    client, delays = make_client(recorder, max_retries=2)
    with pytest.raises(GatewayError) as exc:
        await client.complete(request())
    assert exc.value.retryable  # the caller may retry later with a new request_id
    assert len(recorder.requests) == 1
    assert delays == []


async def test_rate_limit_then_success() -> None:
    recorder = Recorder(httpx2.Response(429, json={}), httpx2.Response(200, json=completion_json()))
    client, _ = make_client(recorder)
    assert (await client.complete(request())).attempts == 2


async def test_timeout_is_mapped() -> None:
    recorder = Recorder(httpx2.ReadTimeout("test timeout"))
    client, _ = make_client(recorder, max_retries=1)
    with pytest.raises(GatewayError) as exc:
        await client.complete(request())
    assert exc.value.code == "GATEWAY_TIMEOUT"
    assert len(recorder.requests) == 2


async def test_http_408_is_a_retryable_timeout() -> None:
    recorder = Recorder(
        httpx2.Response(408, json={"error": {"code": 408}}), httpx2.Response(200, json=completion_json())
    )
    client, _ = make_client(recorder)
    assert (await client.complete(request())).attempts == 2


@pytest.mark.parametrize("status", [502, 503, 524, 529])
async def test_upstream_5xx_with_fallback_is_fallback_exhausted(status: int) -> None:
    upstream = {"error": {"code": status, "message": "upstream said: <prompt echo>"}}
    client, _ = make_client(Recorder(httpx2.Response(status, json=upstream)), max_retries=0)
    with pytest.raises(GatewayError) as exc:
        await client.complete(request(fallback=True))
    assert exc.value.code == "FALLBACK_EXHAUSTED"
    assert exc.value.retryable
    assert "prompt echo" not in exc.value.message


async def test_client_errors_are_not_retried() -> None:
    recorder = Recorder(httpx2.Response(400, json={"error": {"code": 400, "message": "bad"}}))
    client, delays = make_client(recorder)
    with pytest.raises(GatewayError) as exc:
        await client.complete(request())
    assert exc.value.code == "GATEWAY_PROVIDER_ERROR"
    assert not exc.value.retryable
    assert len(recorder.requests) == 1
    assert delays == []


@pytest.mark.parametrize(
    ("status", "error_type", "expected"),
    [
        (401, "authentication", "rejected the service credentials (HTTP 401)"),
        (402, "payment_required", "credit or key limit exhausted (HTTP 402)"),
        (403, "content_policy_violation", "content policy (HTTP 403)"),
        (403, "permission_denied", "permissions, guardrail or budget (HTTP 403)"),
        (404, "not_found", "does not know the configured model or route (HTTP 404)"),
        (400, "context_length_exceeded", "context length exceeded (HTTP 400)"),
    ],
)
async def test_account_policy_and_model_errors_are_typed_and_never_retried(
    status: int, error_type: str, expected: str
) -> None:
    upstream = {
        "error": {
            "code": status,
            "message": f"key {TEST_GATEWAY_KEY} said: <prompt echo>",
            "metadata": {"error_type": error_type, "flagged_input": "<prompt echo>"},
        }
    }
    recorder = Recorder(httpx2.Response(status, json=upstream))
    client, delays = make_client(recorder, max_retries=2)
    with pytest.raises(GatewayError) as exc:
        await client.complete(request())
    assert exc.value.code == "GATEWAY_PROVIDER_ERROR"
    assert expected in exc.value.message
    assert not exc.value.retryable
    assert exc.value.status_code == status
    assert len(recorder.requests) == 1
    assert delays == []
    # Upstream text (which may echo prompts or the key) never reaches our error message.
    assert "prompt echo" not in exc.value.message
    assert TEST_GATEWAY_KEY not in exc.value.message
    assert TEST_GATEWAY_KEY not in repr(exc.value)


# -------------------------------------------------------------------------------------- streaming


async def test_streaming_success_with_keepalive_comments_and_final_usage_frame() -> None:
    usage = {"prompt_tokens": 12, "completion_tokens": 2, "total_tokens": 14, "cost": 0.0000022}
    frames = [
        PROCESSING,
        chunk("Nam"),
        PROCESSING,
        chunk("aste"),
        chunk(None, "stop"),
        chunk("", "stop", usage=usage),
        DONE,
    ]
    recorder = Recorder(sse_response(frames))
    client, _ = make_client(recorder)
    items = [item async for item in client.stream(request())]
    assert [i.text for i in items if isinstance(i, GatewayDelta)] == ["Nam", "aste"]
    end = items[-1]
    assert isinstance(end, GatewayStreamEnd)
    assert end.finish_reason == "stop"
    assert end.usage.output_tokens == 2
    assert end.reported_cost_usd == pytest.approx(0.0000022)
    assert end.served_provider == "TestProvider"
    assert end.gateway_request_id == "gen-1763550000-TESTSTREAM"
    body = recorder.body()
    assert body["stream"] is True
    assert "stream_options" not in body
    assert body["provider"] == {"data_collection": "deny", "zdr": True}


async def test_stream_failure_after_delta_is_never_replayed() -> None:
    frames = [chunk("Nam"), chunk("aste"), chunk(None, "stop"), DONE]
    recorder = Recorder(sse_response(frames, fail_after=1))
    client, delays = make_client(recorder, max_retries=2)
    received: list[str] = []

    async def consume() -> None:
        async for item in client.stream(request()):
            if isinstance(item, GatewayDelta):
                received.append(item.text)

    with pytest.raises(GatewayError) as exc:
        await consume()
    assert received == ["Nam"]
    assert exc.value.partial
    assert len(recorder.requests) == 1
    assert delays == []


async def test_mid_stream_error_chunk_after_delta_is_partial_and_not_replayed() -> None:
    recorder = Recorder(sse_response([chunk("Nam"), error_chunk(502, "provider_unavailable"), DONE]))
    client, delays = make_client(recorder)
    received: list[str] = []

    async def consume() -> None:
        async for item in client.stream(request()):
            if isinstance(item, GatewayDelta):
                received.append(item.text)

    with pytest.raises(GatewayError) as exc:
        await consume()
    assert received == ["Nam"]
    assert exc.value.partial
    assert exc.value.status_code == 502
    assert "prompt echo" not in exc.value.message
    assert len(recorder.requests) == 1
    assert delays == []


async def test_error_chunk_before_any_delta_is_retried_when_transient() -> None:
    recorder = Recorder(
        sse_response([error_chunk(503, "provider_overloaded"), DONE]),
        sse_response([chunk("ok"), chunk(None, "stop"), DONE]),
    )
    client, delays = make_client(recorder)
    items = [item async for item in client.stream(request())]
    assert isinstance(items[-1], GatewayStreamEnd)
    assert items[-1].attempts == 2
    assert len(delays) == 1


async def test_error_chunk_before_any_delta_that_is_not_transient_is_not_retried() -> None:
    recorder = Recorder(sse_response([error_chunk(400, "invalid_request"), DONE]))
    client, delays = make_client(recorder)
    with pytest.raises(GatewayError) as exc:
        _ = [item async for item in client.stream(request())]
    assert exc.value.code == "GATEWAY_PROVIDER_ERROR"
    assert not exc.value.retryable
    assert not exc.value.partial
    assert delays == []


async def test_stream_failure_before_first_delta_is_retried() -> None:
    frames = [chunk("ok"), chunk(None, "stop"), DONE]
    recorder = Recorder(httpx2.Response(503, json={}), sse_response(frames))
    client, delays = make_client(recorder)
    items = [item async for item in client.stream(request())]
    assert isinstance(items[-1], GatewayStreamEnd)
    assert items[-1].attempts == 2
    assert len(delays) == 1


async def test_stream_without_finish_reason_is_invalid() -> None:
    client, _ = make_client(Recorder(sse_response([chunk("partial"), DONE])))
    with pytest.raises(GatewayError) as exc:
        _ = [item async for item in client.stream(request())]
    assert exc.value.code == "GATEWAY_INVALID_RESPONSE"
    assert exc.value.partial


async def test_stream_without_usage_keeps_usage_unknown() -> None:
    client, _ = make_client(Recorder(sse_response([chunk("ok"), chunk(None, "stop"), DONE])))
    end = [item async for item in client.stream(request())][-1]
    assert isinstance(end, GatewayStreamEnd)
    assert end.usage.output_tokens is None
    assert end.reported_cost_usd is None


async def test_stream_402_before_first_delta_is_not_retried() -> None:
    recorder = Recorder(httpx2.Response(402, json={"error": {"code": 402}}))
    client, delays = make_client(recorder)
    with pytest.raises(GatewayError) as exc:
        _ = [item async for item in client.stream(request())]
    assert exc.value.status_code == 402
    assert not exc.value.partial
    assert len(recorder.requests) == 1
    assert delays == []
