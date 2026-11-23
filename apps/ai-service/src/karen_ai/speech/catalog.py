"""Voice catalog: speech models, voices and speech prices for one or more speech providers.

Like the model registry, this file is the only place speech model IDs and voice IDs live. Each
model names its ``provider`` (``mock``, ``openrouter`` or ``deepgram``), so speech-to-text and
text-to-speech can be served by different providers from one catalog (ADR-0027).
``verified_at`` is set only after a paid probe (and, for voices, a listening check) passes; live
mode refuses unverified entries. A voice's ``accent`` comes from the locale tag in its catalog ID
(``en-IN``, ``en-US``, ``en-GB``, ``hi-IN``) or the provider's documented voice list; ``gender`` is
set only from the provider's documented voice list or an operator listening check — never guessed
from a name.
"""

from __future__ import annotations

from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from karen_ai.contracts import MODEL_ID_PATTERN, IsoDate

VoiceLanguage = Literal["en", "hi"]
Accent = Literal["indian", "american", "british"]
Gender = Literal["female", "male"]
SpeechProvider = Literal["mock", "openrouter", "deepgram"]
# batch = one recorded clip per request; live = streaming with partial results and turn detection.
SpeechMode = Literal["batch", "live"]
PriceUnit = Literal["minute", "thousand_chars"]


class CatalogError(ValueError):
    """The voice catalog is missing or invalid."""


class _Closed(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)


def _batch_only() -> list[SpeechMode]:
    return ["batch"]


class SpeechPrice(_Closed):
    """Operator-maintained list price (USD) copied from the provider's pricing page.

    Used for budget reservations and cost estimates only; invoices are the source of truth.
    """

    unit: PriceUnit
    usd: float = Field(gt=0, le=10)
    observed_at: IsoDate
    source: str = Field(min_length=8, max_length=300)


class SpeechModel(_Closed):
    model_id: str = Field(pattern=MODEL_ID_PATTERN)
    verified_at: IsoDate | None
    notes: str | None = None
    # Defaults keep catalogs written before ADR-0027 valid (they were OpenRouter-only).
    provider: SpeechProvider = "openrouter"
    modes: list[SpeechMode] = Field(default_factory=_batch_only, min_length=1)
    price: SpeechPrice | None = None
    # True only when the provider documents a speaking-rate control for this model.
    supports_speed: bool = True

    def cost_usd(self, quantity: float) -> float | None:
        """Cost of ``quantity`` minutes (STT) or characters (TTS); ``None`` without a price."""
        if self.price is None:
            return None
        units = quantity if self.price.unit == "minute" else quantity / 1000.0
        return round(max(units, 0.0) * self.price.usd, 8)


class Voice(_Closed):
    voice_id: str = Field(min_length=1, max_length=128)
    model_id: str = Field(pattern=MODEL_ID_PATTERN)
    language: VoiceLanguage
    accent: Accent
    gender: Gender | None = None
    verified_at: IsoDate | None = None
    # Human-readable name for settings screens (from the provider's voice list).
    display_name: str | None = Field(default=None, max_length=60)
    # False when the provider does not document a speaking-rate control for this voice's
    # language (e.g. Deepgram Flux TTS documents speed for English voices only).
    supports_speed: bool = True


class VoiceCatalog(_Closed):
    catalog_version: str
    # Ordered by preference (cheapest acceptable first); the first usable one is tried first.
    stt_models: list[SpeechModel]
    tts_models: list[SpeechModel]
    voices: list[Voice]
    # Which voice language reads Hinglish (romanised Hindi) text. NOT VERIFIED by listening.
    hinglish_voice_language: VoiceLanguage = "en"

    @model_validator(mode="after")
    def _consistent(self) -> VoiceCatalog:
        tts_ids = {m.model_id for m in self.tts_models}
        unknown = sorted({v.model_id for v in self.voices} - tts_ids)
        if unknown:
            raise ValueError(f"voices reference unknown tts models: {', '.join(unknown)}")
        keys = [(v.model_id, v.voice_id) for v in self.voices]
        if len(keys) != len(set(keys)):
            raise ValueError("duplicate voice entries")
        return self

    def usable_stt(
        self,
        *,
        require_verified: bool,
        provider: SpeechProvider | None = None,
        mode: SpeechMode = "batch",
    ) -> tuple[str, ...]:
        return tuple(
            m.model_id
            for m in self.stt_models
            if (not require_verified or m.verified_at)
            and (provider is None or m.provider == provider)
            and mode in m.modes
        )

    def usable_voices(self, *, require_verified: bool, provider: SpeechProvider | None = None) -> list[Voice]:
        models = {
            m.model_id
            for m in self.tts_models
            if (provider is None or m.provider == provider) and (not require_verified or m.verified_at)
        }
        return [
            v
            for v in self.voices
            if v.model_id in models and (not require_verified or v.verified_at is not None)
        ]

    def stt_model(self, model_id: str) -> SpeechModel | None:
        return next((m for m in self.stt_models if m.model_id == model_id), None)

    def tts_model(self, model_id: str) -> SpeechModel | None:
        return next((m for m in self.tts_models if m.model_id == model_id), None)


def load_catalog(path: Path) -> VoiceCatalog:
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise CatalogError(f"voice catalog not readable at {path}: {exc.strerror}") from exc
    try:
        return VoiceCatalog.model_validate_json(raw)
    except ValidationError as exc:
        raise CatalogError(f"voice catalog at {path} is invalid: {exc.error_count()} error(s)") from exc
