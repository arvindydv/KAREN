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

from karen_ai.memory.charset import is_memory_label_allowed, is_memory_text_allowed

CONTRACT_VERSION: Final = "2026-11-24.v5"

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

TextGenerationTier = Literal["ECONOMY", "BALANCED", "REASONING", "VISION"]
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
    "CODING",
    "DOCUMENT_ANALYSIS",
    "RESEARCH",
    "DECISION_SUPPORT",
    "IMAGE_UNDERSTANDING",
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

# ── v5: personal memory (Phase 03, ADR-0036 §2.4) ──────────────────────────────────────────────
MemoryWireStatus = Literal["on", "off_thread", "off_ephemeral", "off_consent", "unavailable"]
MEMORY_STATUSES: Final[tuple[MemoryWireStatus, ...]] = get_args(MemoryWireStatus)
MemoryKind = Literal["fact", "preference", "context", "event"]
MemorySubject = Literal["self", "third_party"]
MemorySensitivity = Literal["none", "secret", "sensitive", "minor"]
MEMORY_CONTEXT_WIRE_MAX_ITEMS: Final = 20
MEMORY_EXTRACT_MAX_CANDIDATES: Final = 5
MEMORY_EXTRACT_MESSAGE_MAX_CHARS: Final = 4_000
SLOT_PATTERN: Final = r"^[a-z][a-z0-9_]{1,47}$"


def _memory_text(value: str) -> str:
    if not is_memory_text_allowed(value):
        raise ValueError("memory text violates the character policy")
    return value


def _memory_label(value: str) -> str:
    if not is_memory_label_allowed(value):
        raise ValueError("invalid subject label")
    return value


MemoryWireText = Annotated[str, StringConstraints(min_length=1), AfterValidator(_memory_text)]
MemoryLabel = Annotated[str, AfterValidator(_memory_label)]
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
    _omittable: ClassVar[frozenset[str]] = frozenset(
        {"notes", "quality_index", "latency_p50_ms", "throughput_p50_tps", "metadata_observed_at"}
    )

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
    # Routing metadata from the live catalog (ADR-0026); optional.
    quality_index: Annotated[float, Field(ge=0, le=100)] | None = None
    latency_p50_ms: Annotated[float, Field(gt=0)] | None = None
    throughput_p50_tps: Annotated[float, Field(gt=0)] | None = None
    metadata_observed_at: IsoDate | None = None


IMAGE_URL_MAX_CHARS: Final = 2_000_000
MAX_IMAGES_PER_MESSAGE: Final = 4
IMAGE_URL_PATTERN: Final = r"^(https://\S+|data:image/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+)$"


class ImageInput(ContractModel):
    _omittable: ClassVar[frozenset[str]] = frozenset({"detail"})

    url: Annotated[str, StringConstraints(max_length=IMAGE_URL_MAX_CHARS, pattern=IMAGE_URL_PATTERN)]
    detail: Literal["low", "high", "auto"] | None = None


class ChatMessage(ContractModel):
    _omittable: ClassVar[frozenset[str]] = frozenset({"images"})

    role: Literal["system", "user", "assistant"]
    content: Annotated[str, StringConstraints(min_length=1, max_length=100_000)]
    # v2: images attached to a user message (ADR-0026).
    images: Annotated[list[ImageInput], Field(min_length=1, max_length=MAX_IMAGES_PER_MESSAGE)] | None = None

    @model_validator(mode="after")
    def _images_only_on_user_messages(self) -> ChatMessage:
        if self.images is not None and self.role != "user":
            raise ValueError("only user messages may carry images")
        return self


class MemoryContextItem(ContractModel):
    """One remembered item sent as DATA (never instructions); opaque ref, never a DB id."""

    _omittable: ClassVar[frozenset[str]] = frozenset({"subject_label"})

    ref: Annotated[str, StringConstraints(pattern=r"^m[0-9]{1,2}$")]
    kind: MemoryKind
    slot: Annotated[str, StringConstraints(pattern=SLOT_PATTERN)]
    subject: MemorySubject
    subject_label: MemoryLabel | None = None
    text: MemoryWireText
    saved_on: IsoDate


