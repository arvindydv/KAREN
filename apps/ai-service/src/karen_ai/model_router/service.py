"""Completion orchestration: route -> policy/budget -> gateway -> invocation record.

Order matters: every check that can refuse a request (tier, capability, per-request budget,
daily budget) runs before the gateway is called. NO_MODEL requests never reach the gateway.
"""

from __future__ import annotations

import datetime as dt
import logging
import uuid
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from typing import Final

from opentelemetry import trace

from karen_ai.agents.fast_path import deterministic_reply, today_label
from karen_ai.contracts import (
    CONTRACT_VERSION,
    AiErrorCode,
    ChatMessage,
    CompletionRequest,
    CompletionResponse,
    DeltaEvent,
    DoneEvent,
    ErrorEvent,
    ModelCapability,
    StartEvent,
    StreamEvent,
    Usage,
)
from karen_ai.core.errors import KarenAIError
from karen_ai.core.logging_setup import log_fields
from karen_ai.gateway.base import GatewayClient, GatewayError, GatewayRequest, GatewayStreamEnd
from karen_ai.model_router.router import ModelRouter, RouteDecision, RouteRequirements
from karen_ai.observability.invocations import InvocationSink, InvocationStatus, ModelInvocationRecord
from karen_ai.policies.budget import (
    DailyBudgetTracker,
    Reservation,
    budget_cap_usd,
    check_request_budget,
    estimate_prompt_tokens,
    usage_cost_usd,
    worst_case_cost_usd,
)
from karen_ai.prompts.catalog import CHAT_PROMPT_VERSION, chat_system_prompt

_logger = logging.getLogger(__name__)

Clock = Callable[[], dt.datetime]


# Fast tiers answer directly; hidden reasoning there only adds latency and cost and can leave the
# answer empty when it uses up max_output_tokens. REASONING keeps the model's default behaviour.
REASONING_OFF_TIERS: Final[frozenset[str]] = frozenset({"ECONOMY", "BALANCED", "VISION"})


def _utcnow() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


@dataclass(frozen=True)
class ServiceLimits:
    max_output_tokens: int
    max_request_cost_usd: float


@dataclass(frozen=True)
class PreparedCompletion:
    request: CompletionRequest
    decision: RouteDecision
    gateway_request: GatewayRequest | None
    estimated_cost_usd: float
    reservation: Reservation | None
    # NO_MODEL fast path: the exact answer computed by code (no gateway call).
    deterministic_text: str | None = None


@dataclass
class _Outcome:
    status: InvocationStatus = "cancelled"
    error_class: AiErrorCode | None = None
    first_token_at: dt.datetime | None = None
    usage: Usage | None = None
    served_model: str | None = None
    served_provider: str | None = None
    gateway_request_id: str | None = None
    attempts: int = 0
    cost_usd: float | None = None
    reported_cost_usd: float | None = None


def _current_trace_id() -> str | None:
    context = trace.get_current_span().get_span_context()
    return format(context.trace_id, "032x") if context.is_valid else None


