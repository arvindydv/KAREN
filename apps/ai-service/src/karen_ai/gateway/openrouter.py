"""OpenRouter client over its OpenAI-compatible Chat Completions API (ADR-0025).

Automated tests run only against a fake OpenAI-compatible endpoint (never paid calls). Live
behaviour is checked by the manual SP-1 probe (``karen-ai-probe``, docs/gateway/openrouter.md).
Facts used here come from OpenRouter's API documentation (checked 2026-11-21):

- model fallback: a ``models`` array in priority order (sent via ``extra_body``); the response
  ``model`` is the model that actually served (and was billed for) the request;
- provider routing: a ``provider`` object; KAREN sends ``data_collection`` and ``zdr`` so prompts
  only reach endpoints that match the configured data policy;
- usage is returned by default (``stream_options.include_usage`` is deprecated and ignored); in a
  stream it arrives in the last chunk before ``[DONE]``. ``usage.cost`` is recorded as the
  gateway-reported cost for reconciliation only; budgets use registry prices;
- generation id: the body ``id`` (``gen-...``) and the ``X-Generation-Id`` header;
- errors: ``{"error": {"code", "message", "metadata"}}``. Before a stream starts they come with
  the real HTTP status; mid-stream they arrive as a chunk with a top-level ``error`` object and
  ``finish_reason: "error"`` (HTTP 200). ``Retry-After`` may accompany 429/503.
"""

from __future__ import annotations

import asyncio
import json
import random
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping
from dataclasses import dataclass
from typing import Any, Final, Literal

import httpx2
import openai
from openai.types.chat import (
    ChatCompletion,
    ChatCompletionChunk,
    ChatCompletionContentPartParam,
    ChatCompletionMessageParam,
)
from openai.types.chat.chat_completion_content_part_image_param import ImageURL
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

GENERATION_ID_HEADER: Final = "x-generation-id"
GENERATION_ID_PREFIX: Final = "gen-"
_BACKOFF_BASE_SECONDS: Final = 0.25
_BACKOFF_CAP_SECONDS: Final = 4.0
# A longer upstream Retry-After than this is not waited out inside one user request.
_MAX_RETRY_AFTER_SECONDS: Final = 5.0

Sleep = Callable[[float], Awaitable[None]]
DataCollection = Literal["allow", "deny"]


@dataclass(frozen=True)
class ProviderPreferences:
    """OpenRouter ``provider`` routing object: which upstream endpoints may see a prompt."""

    data_collection: DataCollection = "deny"
    zdr: bool = True

    def as_body(self) -> dict[str, Any]:
        body: dict[str, Any] = {"data_collection": self.data_collection}
        if self.zdr:  # false/omitted has no effect upstream; only send the restriction
            body["zdr"] = True
        return body


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


def _reported_cost(usage: CompletionUsage | None) -> float | None:
    """``usage.cost`` as reported by OpenRouter (an extra field on the SDK model), if numeric."""
    extra = usage.model_extra if usage is not None else None
    value = (extra or {}).get("cost")
    if isinstance(value, bool) or not isinstance(value, int | float) or value < 0:
        return None
    return float(value)


def _extra_str(model: ChatCompletion | ChatCompletionChunk, key: str) -> str | None:
    value = (model.model_extra or {}).get(key)
    return value if isinstance(value, str) and value else None


def _finish_reason(value: str | None) -> ModelFinishReason:
    match value:
        case "stop" | "length" | "content_filter" | "tool_calls":
            return value
        case "function_call":
            return "tool_calls"
        case "error":
            raise GatewayError(
                "GATEWAY_PROVIDER_ERROR", "Gateway reported an upstream error.", retryable=False
            )
        case _:
            raise GatewayError(
                "GATEWAY_INVALID_RESPONSE", "Gateway response had no valid finish_reason.", retryable=False
            )


def _user_content(message: ChatMessage) -> str | list[ChatCompletionContentPartParam]:
    """Plain text, or OpenAI-style content parts when images are attached (text first)."""
    if not message.images:
        return message.content
    parts: list[ChatCompletionContentPartParam] = [{"type": "text", "text": message.content}]
    for image in message.images:
        image_url: ImageURL = {"url": image.url}
        if image.detail is not None:
            image_url["detail"] = image.detail
        parts.append({"type": "image_url", "image_url": image_url})
    return parts


def _message_param(message: ChatMessage) -> ChatCompletionMessageParam:
    match message.role:
        case "system":
            return {"role": "system", "content": message.content}
        case "user":
            return {"role": "user", "content": _user_content(message)}
        case "assistant":
            return {"role": "assistant", "content": message.content}