class CompletionRequest(ContractModel):
    _omittable: ClassVar[frozenset[str]] = frozenset(
        {
            "route_tier",
            "max_output_tokens",
            "task_id",
            "max_cost_usd",
            "prompt_version",
            "locale",
            "timezone",
            "reply_language",
            "user_name",
            "memory_status",
            "memory_context",
        }
    )

    contract_version: Literal["2026-11-24.v5"]
    request_id: Annotated[str, StringConstraints(min_length=8, max_length=128)]
    task_kind: TaskKind
    route_tier: RouteTier | None = None
    messages: Annotated[list[ChatMessage], Field(min_length=1, max_length=200)]
    max_output_tokens: Annotated[int, Field(gt=0, le=32_000)] | None = None
    user_ref: Annotated[str, StringConstraints(min_length=8, max_length=128)]
    task_id: Annotated[str, StringConstraints(max_length=128)] | None = None
    max_cost_usd: Annotated[float, Field(gt=0, le=10)] | None = None
    prompt_version: Annotated[str, StringConstraints(max_length=64)] | None = None
    # v2: preferred locale (BCP 47) and IANA time zone — hints, never authoritative.
    locale: Annotated[str, StringConstraints(min_length=2, max_length=35)] | None = None
    timezone: Annotated[str, StringConstraints(min_length=1, max_length=64)] | None = None
    # v3 (ADR-0027): saved reply language; omitted = reply in the latest message's language.
    reply_language: Literal["en", "hi", "hi-Latn"] | None = None
    # v3 additive: what KAREN calls the user. Letters, spaces and . ' - only.
    user_name: (
        Annotated[
            str,
            StringConstraints(min_length=1, max_length=40, pattern=r"^[\p{L}\p{M}][\p{L}\p{M} .'-]*$"),
        ]
        | None
    ) = None
    # v5 (Phase 03): memory status and the memories selected by the API. Absent = Phase 02.
    memory_status: MemoryWireStatus | None = None
    memory_context: (
        Annotated[list[MemoryContextItem], Field(max_length=MEMORY_CONTEXT_WIRE_MAX_ITEMS)] | None
    ) = None

    @model_validator(mode="after")
    def _memory_context_rules(self) -> CompletionRequest:
        if self.memory_context is None:
            return self
        if self.memory_status != "on":
            raise ValueError("memory_context requires memory_status 'on'")
        if self.task_kind != "CHAT":
            raise ValueError("memory_context is only allowed for CHAT")
        if any(m.role == "system" for m in self.messages):
            raise ValueError("memory_context cannot be combined with a caller system message")
        refs = [m.ref for m in self.memory_context]
        if len(set(refs)) != len(refs):
            raise ValueError("duplicate ref")
        return self


class Usage(ContractModel):
    input_tokens: NonNegativeInt | None
    output_tokens: NonNegativeInt | None
    cached_tokens: NonNegativeInt | None
    reasoning_tokens: NonNegativeInt | None

    @classmethod
    def unknown(cls) -> Usage:
        return cls(input_tokens=None, output_tokens=None, cached_tokens=None, reasoning_tokens=None)


class MemoryExtractRequest(ContractModel):
    _omittable: ClassVar[frozenset[str]] = frozenset({"locale"})

    contract_version: Literal["2026-11-24.v5"]
    request_id: Annotated[str, StringConstraints(min_length=8, max_length=128)]
    user_ref: Annotated[str, StringConstraints(min_length=8, max_length=128)]
    message_text: Annotated[str, StringConstraints(min_length=1, max_length=MEMORY_EXTRACT_MESSAGE_MAX_CHARS)]
    locale: Annotated[str, StringConstraints(min_length=2, max_length=35)] | None = None
    max_candidates: Annotated[int, Field(ge=1, le=MEMORY_EXTRACT_MAX_CANDIDATES)]
    max_cost_usd: Annotated[float, Field(gt=0, le=1)]


class MemoryCandidate(ContractModel):
    """A PROPOSAL only; the API re-validates every field (V1-V12)."""

    _omittable: ClassVar[frozenset[str]] = frozenset({"subject_label", "trigger_text", "valid_until"})

    kind: MemoryKind
    slot: Annotated[str, StringConstraints(pattern=SLOT_PATTERN)]
    subject: MemorySubject
    subject_label: Annotated[str, StringConstraints(max_length=40)] | None = None
    source_span: Annotated[str, StringConstraints(min_length=1, max_length=280)]
    value_text: Annotated[str, StringConstraints(min_length=1, max_length=280)]
    explicit_request: bool
    trigger_text: Annotated[str, StringConstraints(max_length=40)] | None = None
    sensitivity: MemorySensitivity
    valid_until: IsoDate | None = None


class MemoryExtractResponse(ContractModel):
    contract_version: Literal["2026-11-24.v5"]
    request_id: str
    candidates: Annotated[list[MemoryCandidate], Field(max_length=MEMORY_EXTRACT_MAX_CANDIDATES)]
    usage: Usage
    estimated_cost_usd: Annotated[float, Field(ge=0)] | None
    requested_model: str | None
    served_model: str | None
    is_mock: bool
    prompt_version: Annotated[str, StringConstraints(max_length=64)]


class CompletionResponse(ContractModel):
    contract_version: Literal["2026-11-24.v5"]
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
    # v2: invocation metadata for the caller's usage ledger (never prompt content).
    requested_model: str | None
    served_model: str | None
    gateway_request_id: str | None
    prompt_version: str | None


class ErrorEvent(ContractModel):
    event: Literal["error"]
    code: AiErrorCode
    message: str
    retryable: bool


StreamEvent = Annotated[StartEvent | DeltaEvent | DoneEvent | ErrorEvent, Field(discriminator="event")]
STREAM_EVENT_ADAPTER: Final[TypeAdapter[StreamEvent]] = TypeAdapter(StreamEvent)