class CompletionService:
    def __init__(
        self,
        *,
        router: ModelRouter,
        gateway: GatewayClient,
        budget: DailyBudgetTracker,
        sink: InvocationSink,
        limits: ServiceLimits,
        clock: Clock = _utcnow,
    ) -> None:
        self.router = router
        self.gateway = gateway
        self._budget = budget
        self._sink = sink
        self._limits = limits
        self._clock = clock

    # ------------------------------------------------------------------ preparation

    def _with_chat_prompt(self, request: CompletionRequest) -> CompletionRequest:
        """CHAT requests get the catalogued system prompt unless the caller supplied one."""
        if request.task_kind != "CHAT" or request.messages[0].role == "system":
            return request
        today, zone = today_label(timezone=request.timezone, now=self._clock())
        system = ChatMessage(
            role="system",
            content=chat_system_prompt(
                locale=request.locale,
                today=today,
                timezone=zone,
                reply_language=request.reply_language,
                spoken=request.reply_style == "spoken",
                user_name=request.user_name,
            ),
        )
        return request.model_copy(
            update={
                "messages": [system, *request.messages],
                "prompt_version": request.prompt_version or CHAT_PROMPT_VERSION,
            }
        )

    async def prepare(self, request: CompletionRequest, *, stream: bool) -> PreparedCompletion:
        tier = self.router.select_tier(request.task_kind, request.route_tier)
        if tier == "NO_MODEL":
            return PreparedCompletion(request, RouteDecision("NO_MODEL", None), None, 0.0, None)
        if request.task_kind == "CHAT" and request.route_tier is None and request.messages[-1].role == "user":
            exact = deterministic_reply(
                request.messages[-1].content, timezone=request.timezone, now=self._clock()
            )
            if exact is not None:
                return PreparedCompletion(request, RouteDecision("NO_MODEL", None), None, 0.0, None, exact)
        request = self._with_chat_prompt(request)

        cap = self._limits.max_output_tokens
        budget_cap = budget_cap_usd(
            service_cap_usd=self._limits.max_request_cost_usd, request_cap_usd=request.max_cost_usd
        )
        input_tokens = estimate_prompt_tokens(request.messages)
        requirements = RouteRequirements(
            stream=stream,
            input_tokens=input_tokens,
            max_output_tokens=min(request.max_output_tokens or cap, cap),
            max_cost_usd=budget_cap,
            needs_vision=any(m.images for m in request.messages),
        )
        try:
            decision = self.router.route(
                tier,
                requirements,
                task_kind=request.task_kind,
                # ADR-0031: a spoken turn goes to the low-latency voice model when one is set.
                task_route="VOICE" if request.reply_style == "spoken" else None,
            )
        except KarenAIError as exc:
            if exc.code == "BUDGET_EXCEEDED":
                _logger.warning("budget_rejected", extra=log_fields(route_tier=tier, stage="routing"))
            raise
        primary = decision.primary
        if primary is None:  # pragma: no cover - NO_MODEL returned earlier
            raise KarenAIError("INTERNAL_ERROR", "Router returned no model for a model tier.")
        max_output = decision.max_output_tokens

        estimate = worst_case_cost_usd(decision.candidates, input_tokens, max_output)
        try:
            check_request_budget(
                estimate,
                service_cap_usd=self._limits.max_request_cost_usd,
                request_cap_usd=request.max_cost_usd,
            )
            reservation = await self._budget.reserve(estimate)
        except Exception:
            _logger.warning(
                "budget_rejected",
                extra=log_fields(route_tier=tier, estimated_cost_usd=estimate),
            )
            raise
        gateway_request = GatewayRequest(
            request_id=request.request_id,
            model=primary.model_id,
            messages=tuple(request.messages),
            max_output_tokens=max_output,
            fallback_models=tuple(m.model_id for m in decision.fallbacks),
            disable_reasoning=tier in REASONING_OFF_TIERS,
            prefer_latency=request.reply_style == "spoken",
        )
        return PreparedCompletion(request, decision, gateway_request, estimate, reservation)

    # ------------------------------------------------------------------ non-streaming

    async def complete(self, request: CompletionRequest) -> CompletionResponse:
        prepared = await self.prepare(request, stream=False)
        if prepared.gateway_request is None:
            return self._no_model_response(request, prepared.deterministic_text)
        started = self._clock()
        outcome = _Outcome()
        try:
            result = await self.gateway.complete(prepared.gateway_request)
        except GatewayError as exc:
            outcome.status, outcome.error_class, outcome.attempts = "failed", exc.code, exc.attempts
            raise
        else:
            outcome.status, outcome.usage, outcome.attempts = "succeeded", result.usage, result.attempts
            outcome.served_model, outcome.gateway_request_id = result.served_model, result.gateway_request_id
            outcome.served_provider, outcome.reported_cost_usd = (
                result.served_provider,
                result.reported_cost_usd,
            )
            outcome.cost_usd = usage_cost_usd(self._priced_model(prepared, result.served_model), result.usage)
        finally:
            await self._finish(prepared, started, outcome)
        return CompletionResponse(
            contract_version=CONTRACT_VERSION,
            request_id=request.request_id,
            route_tier=prepared.decision.tier,
            requested_model=prepared.gateway_request.model,
            served_model=result.served_model,
            gateway_request_id=result.gateway_request_id,
            output_text=result.text,
            finish_reason=result.finish_reason,
            usage=result.usage,
            estimated_cost_usd=outcome.cost_usd
            if outcome.cost_usd is not None
            else prepared.estimated_cost_usd,
            is_mock=self.gateway.is_mock,
        )

    # ------------------------------------------------------------------ streaming

    async def stream_events(self, prepared: PreparedCompletion) -> AsyncIterator[StreamEvent]:
        """Contract stream events; always ends with exactly one ``done`` or ``error``."""
        request = prepared.request
        if prepared.gateway_request is None:
            yield StartEvent(
                event="start",
                request_id=request.request_id,
                route_tier="NO_MODEL",
                served_model=None,
                is_mock=False,
            )
            if prepared.deterministic_text:
                yield DeltaEvent(event="delta", index=0, text=prepared.deterministic_text)
            yield DoneEvent(
                event="done",
                finish_reason="no_model",
                usage=Usage.unknown(),
                estimated_cost_usd=0.0,
                requested_model=None,
                served_model=None,
                gateway_request_id=None,
                prompt_version=None,
            )
            return

        started = self._clock()
        outcome = _Outcome()
        gateway_request = prepared.gateway_request
        try:
            yield StartEvent(
                event="start",
                request_id=request.request_id,
                route_tier=prepared.decision.tier,
                # The live gateway reports the served model only as chunks arrive.
                served_model=gateway_request.model if self.gateway.is_mock else None,
                is_mock=self.gateway.is_mock,
            )
            index = 0
            end: GatewayStreamEnd | None = None
            async for item in self.gateway.stream(gateway_request):
                if isinstance(item, GatewayStreamEnd):
                    end = item
                    continue
                if outcome.first_token_at is None:
                    outcome.first_token_at = self._clock()
                yield DeltaEvent(event="delta", index=index, text=item.text)
                index += 1
            if end is None:
                raise GatewayError(
                    "GATEWAY_INVALID_RESPONSE", "Gateway stream ended without completion.", retryable=False
                )
            outcome.status, outcome.usage, outcome.attempts = "succeeded", end.usage, end.attempts
            outcome.served_model, outcome.gateway_request_id = end.served_model, end.gateway_request_id
            outcome.served_provider = end.served_provider
            outcome.reported_cost_usd = end.reported_cost_usd
            outcome.cost_usd = usage_cost_usd(self._priced_model(prepared, end.served_model), end.usage)
            yield DoneEvent(
                event="done",
                finish_reason=end.finish_reason,
                usage=end.usage,
                estimated_cost_usd=outcome.cost_usd
                if outcome.cost_usd is not None
                else prepared.estimated_cost_usd,
                requested_model=gateway_request.model,
                served_model=end.served_model,
                gateway_request_id=end.gateway_request_id,
                prompt_version=request.prompt_version,
            )
        except GatewayError as exc:
            outcome.status, outcome.error_class, outcome.attempts = "failed", exc.code, exc.attempts
            yield ErrorEvent(event="error", code=exc.code, message=exc.message, retryable=exc.retryable)
        except Exception:
            _logger.exception("stream_failed")
            outcome.status, outcome.error_class = "failed", "INTERNAL_ERROR"
            yield ErrorEvent(event="error", code="INTERNAL_ERROR", message="Internal error.", retryable=False)
        finally:
            await self._finish(prepared, started, outcome)

    # ------------------------------------------------------------------ helpers

    @staticmethod
    def _priced_model(prepared: PreparedCompletion, served_model: str | None) -> ModelCapability | None:
        candidates = prepared.decision.candidates
        matched = next((m for m in candidates if m.model_id == served_model), None)
        if matched is not None:
            return matched
        # Unknown served slug: price conservatively at the most expensive candidate.
        return max(candidates, key=lambda m: m.output_usd_per_million_tokens, default=None)

    @staticmethod
    def _no_model_response(request: CompletionRequest, text: str | None = None) -> CompletionResponse:
        return CompletionResponse(
            contract_version=CONTRACT_VERSION,
            request_id=request.request_id,
            route_tier="NO_MODEL",
            requested_model=None,
            served_model=None,
            gateway_request_id=None,
            output_text=text or "",
            finish_reason="no_model",
            usage=Usage.unknown(),
            estimated_cost_usd=0.0,
            is_mock=False,
        )

    async def _finish(self, prepared: PreparedCompletion, started: dt.datetime, outcome: _Outcome) -> None:
        if prepared.reservation is not None:
            # Failed/cancelled calls may still be billed: keep the conservative estimate.
            spent = outcome.cost_usd if outcome.cost_usd is not None else prepared.estimated_cost_usd
            await self._budget.settle(prepared.reservation, spent)
        if prepared.gateway_request is None:  # pragma: no cover - NO_MODEL never reaches here
            return
        request = prepared.request
        usage = outcome.usage or Usage.unknown()
        record = ModelInvocationRecord(
            id=uuid.uuid4().hex,
            trace_id=_current_trace_id(),
            user_id_hash=request.user_ref,
            task_id=request.task_id,
            route_tier=prepared.decision.tier,
            task_route=prepared.decision.task_route,
            selection=prepared.decision.selection,
            gateway_request_id=outcome.gateway_request_id,
            requested_model=prepared.gateway_request.model,
            served_model=outcome.served_model,
            served_provider=outcome.served_provider,
            prompt_version=request.prompt_version,
            started_at=started,
            first_token_at=outcome.first_token_at,
            finished_at=self._clock(),
            status=outcome.status,
            error_class=outcome.error_class,
            input_tokens=usage.input_tokens,
            output_tokens=usage.output_tokens,
            cached_tokens=usage.cached_tokens,
            reasoning_tokens=usage.reasoning_tokens,
            estimated_cost_usd=outcome.cost_usd
            if outcome.cost_usd is not None
            else prepared.estimated_cost_usd,
            final_cost_usd=None,
            gateway_reported_cost_usd=outcome.reported_cost_usd,
            consent_policy_id=None,
            data_residency_policy_id=None,
            retry_chain_id=request.request_id,
            attempts=outcome.attempts,
            is_mock=self.gateway.is_mock,
        )
        try:
            self._sink.emit(record)
        except Exception:
            _logger.exception("invocation_sink_failed")
