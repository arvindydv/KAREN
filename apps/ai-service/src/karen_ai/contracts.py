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

CONTRACT_VERSION: Final = "2026-11-22.v3"

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
    "NOT_FOUND",
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
            "reply_style",
            "user_name",
        }
    )

    contract_version: Literal["2026-11-22.v3"]
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
    # v3 additive (ADR-0029): "spoken" = voice turn, reply will be read aloud.
    reply_style: Literal["spoken"] | None = None
    # v3 additive (ADR-0034): what KAREN calls the user. Letters, spaces and . ' - only.
    user_name: (
        Annotated[
            str,
            StringConstraints(min_length=1, max_length=40, pattern=r"^[\p{L}\p{M}][\p{L}\p{M} .'-]*$"),
        ]
        | None
    ) = None


class Usage(ContractModel):
    input_tokens: NonNegativeInt | None
    output_tokens: NonNegativeInt | None
    cached_tokens: NonNegativeInt | None
    reasoning_tokens: NonNegativeInt | None

    @classmethod
    def unknown(cls) -> Usage:
        return cls(input_tokens=None, output_tokens=None, cached_tokens=None, reasoning_tokens=None)


class CompletionResponse(ContractModel):
    contract_version: Literal["2026-11-22.v3"]
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


# ------------------------------------------------------------------------------- speech (ADR-0026)

SpeechLanguage = Literal["en", "hi", "hi-Latn"]
SPEECH_LANGUAGES: Final[tuple[SpeechLanguage, ...]] = get_args(SpeechLanguage)
VoiceAccent = Literal["indian", "american", "british"]
VOICE_ACCENTS: Final[tuple[VoiceAccent, ...]] = get_args(VoiceAccent)
VoiceGender = Literal["female", "male", "any"]
VOICE_GENDERS: Final[tuple[VoiceGender, ...]] = get_args(VoiceGender)
AudioInputFormat = Literal["webm", "ogg", "mp3", "wav", "m4a", "aac", "flac"]
AUDIO_INPUT_FORMATS: Final[tuple[AudioInputFormat, ...]] = get_args(AudioInputFormat)

