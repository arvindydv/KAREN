"""VercelGatewayClient against a fake OpenAI-compatible endpoint (httpx2.MockTransport).

No network and no real model IDs. This proves our request shaping, retry policy and error
mapping; it does NOT verify live Vercel AI Gateway behaviour.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator, Callable
from typing import Any

import httpx2
import pytest
from pydantic import SecretStr

from karen_ai.contracts import ChatMessage
from karen_ai.gateway.base import GatewayDelta, GatewayError, GatewayRequest, GatewayStreamEnd
from karen_ai.gateway.vercel import VercelGatewayClient
from tests.conftest import TEST_GATEWAY_KEY

BASE_URL = "https://gateway.test.invalid/v1"
MODEL = "test-creator/test-model"
FALLBACK = "test-creator/test-fallback"
Handler = Callable[[httpx2.Request], httpx2.Response]


def completion_json(**overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "id": "chatcmpl-test",
        "object": "chat.completion",
        "created": 1763550000,
        "model": MODEL,
        "choices": [
            {"index": 0, "message": {"role": "assistant", "content": "Namaste"}, "finish_reason": "stop"}
        ],
        "usage": {
            "prompt_tokens": 12,
            "completion_tokens": 3,
            "total_tokens": 15,
            "prompt_tokens_details": {"cached_tokens": 8},
            "completion_tokens_details": {"reasoning_tokens": 1},
        },
    }
    body.update(overrides)
    return body


def chunk(
    content: str | None = None, finish: str | None = None, *, usage: dict[str, int] | None = None
) -> bytes:
    choices = [] if usage else [{"index": 0, "delta": {"content": content}, "finish_reason": finish}]
    data: dict[str, Any] = {
        "id": "chunk-test",
        "object": "chat.completion.chunk",
        "created": 1763550000,
        "model": MODEL,
        "choices": choices,
    }
    if usage:
        data["usage"] = usage
    return f"data: {json.dumps(data)}\n\n".encode()


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


def make_client(recorder: Recorder, *, max_retries: int = 2) -> tuple[VercelGatewayClient, list[float]]:
    delays: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        delays.append(seconds)

    client = VercelGatewayClient(
        base_url=BASE_URL,
        api_key=SecretStr(TEST_GATEWAY_KEY),
        timeout_seconds=5,
        max_retries=max_retries,
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
        headers={"content-type": "text/event-stream", "x-request-id": "gw-req-stream"},
        stream=SSEStream(frames, fail_after=fail_after),
    )


async def test_completion_success_maps_usage_and_request_shape() -> None:
    recorder = Recorder(httpx2.Response(200, json=completion_json(), headers={"x-request-id": "gw-req-1"}))
    client, _ = make_client(recorder)
    result = await client.complete(request())
    assert result.text == "Namaste"
    assert result.finish_reason == "stop"
    assert result.served_model == MODEL
    assert result.gateway_request_id == "gw-req-1"
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
    assert "providerOptions" not in body


async def test_fallback_is_sent_as_gateway_provider_options() -> None:
    recorder = Recorder(httpx2.Response(200, json=completion_json()))
    client, _ = make_client(recorder)
    await client.complete(request(fallback=True))
    assert recorder.body()["providerOptions"] == {"gateway": {"models": [FALLBACK]}}


async def test_missing_usage_and_headers_stay_null() -> None:
    recorder = Recorder(httpx2.Response(200, json=completion_json(usage=None)))
    client, _ = make_client(recorder)
    result = await client.complete(request())
    assert result.usage.input_tokens is None
    assert result.usage.cached_tokens is None
    assert result.gateway_request_id is None


async def test_rate_limit_is_retried_with_backoff_then_mapped() -> None:
    recorder = Recorder(httpx2.Response(429, json={"error": {"message": "slow down"}}))
    client, delays = make_client(recorder, max_retries=2)
    with pytest.raises(GatewayError) as exc:
        await client.complete(request())
    assert exc.value.code == "GATEWAY_RATE_LIMITED"
    assert exc.value.retryable
    assert exc.value.attempts == 3
    assert len(recorder.requests) == 3
    assert len(delays) == 2
    assert all(0 < d <= 4.0 for d in delays)


async def test_rate_limit_then_success() -> None:
    recorder = Recorder(httpx2.Response(429, json={}), httpx2.Response(200, json=completion_json()))
    client, _ = make_client(recorder)
    result = await client.complete(request())
    assert result.attempts == 2


async def test_timeout_is_mapped() -> None:
    recorder = Recorder(httpx2.ReadTimeout("test timeout"))
    client, _ = make_client(recorder, max_retries=1)
    with pytest.raises(GatewayError) as exc:
        await client.complete(request())
    assert exc.value.code == "GATEWAY_TIMEOUT"
    assert len(recorder.requests) == 2


async def test_upstream_5xx_with_fallback_is_fallback_exhausted() -> None:
    recorder = Recorder(httpx2.Response(503, json={"error": {"message": "upstream said: <prompt echo>"}}))
    client, _ = make_client(recorder, max_retries=0)
    with pytest.raises(GatewayError) as exc:
        await client.complete(request(fallback=True))
    assert exc.value.code == "FALLBACK_EXHAUSTED"
    assert "prompt echo" not in exc.value.message


async def test_client_errors_are_not_retried() -> None:
    recorder = Recorder(httpx2.Response(400, json={"error": {"message": "bad"}}))
    client, delays = make_client(recorder)
    with pytest.raises(GatewayError) as exc:
        await client.complete(request())
    assert exc.value.code == "GATEWAY_PROVIDER_ERROR"
    assert not exc.value.retryable
    assert len(recorder.requests) == 1
    assert delays == []


async def test_invalid_body_is_invalid_response() -> None:
    recorder = Recorder(httpx2.Response(200, json=completion_json(choices=[])))
    client, _ = make_client(recorder)
    with pytest.raises(GatewayError) as exc:
        await client.complete(request())
    assert exc.value.code == "GATEWAY_INVALID_RESPONSE"


async def test_streaming_success() -> None:
    usage = {"prompt_tokens": 12, "completion_tokens": 2, "total_tokens": 14}
    frames = [chunk("Nam"), chunk("aste"), chunk(None, "stop"), chunk(usage=usage), b"data: [DONE]\n\n"]
    recorder = Recorder(sse_response(frames))
    client, _ = make_client(recorder)
    items = [item async for item in client.stream(request())]
    assert [i.text for i in items if isinstance(i, GatewayDelta)] == ["Nam", "aste"]
    end = items[-1]
    assert isinstance(end, GatewayStreamEnd)
    assert end.finish_reason == "stop"
    assert end.usage.output_tokens == 2
    assert end.gateway_request_id == "gw-req-stream"
    body = recorder.body()
    assert body["stream"] is True
    assert body["stream_options"] == {"include_usage": True}


async def test_stream_failure_after_delta_is_never_replayed() -> None:
    frames = [chunk("Nam"), chunk("aste"), chunk(None, "stop"), b"data: [DONE]\n\n"]
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


async def test_stream_failure_before_first_delta_is_retried() -> None:
    frames = [chunk("ok"), chunk(None, "stop"), b"data: [DONE]\n\n"]
    recorder = Recorder(httpx2.Response(503, json={}), sse_response(frames))
    client, delays = make_client(recorder)
    items = [item async for item in client.stream(request())]
    assert isinstance(items[-1], GatewayStreamEnd)
    assert items[-1].attempts == 2
    assert len(delays) == 1


async def test_stream_without_finish_reason_is_invalid() -> None:
    recorder = Recorder(sse_response([chunk("partial"), b"data: [DONE]\n\n"]))
    client, _ = make_client(recorder)
    with pytest.raises(GatewayError) as exc:
        _ = [item async for item in client.stream(request())]
    assert exc.value.code == "GATEWAY_INVALID_RESPONSE"
    assert exc.value.partial
