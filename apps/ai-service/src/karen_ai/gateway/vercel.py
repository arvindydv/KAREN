"""Vercel AI Gateway client over its OpenAI-compatible Chat Completions API.

NOT VERIFIED against the live gateway (no credentials exist yet). Behaviour is tested only
against a fake OpenAI-compatible endpoint. Items that need live verification before launch:
- ``providerOptions.gateway.models`` fallback via ``extra_body`` (architecture §2.5 example);
- ``stream_options.include_usage`` support and which usage detail fields are reported;
- the response header that carries a gateway request id (``x-request-id`` assumed);
- how fallback exhaustion is surfaced (mapped heuristically to FALLBACK_EXHAUSTED).
"""

from __future__ import annotations

import asyncio
import json
import random
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any, Final

import httpx2
import openai
from openai.types.chat import ChatCompletion, ChatCompletionChunk, ChatCompletionMessageParam
from openai.types.completion_usage import CompletionUsage
from pydantic import SecretStr

from karen_ai.contracts import AiErrorCode, ChatMessage, Usage
from karen_ai.gateway.base import (
    GatewayDelta,
    GatewayError,
    GatewayRequest,
    GatewayResult,
    GatewayStreamEnd,
    GatewayStreamItem,
    ModelFinishReason,
)

GATEWAY_REQUEST_ID_HEADERS: Final[tuple[str, ...]] = ("x-request-id",)
_BACKOFF_BASE_SECONDS: Final = 0.25
_BACKOFF_CAP_SECONDS: Final = 4.0

Sleep = Callable[[float], Awaitable[None]]


def _usage_from(usage: CompletionUsage | None) -> Usage:
    if usage is None:
        return Usage.unknown()
    prompt_details = usage.prompt_tokens_details
    completion_details = usage.completion_tokens_details
    return Usage(
        input_tokens=usage.prompt_tokens,
        output_tokens=usage.completion_tokens,
        cached_tokens=prompt_details.cached_tokens if prompt_details else None,
        reasoning_tokens=completion_details.reasoning_tokens if completion_details else None,
    )


def _finish_reason(value: str | None) -> ModelFinishReason:
    match value:
        case "stop" | "length" | "content_filter" | "tool_calls":
            return value
        case "function_call":
            return "tool_calls"
        case _:
            raise GatewayError(
                "GATEWAY_INVALID_RESPONSE", "Gateway response had no valid finish_reason.", retryable=False
            )


def _message_param(message: ChatMessage) -> ChatCompletionMessageParam:
    match message.role:
        case "system":
            return {"role": "system", "content": message.content}
        case "user":
            return {"role": "user", "content": message.content}
        case "assistant":
            return {"role": "assistant", "content": message.content}


def _request_id_from(headers: httpx2.Headers) -> str | None:
    return next((headers[h] for h in GATEWAY_REQUEST_ID_HEADERS if h in headers), None)


def map_exception(exc: BaseException, *, attempts: int, partial: bool, has_fallback: bool) -> GatewayError:  # noqa: PLR0911 - flat mapping table
    """Translate SDK/transport exceptions into typed gateway errors.

    Messages are generic on purpose: upstream bodies can echo prompt content.
    """
    if isinstance(exc, GatewayError):
        exc.attempts, exc.partial = attempts, partial
        return exc
    common: dict[str, Any] = {"attempts": attempts, "partial": partial}
    if isinstance(exc, openai.APITimeoutError | httpx2.TimeoutException):
        return GatewayError("GATEWAY_TIMEOUT", "Gateway request timed out.", retryable=True, **common)
    if isinstance(exc, openai.RateLimitError):
        return GatewayError(
            "GATEWAY_RATE_LIMITED", "Gateway rate limit reached.", retryable=True, status_code=429, **common
        )
    if isinstance(exc, openai.APIResponseValidationError | json.JSONDecodeError):
        return GatewayError(
            "GATEWAY_INVALID_RESPONSE", "Gateway returned an invalid response.", retryable=False, **common
        )
    if isinstance(exc, openai.APIStatusError):
        status = exc.status_code
        if status >= 500:
            code: AiErrorCode = "FALLBACK_EXHAUSTED" if has_fallback else "GATEWAY_PROVIDER_ERROR"
            return GatewayError(
                code, f"Gateway upstream error (HTTP {status}).", retryable=True, status_code=status, **common
            )
        if status in (401, 403):
            message = f"Gateway rejected the service credentials (HTTP {status})."
        else:
            message = f"Gateway rejected the request (HTTP {status})."
        return GatewayError("GATEWAY_PROVIDER_ERROR", message, retryable=False, status_code=status, **common)
    if isinstance(exc, openai.APIConnectionError | httpx2.TransportError):
        return GatewayError("GATEWAY_PROVIDER_ERROR", "Gateway connection failed.", retryable=True, **common)
    if isinstance(exc, openai.APIError):
        # Error object inside an otherwise successful (e.g. streaming) response.
        return GatewayError(
            "GATEWAY_PROVIDER_ERROR", "Gateway reported an upstream error.", retryable=False, **common
        )
    return GatewayError(
        "GATEWAY_INVALID_RESPONSE", "Unexpected gateway client failure.", retryable=False, **common
    )