MAX_TRANSCRIPTION_AUDIO_BYTES: Final = 1_500_000
MAX_TRANSCRIPTION_AUDIO_MS: Final = 60_000
MAX_SPEECH_TEXT_CHARS: Final = 4_000
# v3: Deepgram documents 0.7-1.5 (Aura-2) and 0.5-1.5 (Flux TTS); KAREN uses the overlap.
VOICE_SPEED_MIN: Final = 0.7
VOICE_SPEED_MAX: Final = 1.5
VOICE_ID_PATTERN: Final = r"^[A-Za-z0-9._:-]{1,128}$"
_MAX_AUDIO_BASE64_CHARS: Final = -(-MAX_TRANSCRIPTION_AUDIO_BYTES // 3) * 4

SPEECH_RESPONSE_HEADERS: Final = {
    "voiceId": "x-karen-voice-id",
    "language": "x-karen-speech-language",
    "servedModel": "x-karen-served-model",
    "isMock": "x-karen-is-mock",
    "estimatedCostUsd": "x-karen-estimated-cost-usd",
    "textTruncated": "x-karen-text-truncated",
}


class VoicePreferences(ContractModel):
    _omittable: ClassVar[frozenset[str]] = frozenset({"voice_id"})

    accent: VoiceAccent
    gender: VoiceGender
    speed: Annotated[float, Field(ge=VOICE_SPEED_MIN, le=VOICE_SPEED_MAX)]
    # v3: preferred catalog voice; used when it can speak the reply's language, else ignored.
    voice_id: Annotated[str, StringConstraints(pattern=VOICE_ID_PATTERN)] | None = None


class TranscriptionRequest(ContractModel):
    _omittable: ClassVar[frozenset[str]] = frozenset({"duration_ms", "language_hint", "max_cost_usd"})

    contract_version: Literal["2026-11-22.v3"]
    request_id: Annotated[str, StringConstraints(min_length=8, max_length=128)]
    user_ref: Annotated[str, StringConstraints(min_length=8, max_length=128)]
    audio_base64: Annotated[
        str,
        StringConstraints(
            min_length=4, max_length=_MAX_AUDIO_BASE64_CHARS, pattern=r"^[A-Za-z0-9+/]+={0,2}$"
        ),
    ]
    audio_format: AudioInputFormat
    duration_ms: Annotated[int, Field(gt=0, le=MAX_TRANSCRIPTION_AUDIO_MS)] | None = None
    language_hint: SpeechLanguage | None = None
    max_cost_usd: Annotated[float, Field(gt=0, le=10)] | None = None


class TranscriptionResponse(ContractModel):
    contract_version: Literal["2026-11-22.v3"]
    request_id: str
    text: str
    language: SpeechLanguage | None
    duration_seconds: Annotated[float, Field(ge=0)] | None
    served_model: str | None
    estimated_cost_usd: Annotated[float, Field(ge=0)] | None
    is_mock: bool


class SpeechRequest(ContractModel):
    _omittable: ClassVar[frozenset[str]] = frozenset({"language", "max_cost_usd"})

    contract_version: Literal["2026-11-22.v3"]
    request_id: Annotated[str, StringConstraints(min_length=8, max_length=128)]
    user_ref: Annotated[str, StringConstraints(min_length=8, max_length=128)]
    text: Annotated[str, StringConstraints(min_length=1, max_length=MAX_SPEECH_TEXT_CHARS)]
    language: SpeechLanguage | None = None
    voice: VoicePreferences
    max_cost_usd: Annotated[float, Field(gt=0, le=10)] | None = None


# --------------------------------------------------------------------- voice catalog (ADR-0027)

SpeechProviderName = Literal["mock", "openrouter", "deepgram"]


class CatalogVoice(ContractModel):
    voice_id: Annotated[str, StringConstraints(pattern=VOICE_ID_PATTERN)]
    language: Literal["en", "hi"]
    accent: VoiceAccent
    gender: Literal["female", "male"] | None
    display_name: str | None
    supports_speed: bool


class VoiceCatalogResponse(ContractModel):
    contract_version: Literal["2026-11-22.v3"]
    catalog_version: str
    tts_provider: SpeechProviderName
    stt_provider: SpeechProviderName
    live_available: bool
    speed_min: float
    speed_max: float
    voices: list[CatalogVoice]


# ------------------------------------------------------------------------ live voice (ADR-0027)

# pcm16 (ADR-0031): raw signed 16-bit little-endian mono PCM at 16 kHz (phone microphone).
LiveAudioFormat = Literal["webm", "ogg", "pcm16"]
MAX_LIVE_CHUNK_BYTES: Final = 32_768
LIVE_SESSION_ID_PATTERN: Final = r"^lv_[A-Za-z0-9]{24,48}$"
_MAX_LIVE_CHUNK_BASE64_CHARS: Final = -(-MAX_LIVE_CHUNK_BYTES // 3) * 4
LiveCloseReason = Literal["client_closed", "idle_timeout", "max_duration", "provider_error", "shutdown"]


class LiveSessionStartRequest(ContractModel):
    _omittable: ClassVar[frozenset[str]] = frozenset({"language_hint", "max_cost_usd"})

    contract_version: Literal["2026-11-22.v3"]
    request_id: Annotated[str, StringConstraints(min_length=8, max_length=128)]
    user_ref: Annotated[str, StringConstraints(min_length=8, max_length=128)]
    audio_format: LiveAudioFormat
    language_hint: SpeechLanguage | None = None
    max_cost_usd: Annotated[float, Field(gt=0, le=10)] | None = None


class LiveSessionStartResponse(ContractModel):
    contract_version: Literal["2026-11-22.v3"]
    session_id: Annotated[str, StringConstraints(pattern=LIVE_SESSION_ID_PATTERN)]
    served_model: str
    is_mock: bool
    max_seconds: Annotated[int, Field(gt=0)]
    idle_seconds: Annotated[int, Field(gt=0)]
    reserved_cost_usd: Annotated[float, Field(ge=0)]


class LiveAudioChunk(ContractModel):
    contract_version: Literal["2026-11-22.v3"]
    user_ref: Annotated[str, StringConstraints(min_length=8, max_length=128)]
    seq: Annotated[int, Field(ge=0, le=1_000_000)]
    audio_base64: Annotated[
        str,
        StringConstraints(
            min_length=4, max_length=_MAX_LIVE_CHUNK_BASE64_CHARS, pattern=r"^[A-Za-z0-9+/]+={0,2}$"
        ),
    ]


class LiveSessionCloseRequest(ContractModel):
    contract_version: Literal["2026-11-22.v3"]
    user_ref: Annotated[str, StringConstraints(min_length=8, max_length=128)]


class LiveSessionUsage(ContractModel):
    session_id: str
    status: Literal["succeeded", "failed", "cancelled"]
    reason: LiveCloseReason
    audio_seconds: Annotated[float, Field(ge=0)]
    estimated_cost_usd: Annotated[float, Field(ge=0)]
    served_model: str
    provider_request_id: str | None
    is_mock: bool
