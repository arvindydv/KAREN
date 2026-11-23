"""Deterministic local gateway. Every result is labelled ``is_mock``; it says nothing about
model quality and never touches the network."""

from __future__ import annotations

import asyncio
import re
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from typing import Final, get_args

from karen_ai.contracts import AiErrorCode, ChatMessage, Usage
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


_DIRECTIVE: Final = re.compile(r"\[\[mock:([a-z_]+)(?:=([A-Z_0-9]+))?\]\]")
_KNOWN_CODES: Final[frozenset[str]] = frozenset(get_args(AiErrorCode))


@dataclass(frozen=True)
class MockScenario:
    """Test-only behaviour requested inside the latest user message (mock gateway ONLY).

    ``[[mock:slow]]`` paces deltas; ``[[mock:long]]`` produces a long reply;
    ``[[mock:fail=CODE]]`` fails before any delta; ``[[mock:fail_after=N]]`` fails after N deltas
    (an interrupted stream); ``[[mock:flaky_after=N]]`` does that only the FIRST time a given
    message is seen by this process, so "regenerate" can be exercised. The live gateway never
    parses these.
    """

    delay_seconds: float = 0.0
    long: bool = False
    fail_with: AiErrorCode | None = None
    fail_after_deltas: int | None = None
    flaky: bool = False


def _last_user_text(messages: tuple[ChatMessage, ...]) -> str:
    return next((m.content for m in reversed(messages) if m.role == "user"), "")


def parse_scenario(messages: tuple[ChatMessage, ...]) -> MockScenario:
    delay, long, fail_with, fail_after, flaky = 0.0, False, None, None, False
    for name, value in _DIRECTIVE.findall(_last_user_text(messages)):
        if name == "slow":
            delay = 0.15
        elif name == "long":
            long = True
        elif name == "fail" and value in _KNOWN_CODES:
            fail_with = value
        elif name in ("fail_after", "flaky_after") and value.isdigit():
            fail_after = int(value)
            fail_with = fail_with or "GATEWAY_PROVIDER_ERROR"
            flaky = flaky or name == "flaky_after"
    return MockScenario(delay, long, fail_with, fail_after, flaky)


def chat_responder(request: GatewayRequest) -> str:
    """Labelled local reply for the chat UI. It is NOT model output and says so."""
    said = _DIRECTIVE.sub("", _last_user_text(request.messages)).strip()
    excerpt = said if len(said) <= 160 else said[:157] + "..."
    turns = sum(1 for m in request.messages if m.role == "user")
    reply = (
        "**[mock] Local test reply — no AI model was called.**\n\n"
        f"You said: \u201c{excerpt}\u201d\n\n"
        f"- Conversation turns so far: {turns}\n"
        "- Real answers arrive once the live AI gateway is enabled for this environment."
    )
    if parse_scenario(request.messages).long:
        reply += "\n\n" + " ".join(
            f"Line {i}: this paragraph exists to test scrolling." for i in range(1, 61)
        )
    return reply


class MockGatewayClient:
    def __init__(
        self,
        *,
        responder: Responder = default_responder,
        fail_with: AiErrorCode | None = None,
        fail_after_deltas: int | None = None,
        words_per_delta: int = 2,
        scenarios: bool = False,
    ) -> None:
        self._responder = responder
        self._fail_with = fail_with
        self._fail_after_deltas = fail_after_deltas
        self._words_per_delta = words_per_delta
        self._scenarios = scenarios
        self._seen_flaky: set[str] = set()
        self.calls: list[GatewayRequest] = []

    @property
    def is_mock(self) -> bool:
        return True

    def _scenario(self, request: GatewayRequest) -> MockScenario:
        if not self._scenarios:
            return MockScenario(fail_with=self._fail_with, fail_after_deltas=self._fail_after_deltas)
        parsed = parse_scenario(request.messages)
        if parsed.flaky:
            key = _last_user_text(request.messages)
            if key in self._seen_flaky:
                return MockScenario(parsed.delay_seconds, parsed.long)
            self._seen_flaky.add(key)
        if parsed.fail_with is None and self._fail_with is not None:
            return MockScenario(parsed.delay_seconds, parsed.long, self._fail_with, self._fail_after_deltas)
        return parsed

    def _error(self, *, partial: bool = False, code: AiErrorCode | None = None) -> GatewayError:
        code = code or self._fail_with or "GATEWAY_PROVIDER_ERROR"
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
        scenario = self._scenario(request)
        if scenario.fail_with is not None:
            raise self._error(code=scenario.fail_with)
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
        scenario = self._scenario(request)
        if scenario.fail_with is not None and scenario.fail_after_deltas is None:
            raise self._error(code=scenario.fail_with)
        text = self._responder(request)
        words = text.split(" ")
        size = self._words_per_delta
        chunks = [" ".join(words[i : i + size]) for i in range(0, len(words), size)]
        for index, chunk in enumerate(chunks):
            if scenario.fail_with is not None and index == scenario.fail_after_deltas:
                raise self._error(partial=index > 0, code=scenario.fail_with)
            if scenario.delay_seconds:
                await asyncio.sleep(scenario.delay_seconds)
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
