"""Gateway-agnostic request/result types and the GatewayClient protocol.

The application talks to ``GatewayClient`` only, which keeps KAREN decoupled from any one
gateway vendor (architecture §2.1 "documented migration path"; ADR-0025 used it to move from
Vercel AI Gateway to OpenRouter).
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Literal, Protocol

from karen_ai.contracts import AiErrorCode, ChatMessage, Usage
from karen_ai.core.errors import KarenAIError

ModelFinishReason = Literal["stop", "length", "content_filter", "tool_calls"]


@dataclass(frozen=True)
class GatewayRequest:
    request_id: str
    model: str
    messages: tuple[ChatMessage, ...]
    max_output_tokens: int
    # Gateway-side fallback order; only models with equivalent registry capabilities.
    fallback_models: tuple[str, ...] = ()
    # Turn off hidden reasoning (fast tiers). Without it, catalog models that reason by default
    # can spend the whole output budget on reasoning and return an empty answer (observed live).
    disable_reasoning: bool = False
    # Spoken turns: ask the gateway for the fastest endpoint of the chosen model.
    prefer_latency: bool = False


@dataclass(frozen=True)
class GatewayResult:
    text: str
    finish_reason: ModelFinishReason
    usage: Usage
    served_model: str | None
    gateway_request_id: str | None
    attempts: int
    served_provider: str | None = None
    # Cost the gateway itself reported (reconciliation only; budgets use registry prices).
    reported_cost_usd: float | None = None


@dataclass(frozen=True)
class GatewayDelta:
    text: str


@dataclass(frozen=True)
class GatewayStreamEnd:
    finish_reason: ModelFinishReason
    usage: Usage
    served_model: str | None
    gateway_request_id: str | None
    attempts: int
    served_provider: str | None = None
    reported_cost_usd: float | None = None


GatewayStreamItem = GatewayDelta | GatewayStreamEnd


class GatewayError(KarenAIError):
    """A typed gateway failure. ``partial`` is True when stream deltas were already delivered."""

    def __init__(
        self,
        code: AiErrorCode,
        message: str,
        *,
        retryable: bool,
        attempts: int = 1,
        partial: bool = False,
        status_code: int | None = None,
    ) -> None:
        super().__init__(code, message, retryable=retryable)
        self.attempts = attempts
        self.partial = partial
        self.status_code = status_code


class GatewayClient(Protocol):
    @property
    def is_mock(self) -> bool: ...

    async def complete(self, request: GatewayRequest) -> GatewayResult: ...

    def stream(self, request: GatewayRequest) -> AsyncIterator[GatewayStreamItem]:
        """Yield deltas then exactly one ``GatewayStreamEnd``, or raise ``GatewayError``.

        Implementations must never replay a stream after a delta has been yielded.
        """
        ...

    async def aclose(self) -> None: ...
