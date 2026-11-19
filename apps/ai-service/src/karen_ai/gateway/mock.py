"""Deterministic local gateway. Every result is labelled ``is_mock``; it says nothing about
model quality and never touches the network."""

from __future__ import annotations

from collections.abc import AsyncIterator, Callable
from typing import Final

from karen_ai.contracts import AiErrorCode, Usage
from karen_ai.gateway.base import (
    GatewayDelta,
    GatewayError,
    GatewayRequest,
    GatewayResult,
    GatewayStreamEnd,
    GatewayStreamItem,
)
from karen_ai.policies.budget import estimate_prompt_tokens

Responder = Callable[[GatewayRequest], str]

_RETRYABLE: Final[frozenset[AiErrorCode]] = frozenset(
    {"GATEWAY_TIMEOUT", "GATEWAY_RATE_LIMITED", "GATEWAY_PROVIDER_ERROR"}
)


def default_responder(request: GatewayRequest) -> str:
    return f"[mock] {request.model} received {len(request.messages)} message(s)."


class MockGatewayClient:
    def __init__(
        self,
        *,
        responder: Responder = default_responder,
        fail_with: AiErrorCode | None = None,
        fail_after_deltas: int | None = None,
        words_per_delta: int = 2,
    ) -> None:
        self._responder = responder
        self._fail_with = fail_with
        self._fail_after_deltas = fail_after_deltas
        self._words_per_delta = words_per_delta
        self.calls: list[GatewayRequest] = []

    @property
    def is_mock(self) -> bool:
        return True

    def _error(self, *, partial: bool = False) -> GatewayError:
        code = self._fail_with or "GATEWAY_PROVIDER_ERROR"
        return GatewayError(
            code,
            f"mock gateway configured to fail with {code}",
            retryable=code in _RETRYABLE,
            partial=partial,
        )

    def _usage(self, request: GatewayRequest, text: str) -> Usage:
        return Usage(
            input_tokens=estimate_prompt_tokens(request.messages),
            output_tokens=len(text.split()),
            cached_tokens=None,
            reasoning_tokens=None,
        )

    async def complete(self, request: GatewayRequest) -> GatewayResult:
        self.calls.append(request)
        if self._fail_with is not None:
            raise self._error()
        text = self._responder(request)
        return GatewayResult(
            text=text,
            finish_reason="stop",
            usage=self._usage(request, text),
            served_model=request.model,
            gateway_request_id=None,
            attempts=1,
        )

    async def stream(self, request: GatewayRequest) -> AsyncIterator[GatewayStreamItem]:
        self.calls.append(request)
        if self._fail_with is not None and self._fail_after_deltas is None:
            raise self._error()
        text = self._responder(request)
        words = text.split(" ")
        size = self._words_per_delta
        chunks = [" ".join(words[i : i + size]) for i in range(0, len(words), size)]
        for index, chunk in enumerate(chunks):
            if self._fail_with is not None and index == self._fail_after_deltas:
                raise self._error(partial=index > 0)
            yield GatewayDelta(text=chunk if index == len(chunks) - 1 else chunk + " ")
        yield GatewayStreamEnd(
            finish_reason="stop",
            usage=self._usage(request, text),
            served_model=request.model,
            gateway_request_id=None,
            attempts=1,
        )

    async def aclose(self) -> None:
        return None