def _generation_id(headers: httpx2.Headers, body_id: str | None = None) -> str | None:
    """The OpenRouter generation id (``gen-...``, usable with ``GET /generation``)."""
    if body_id and body_id.startswith(GENERATION_ID_PREFIX):
        return body_id
    return headers.get(GENERATION_ID_HEADER) or body_id or None


def _error_object(body: object) -> Mapping[str, Any] | None:
    error = body.get("error", body) if isinstance(body, dict) else None
    return error if isinstance(error, dict) else None


def error_type(body: object) -> str | None:
    """OpenRouter's machine-readable ``error.metadata.error_type`` (never the message text)."""
    error = _error_object(body)
    if error is None:
        return None
    metadata = error.get("metadata")
    value = metadata.get("error_type") if isinstance(metadata, dict) else error.get("type")
    return value if isinstance(value, str) else None


def error_status(body: object) -> int | None:
    """Numeric ``error.code`` (OpenRouter mirrors the HTTP status there, also mid-stream)."""
    error = _error_object(body)
    code = error.get("code") if error is not None else None
    return code if isinstance(code, int) and not isinstance(code, bool) and 400 <= code <= 599 else None


def retry_after_seconds(exc: BaseException) -> float | None:
    response = getattr(exc, "response", None)
    raw = response.headers.get("retry-after") if isinstance(response, httpx2.Response) else None
    try:
        return max(0.0, float(raw)) if raw is not None else None
    except ValueError:
        return None  # HTTP-date form: fall back to KAREN's own backoff


def _client_error_message(status: int, error_type: str | None) -> str:  # noqa: PLR0911 - flat mapping table
    """Operator-actionable message for a non-retryable 4xx; never echoes the upstream message."""
    if status == 401:
        return "Gateway rejected the service credentials (HTTP 401)."
    if status == 402:
        return "Gateway credit or key limit exhausted (HTTP 402)."
    if status == 403:
        if error_type in ("content_policy_violation", "refusal"):
            return "Gateway refused the request under its content policy (HTTP 403)."
        return "Gateway denied the request: permissions, guardrail or budget (HTTP 403)."
    if status == 404:
        return "Gateway does not know the configured model or route (HTTP 404)."
    if status == 400 and error_type == "context_length_exceeded":
        return "Gateway rejected the request: context length exceeded (HTTP 400)."
    return f"Gateway rejected the request (HTTP {status})."


def status_error(status: int, error_type: str | None, *, has_fallback: bool, **common: Any) -> GatewayError:
    if status == 408:
        return GatewayError(
            "GATEWAY_TIMEOUT",
            "Gateway request timed out (HTTP 408).",
            retryable=True,
            status_code=408,
            **common,
        )
    if status == 429:
        return GatewayError(
            "GATEWAY_RATE_LIMITED", "Gateway rate limit reached.", retryable=True, status_code=429, **common
        )
    if status >= 500:
        code: AiErrorCode = "FALLBACK_EXHAUSTED" if has_fallback else "GATEWAY_PROVIDER_ERROR"
        return GatewayError(
            code, f"Gateway upstream error (HTTP {status}).", retryable=True, status_code=status, **common
        )
    return GatewayError(
        "GATEWAY_PROVIDER_ERROR",
        _client_error_message(status, error_type),
        retryable=False,
        status_code=status,
        **common,
    )


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
    if isinstance(exc, openai.APIResponseValidationError | json.JSONDecodeError):
        return GatewayError(
            "GATEWAY_INVALID_RESPONSE", "Gateway returned an invalid response.", retryable=False, **common
        )
    if isinstance(exc, openai.APIStatusError):
        return status_error(exc.status_code, error_type(exc.body), has_fallback=has_fallback, **common)
    if isinstance(exc, openai.APIConnectionError | httpx2.TransportError):
        return GatewayError("GATEWAY_PROVIDER_ERROR", "Gateway connection failed.", retryable=True, **common)
    if isinstance(exc, openai.APIError):
        # Error chunk inside an HTTP 200 stream: classify by its numeric ``error.code``.
        status = error_status(exc.body)
        if status is not None:
            return status_error(status, error_type(exc.body), has_fallback=has_fallback, **common)
        return GatewayError(
            "GATEWAY_PROVIDER_ERROR", "Gateway reported an upstream error.", retryable=False, **common
        )
    return GatewayError(
        "GATEWAY_INVALID_RESPONSE", "Unexpected gateway client failure.", retryable=False, **common
    )


