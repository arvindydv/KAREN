"""Pydantic mirror of the cross-service wire contract.

Source of truth: ``packages/ai-model-contracts/src/index.ts`` (Zod). Both sides validate the
shared JSON fixtures in ``packages/ai-model-contracts/fixtures`` (see
``tests/contract/test_shared_fixtures.py``). Any wire change must bump ``CONTRACT_VERSION``
on both sides and update the fixtures in the same change.

Mirroring rules:
- every model is ``extra="forbid"`` and ``strict=True`` (Zod ``.strict()`` and no coercion);
- a Zod ``.optional()`` key may be absent but must not be ``null``;
- a Zod ``.nullable()`` key must be present (it may be ``null``).
"""

from __future__ import annotations

import datetime as dt
from typing import Annotated, Any, ClassVar, Final, Literal, get_args

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    TypeAdapter,
    model_validator,
)

CONTRACT_VERSION: Final = "2026-11-19.v1"

RouteTier = Literal[
    "NO_MODEL",
    "ECONOMY",
    "BALANCED",
    "REASONING",
    "VISION",
    "EMBEDDING",
    "RERANKING",
    "AUDIO",
]
ROUTE_TIERS: Final[tuple[RouteTier, ...]] = get_args(RouteTier)

TextGenerationTier = Literal["ECONOMY", "BALANCED", "REASONING"]
TEXT_GENERATION_TIERS: Final[frozenset[RouteTier]] = frozenset(get_args(TextGenerationTier))

TaskKind = Literal[
    "DETERMINISTIC",
    "INTENT_CLASSIFICATION",
    "EXTRACTION",
    "SHORT_REWRITE",
    "CHAT",
    "SUMMARY",
    "BASIC_PLANNING",
    "COMPLEX_PLANNING",
    "COMPARISON",
]
TASK_KINDS: Final[tuple[TaskKind, ...]] = get_args(TaskKind)

FinishReason = Literal["stop", "length", "content_filter", "tool_calls", "no_model"]

AiErrorCode = Literal[
    "VALIDATION_ERROR",
    "UNAUTHORIZED",
    "BUDGET_EXCEEDED",
    "CAPABILITY_UNAVAILABLE",
    "TIER_DISABLED",
    "GATEWAY_TIMEOUT",
    "GATEWAY_RATE_LIMITED",
    "GATEWAY_PROVIDER_ERROR",
    "GATEWAY_INVALID_RESPONSE",
    "FALLBACK_EXHAUSTED",
    "INTERNAL_ERROR",
]
AI_ERROR_CODES: Final[tuple[AiErrorCode, ...]] = get_args(AiErrorCode)

MODEL_ID_PATTERN: Final = r"^[a-z0-9-]+/[A-Za-z0-9._:-]+$"

INTERNAL_SIGNATURE_HEADER: Final = "x-karen-signature"
INTERNAL_CALLER_HEADER: Final = "x-karen-caller"
REQUEST_ID_HEADER: Final = "x-request-id"


def _iso_date(value: str) -> str:
    """Zod ``z.string().date()``: a calendar-valid ``YYYY-MM-DD`` string."""
    dt.date.fromisoformat(value)
    return value


ModelId = Annotated[str, StringConstraints(pattern=MODEL_ID_PATTERN)]
IsoDate = Annotated[str, StringConstraints(pattern=r"^\d{4}-\d{2}-\d{2}$"), AfterValidator(_iso_date)]
NonNegativeInt = Annotated[int, Field(ge=0)]


class ContractModel(BaseModel):
    """Base for wire models: strict, closed, immutable."""

    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)

    # Keys that are ``.optional()`` in Zod: may be omitted, must not be explicit null.
    _omittable: ClassVar[frozenset[str]] = frozenset()

    @model_validator(mode="before")
    @classmethod
    def _reject_null_for_optional_keys(cls, data: Any) -> Any:
        if isinstance(data, dict):
            nulls = sorted(k for k in cls._omittable if k in data and data[k] is None)
            if nulls:
                raise ValueError(f"optional keys must be omitted, not null: {', '.join(nulls)}")
        return data


class ModelCapability(ContractModel):
    _omittable: ClassVar[frozenset[str]] = frozenset({"notes"})

    model_id: ModelId
    tiers: Annotated[list[RouteTier], Field(min_length=1)]
    supports_streaming: bool
    supports_tools: bool
    supports_json_schema: bool
    supports_vision: bool
    max_context_tokens: Annotated[int, Field(gt=0)]
    max_output_tokens: Annotated[int, Field(gt=0)]
    input_usd_per_million_tokens: Annotated[float, Field(ge=0)]
    output_usd_per_million_tokens: Annotated[float, Field(ge=0)]
    verified_at: IsoDate | None
    notes: str | None = None


class ChatMessage(ContractModel):
    role: Literal["system", "user", "assistant"]
    content: Annotated[str, StringConstraints(min_length=1, max_length=100_000)]


class CompletionRequest(ContractModel):
    _omittable: ClassVar[frozenset[str]] = frozenset(
        {"route_tier", "max_output_tokens", "task_id", "max_cost_usd", "prompt_version"}
    )

    contract_version: Literal["2026-11-19.v1"]
    request_id: Annotated[str, StringConstraints(min_length=8, max_length=128)]
    task_kind: TaskKind
    route_tier: RouteTier | None = None
    messages: Annotated[list[ChatMessage], Field(min_length=1, max_length=200)]
    max_output_tokens: Annotated[int, Field(gt=0, le=32_000)] | None = None
    user_ref: Annotated[str, StringConstraints(min_length=8, max_length=128)]
    task_id: Annotated[str, StringConstraints(max_length=128)] | None = None
    max_cost_usd: Annotated[float, Field(gt=0, le=10)] | None = None
    prompt_version: Annotated[str, StringConstraints(max_length=64)] | None = None


class Usage(ContractModel):
    input_tokens: NonNegativeInt | None
    output_tokens: NonNegativeInt | None
    cached_tokens: NonNegativeInt | None
    reasoning_tokens: NonNegativeInt | None

    @classmethod
    def unknown(cls) -> Usage:
        return cls(input_tokens=None, output_tokens=None, cached_tokens=None, reasoning_tokens=None)


class CompletionResponse(ContractModel):
    contract_version: Literal["2026-11-19.v1"]
    request_id: str
    route_tier: RouteTier
    requested_model: str | None
    served_model: str | None
    gateway_request_id: str | None
    output_text: str
    finish_reason: FinishReason
    usage: Usage
    estimated_cost_usd: Annotated[float, Field(ge=0)] | None
    is_mock: bool


class AiErrorBody(ContractModel):
    code: AiErrorCode
    message: str
    retryable: bool
    request_id: str | None


class AiErrorEnvelope(ContractModel):
    error: AiErrorBody


class StartEvent(ContractModel):
    event: Literal["start"]
    request_id: str
    route_tier: RouteTier
    served_model: str | None
    is_mock: bool


class DeltaEvent(ContractModel):
    event: Literal["delta"]
    index: NonNegativeInt
    text: str


class DoneEvent(ContractModel):
    event: Literal["done"]
    finish_reason: FinishReason
    usage: Usage
    estimated_cost_usd: Annotated[float, Field(ge=0)] | None


class ErrorEvent(ContractModel):
    event: Literal["error"]
    code: AiErrorCode
    message: str
    retryable: bool


StreamEvent = Annotated[StartEvent | DeltaEvent | DoneEvent | ErrorEvent, Field(discriminator="event")]
STREAM_EVENT_ADAPTER: Final[TypeAdapter[StreamEvent]] = TypeAdapter(StreamEvent)