def _internally_retryable(error: GatewayError) -> bool:
    """Retry only timeouts, rate limits and 5xx (architecture §2.5)."""
    if error.code in ("GATEWAY_TIMEOUT", "GATEWAY_RATE_LIMITED"):
        return True
    return error.status_code is not None and error.status_code >= 500


class VercelGatewayClient:
    def __init__(
        self,
        *,
        base_url: str,
        api_key: SecretStr,
        timeout_seconds: float,
        max_retries: int,
        http_client: httpx2.AsyncClient | None = None,
        sleep: Sleep = asyncio.sleep,
        rng: random.Random | None = None,
    ) -> None:
        self._client = openai.AsyncOpenAI(
            base_url=base_url,
            api_key=api_key.get_secret_value(),
            timeout=timeout_seconds,
            max_retries=0,  # KAREN owns retry policy (bounded, jittered, never mid-stream)
            http_client=http_client,
        )
        self._max_retries = max_retries
        self._sleep = sleep
        self._rng = rng or random.Random()  # noqa: S311 - jitter, not cryptography

    @property
    def is_mock(self) -> bool:
        return False

    def _backoff(self, attempt: int) -> float:
        ceiling = min(_BACKOFF_CAP_SECONDS, _BACKOFF_BASE_SECONDS * 2.0 ** (attempt - 1))
        return ceiling * self._rng.uniform(0.5, 1.0)

    @staticmethod
    def _params(request: GatewayRequest) -> dict[str, Any]:
        messages = [_message_param(m) for m in request.messages]
        params: dict[str, Any] = {
            "model": request.model,
            "messages": messages,
            "max_tokens": request.max_output_tokens,
        }
        if request.fallback_models:
            params["extra_body"] = {"providerOptions": {"gateway": {"models": list(request.fallback_models)}}}
        return params

    async def complete(self, request: GatewayRequest) -> GatewayResult:
        attempt = 0
        while True:
            attempt += 1
            try:
                raw = await self._client.chat.completions.with_raw_response.create(**self._params(request))
                completion: ChatCompletion = raw.parse()
                if not completion.choices:
                    raise GatewayError(
                        "GATEWAY_INVALID_RESPONSE", "Gateway response had no choices.", retryable=False
                    )
                choice = completion.choices[0]
                return GatewayResult(
                    text=choice.message.content or "",
                    finish_reason=_finish_reason(choice.finish_reason),
                    usage=_usage_from(completion.usage),
                    served_model=completion.model or None,
                    gateway_request_id=_request_id_from(raw.headers),
                    attempts=attempt,
                )
            except Exception as exc:
                error = map_exception(
                    exc, attempts=attempt, partial=False, has_fallback=bool(request.fallback_models)
                )
                if attempt > self._max_retries or not _internally_retryable(error):
                    raise error from exc
            await self._sleep(self._backoff(attempt))

    async def stream(self, request: GatewayRequest) -> AsyncIterator[GatewayStreamItem]:
        attempt = 0
        while True:
            attempt += 1
            delivered = False
            try:
                chunks = await self._client.chat.completions.create(
                    **self._params(request), stream=True, stream_options={"include_usage": True}
                )
                gateway_request_id = _request_id_from(chunks.response.headers)
                finish: str | None = None
                served_model: str | None = None
                usage = Usage.unknown()
                async for chunk in chunks:
                    item: ChatCompletionChunk = chunk
                    served_model = item.model or served_model
                    if item.usage is not None:
                        usage = _usage_from(item.usage)
                    for choice in item.choices:
                        if choice.finish_reason is not None:
                            finish = choice.finish_reason
                        if choice.delta.content:
                            delivered = True
                            yield GatewayDelta(text=choice.delta.content)
                yield GatewayStreamEnd(
                    finish_reason=_finish_reason(finish),
                    usage=usage,
                    served_model=served_model,
                    gateway_request_id=gateway_request_id,
                    attempts=attempt,
                )
                return
            except Exception as exc:
                error = map_exception(
                    exc, attempts=attempt, partial=delivered, has_fallback=bool(request.fallback_models)
                )
                # Never replay once any delta reached the caller (architecture §2.5).
                if delivered or attempt > self._max_retries or not _internally_retryable(error):
                    raise error from exc
            await self._sleep(self._backoff(attempt))

    async def aclose(self) -> None:
        await self._client.close()