def internally_retryable(error: GatewayError) -> bool:
    """Retry only timeouts, rate limits and 5xx (architecture §2.5)."""
    if error.code in ("GATEWAY_TIMEOUT", "GATEWAY_RATE_LIMITED"):
        return True
    return error.status_code is not None and error.status_code >= 500


class OpenRouterGatewayClient:
    def __init__(
        self,
        *,
        base_url: str,
        api_key: SecretStr,
        timeout_seconds: float,
        max_retries: int,
        provider: ProviderPreferences | None = None,
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
        self._provider = provider or ProviderPreferences()
        self._sleep = sleep
        self._rng = rng or random.Random()  # noqa: S311 - jitter, not cryptography

    @property
    def is_mock(self) -> bool:
        return False

    def _backoff(self, attempt: int) -> float:
        ceiling = min(_BACKOFF_CAP_SECONDS, _BACKOFF_BASE_SECONDS * 2.0 ** (attempt - 1))
        return ceiling * self._rng.uniform(0.5, 1.0)

    def _retry_delay(self, attempt: int, exc: BaseException, error: GatewayError) -> float | None:
        """Seconds to wait before the next attempt, or ``None`` to give up now."""
        if attempt > self._max_retries or not internally_retryable(error):
            return None
        retry_after = retry_after_seconds(exc)
        if retry_after is None:
            return self._backoff(attempt)
        if retry_after > _MAX_RETRY_AFTER_SECONDS:
            return None  # waiting longer would outlive the user's request; surface the 429/503
        return max(retry_after, self._backoff(attempt))

    def _params(self, request: GatewayRequest) -> dict[str, Any]:
        provider = self._provider.as_body()
        if request.prefer_latency:
            # OpenRouter provider sorting; accepted live 2026-11-22 alongside zdr/data_collection.
            provider["sort"] = "latency"
        extra_body: dict[str, Any] = {"provider": provider}
        if request.fallback_models:
            # Priority order, primary first; OpenRouter tries the next model on any error.
            extra_body["models"] = [request.model, *request.fallback_models]
        if request.disable_reasoning:
            # OpenRouter's unified reasoning parameter. Verified live 2026-11-22 on every
            # ECONOMY/BALANCED/VISION model in the live registry; models whose reasoning is
            # mandatory reject it with 400, so they must never sit on a tier that sends it.
            extra_body["reasoning"] = {"enabled": False}
        return {
            "model": request.model,
            "messages": [_message_param(m) for m in request.messages],
            "max_tokens": request.max_output_tokens,
            "extra_body": extra_body,
        }

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
                    gateway_request_id=_generation_id(raw.headers, completion.id),
                    attempts=attempt,
                    served_provider=_extra_str(completion, "provider"),
                    reported_cost_usd=_reported_cost(completion.usage),
                )
            except Exception as exc:
                error = map_exception(
                    exc, attempts=attempt, partial=False, has_fallback=bool(request.fallback_models)
                )
                delay = self._retry_delay(attempt, exc, error)
                if delay is None:
                    raise error from exc
            await self._sleep(delay)

    async def stream(self, request: GatewayRequest) -> AsyncIterator[GatewayStreamItem]:
        attempt = 0
        while True:
            attempt += 1
            delivered = False
            try:
                chunks = await self._client.chat.completions.create(**self._params(request), stream=True)
                headers = chunks.response.headers
                generation_id: str | None = None
                finish: str | None = None
                served_model: str | None = None
                served_provider: str | None = None
                usage = Usage.unknown()
                reported_cost: float | None = None
                async for chunk in chunks:
                    item: ChatCompletionChunk = chunk
                    if generation_id is None:
                        generation_id = _generation_id(headers, item.id)
                    served_model = item.model or served_model
                    served_provider = _extra_str(item, "provider") or served_provider
                    if item.usage is not None:
                        usage = _usage_from(item.usage)
                        reported_cost = _reported_cost(item.usage)
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
                    gateway_request_id=generation_id or _generation_id(headers),
                    attempts=attempt,
                    served_provider=served_provider,
                    reported_cost_usd=reported_cost,
                )
                return
            except Exception as exc:
                error = map_exception(
                    exc, attempts=attempt, partial=delivered, has_fallback=bool(request.fallback_models)
                )
                # Never replay once any delta reached the caller (architecture §2.5).
                delay = None if delivered else self._retry_delay(attempt, exc, error)
                if delay is None:
                    raise error from exc
            await self._sleep(delay)

    async def aclose(self) -> None:
        await self._client.close()
