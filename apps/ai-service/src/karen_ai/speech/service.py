"""Speech orchestration: budget -> provider -> metadata-only invocation record (ADR-0026/0027).

Order matters, exactly as for text: every refusal (feature flag, size, budget, no voice) happens
before a provider is called. Audio and text never reach logs or records. Audio is not stored.

Cost (ADR-0027): when the catalog has a list price for the model (Deepgram: USD per audio minute
for STT, per 1,000 characters for TTS), the pre-call reservation is the worst case for this
request and settlement uses the measured usage (provider-reported audio duration, characters
actually synthesised — an interrupted reply is charged only for what was sent). Without a price
(OpenRouter speech, ADR-0026) the operator-set ``KAREN_VOICE_*_RESERVE_USD`` amounts are used and
transcriptions settle to the provider-reported ``usage.cost`` when present.
"""

from __future__ import annotations

import base64
import binascii
import datetime as dt
import logging
import uuid
from collections.abc import AsyncGenerator, Callable
from dataclasses import dataclass, field
from typing import Final

from opentelemetry import trace

from karen_ai.contracts import (
    CONTRACT_VERSION,
    MAX_TRANSCRIPTION_AUDIO_BYTES,
    MAX_TRANSCRIPTION_AUDIO_MS,
    VOICE_SPEED_MAX,
    VOICE_SPEED_MIN,
    AiErrorCode,
    CatalogVoice,
    SpeechLanguage,
    SpeechProviderName,
    SpeechRequest,
    TranscriptionRequest,
    TranscriptionResponse,
    VoiceCatalogResponse,
)
from karen_ai.core.errors import KarenAIError
from karen_ai.core.language import detect_language
from karen_ai.core.logging_setup import log_fields
from karen_ai.gateway.base import GatewayError
from karen_ai.observability.invocations import InvocationSink, InvocationStatus, ModelInvocationRecord
from karen_ai.policies.budget import DailyBudgetTracker, Reservation, check_request_budget
from karen_ai.speech.base import (
    SpeechToTextProvider,
    SynthesisInput,
    SynthesisUsage,
    TextToSpeechProvider,
    TranscriptionInput,
)
from karen_ai.speech.catalog import Voice, VoiceCatalog
from karen_ai.speech.mock import MOCK_STT_MODEL
from karen_ai.speech.text import sentence_chunks, speakable, truncate_for_speech
from karen_ai.speech.voices import NoVoiceAvailableError, VoiceChoice, select_voice

_logger = logging.getLogger(__name__)

Clock = Callable[[], dt.datetime]
_HINDI_CODES: Final = frozenset({"hi", "hin", "hindi"})


def utcnow() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


def current_trace_id() -> str | None:
    context = trace.get_current_span().get_span_context()
    return format(context.trace_id, "032x") if context.is_valid else None


def transcript_language(text: str, provider_language: str | None) -> SpeechLanguage | None:
    """Detected language: the text's script decides; a provider "hi" on Latin text is Hinglish."""
    detected = detect_language(text)
    provider_code = (provider_language or "").strip().lower().split("-")[0]
    provider_hindi = provider_code in _HINDI_CODES
    if provider_hindi and detected == "en":
        return "hi-Latn"
    if detected is None and provider_hindi:
        return "hi"
    return detected


@dataclass(frozen=True)
class SpeechLimits:
    stt_reserve_usd: float
    tts_reserve_usd: float
    max_request_cost_usd: float
    max_speech_chars: int


@dataclass(frozen=True)
class SpeechRouting:
    """What the configured providers may use (computed from settings + catalog at startup)."""

    stt_provider: SpeechProviderName
    tts_provider: SpeechProviderName
    batch_models: tuple[str, ...]
    voices: tuple[Voice, ...]
    live_models: tuple[str, ...] = ()
    live_enabled: bool = False


@dataclass
class _SynthesisMeter:
    characters: int = 0
    request_ids: list[str] = field(default_factory=list)

    def __call__(self, usage: SynthesisUsage) -> None:
        self.characters += usage.characters
        if usage.provider_request_id:
            self.request_ids.append(usage.provider_request_id)


@dataclass(frozen=True)
class PreparedSpeech:
    request: SpeechRequest
    text: str
    truncated: bool
    choice: VoiceChoice
    chunks: tuple[str, ...]
    estimated_cost_usd: float
    reservation: Reservation
    speed: float


class SpeechService:
    def __init__(
        self,
        *,
        stt: SpeechToTextProvider,
        tts: TextToSpeechProvider,
        catalog: VoiceCatalog,
        routing: SpeechRouting,
        budget: DailyBudgetTracker,
        sink: InvocationSink,
        limits: SpeechLimits,
        clock: Clock = utcnow,
    ) -> None:
        self.stt = stt
        self.tts = tts
        self._catalog = catalog
        self.routing = routing
        self._budget = budget
        self._sink = sink
        self._limits = limits
        self._clock = clock

    @property
    def media_type(self) -> str:
        return self.tts.media_type

    @property
    def catalog(self) -> VoiceCatalog:
        return self._catalog

    @property
    def sink(self) -> InvocationSink:
        return self._sink

    @property
    def budget(self) -> DailyBudgetTracker:
        return self._budget

    @property
    def limits(self) -> SpeechLimits:
        return self._limits

    async def reserve(self, estimate: float, request_cap: float | None, stage: str) -> Reservation:
        try:
            check_request_budget(
                estimate, service_cap_usd=self._limits.max_request_cost_usd, request_cap_usd=request_cap
            )
            return await self._budget.reserve(estimate)
        except Exception:
            _logger.warning("budget_rejected", extra=log_fields(stage=stage, estimated_cost_usd=estimate))
            raise

    # -------------------------------------------------------------------------- catalog

    def voice_catalog(self) -> VoiceCatalogResponse:
        """Usable voices for settings screens (never includes unverified live entries)."""
        voices = [
            CatalogVoice(
                voice_id=v.voice_id,
                language=v.language,
                accent=v.accent,
                gender=v.gender,
                display_name=v.display_name,
                supports_speed=self._voice_speed_supported(v),
            )
            for v in self.routing.voices
        ]
        return VoiceCatalogResponse(
            contract_version=CONTRACT_VERSION,
            catalog_version=self._catalog.catalog_version,
            tts_provider=self.routing.tts_provider,
            stt_provider=self.routing.stt_provider,
            live_available=self.routing.live_enabled and bool(self.routing.live_models),
            speed_min=VOICE_SPEED_MIN,
            speed_max=VOICE_SPEED_MAX,
            voices=voices,
        )

    def _voice_speed_supported(self, voice: Voice) -> bool:
        model = self._catalog.tts_model(voice.model_id)
        return voice.supports_speed and (model is None or model.supports_speed)

    # -------------------------------------------------------------------------- transcription

    def _stt_cost(self, model_id: str, seconds: float) -> float | None:
        model = self._catalog.stt_model(model_id)
        return model.cost_usd(seconds / 60.0) if model is not None else None

    async def transcribe(self, request: TranscriptionRequest) -> TranscriptionResponse:
        try:
            audio = base64.b64decode(request.audio_base64, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise KarenAIError("VALIDATION_ERROR", "Audio is not valid base64.") from exc
        if not audio or len(audio) > MAX_TRANSCRIPTION_AUDIO_BYTES:
            raise KarenAIError("VALIDATION_ERROR", "Audio is empty or larger than the transcription limit.")
        models = (MOCK_STT_MODEL,) if self.stt.is_mock else self.routing.batch_models
        if not models:
            raise KarenAIError("CAPABILITY_UNAVAILABLE", "No speech-to-text model is available.")
        # Worst case: the full clip at the most expensive candidate (the clip length is capped).
        worst_seconds = MAX_TRANSCRIPTION_AUDIO_MS / 1000.0
        priced = [c for c in (self._stt_cost(m, worst_seconds) for m in models) if c is not None]
        # Mock mode still reserves (exercises the budget path) but settles to zero.
        estimate = max(priced) if priced else self._limits.stt_reserve_usd
        reservation = await self.reserve(estimate, request.max_cost_usd, "transcription")
        started = self._clock()
        status: InvocationStatus = "cancelled"
        error_class: AiErrorCode | None = None
        cost: float = estimate
        served: str | None = None
        request_id: str | None = None
        duration: float | None = None
        attempts = 0
        try:
            output = await self.stt.transcribe(
                TranscriptionInput(
                    request_id=request.request_id,
                    audio=audio,
                    audio_format=request.audio_format,
                    language_hint=request.language_hint,
                    models=models,
                )
            )
        except GatewayError as exc:
            # The provider may still have billed (e.g. a timeout after processing): the service
            # budget keeps the worst case. The API does not charge the user (ADR-0023).
            status, error_class, attempts = "failed", exc.code, exc.attempts
            raise
        else:
            status, served, attempts = "succeeded", output.served_model, output.attempts
            request_id, duration = output.provider_request_id, output.duration_seconds
            cost = self._settled_stt_cost(output.served_model, output.reported_cost_usd, duration, estimate)
        finally:
            await self._budget.settle(reservation, cost)
            self._record(
                request_id=request.request_id,
                user_ref=request.user_ref,
                requested_model=models[0],
                served_model=served,
                provider=self.routing.stt_provider,
                provider_request_id=request_id,
                started=started,
                status=status,
                error_class=error_class,
                cost=cost,
                attempts=attempts,
                is_mock=self.stt.is_mock,
                audio_seconds=duration,
            )
        return TranscriptionResponse(
            contract_version=CONTRACT_VERSION,
            request_id=request.request_id,
            text=output.text,
            language=transcript_language(output.text, output.language),
            duration_seconds=output.duration_seconds,
            served_model=output.served_model,
            estimated_cost_usd=cost,
            is_mock=self.stt.is_mock,
        )

    def _settled_stt_cost(
        self, served: str | None, reported: float | None, duration: float | None, estimate: float
    ) -> float:
        if self.stt.is_mock:
            return 0.0
        if reported is not None:
            return reported
        if served is not None and duration is not None:
            measured = self._stt_cost(served, duration)
            if measured is not None:
                return measured
        return estimate

    # ------------------------------------------------------------------------------- speech

    def _tts_cost(self, voice: Voice, characters: int) -> float | None:
        model = self._catalog.tts_model(voice.model_id)
        return model.cost_usd(characters) if model is not None else None

    async def prepare_speech(self, request: SpeechRequest) -> PreparedSpeech:
        text, truncated = truncate_for_speech(speakable(request.text), self._limits.max_speech_chars)
        if not text:
            raise KarenAIError("VALIDATION_ERROR", "There is no speakable text.")
        language = request.language or detect_language(text) or "en"
        try:
            choice = select_voice(
                language,
                request.voice,
                list(self.routing.voices),
                hinglish_voice_language=self._catalog.hinglish_voice_language,
            )
        except NoVoiceAvailableError as exc:
            raise KarenAIError("CAPABILITY_UNAVAILABLE", "No text-to-speech voice is available.") from exc
        priced = self._tts_cost(choice.voice, len(text))
        estimate = priced if priced is not None else self._limits.tts_reserve_usd
        reservation = await self.reserve(estimate, request.max_cost_usd, "speech")
        chunks = tuple(sentence_chunks(text)) if self.tts.concatenable else (text,)
        # Unsupported speaking-rate control: speak at normal speed rather than fail (fallback).
        speed = request.voice.speed if self._voice_speed_supported(choice.voice) else 1.0
        return PreparedSpeech(request, text, truncated, choice, chunks, estimate, reservation, speed)

    async def stream_speech(self, prepared: PreparedSpeech) -> AsyncGenerator[bytes]:
        """Audio bytes, sentence by sentence. Stopping iteration stops synthesis (interruption)."""
        request, voice = prepared.request, prepared.choice.voice
        started = self._clock()
        status: InvocationStatus = "cancelled"
        error_class: AiErrorCode | None = None
        attempts = 0
        meter = _SynthesisMeter()
        try:
            for chunk in prepared.chunks:
                attempts += 1
                async for audio in self.tts.synthesize(
                    SynthesisInput(
                        request_id=request.request_id,
                        text=chunk,
                        model=voice.model_id,
                        voice_id=voice.voice_id,
                        speed=prepared.speed,
                        on_usage=meter,
                    )
                ):
                    yield audio
            status = "succeeded"
        except GatewayError as exc:
            status, error_class = "failed", exc.code
            _logger.warning(
                "speech_stream_failed", extra=log_fields(error_class=exc.code, partial=exc.partial)
            )
        finally:
            cost = self._settled_tts_cost(voice, meter, prepared.estimated_cost_usd)
            await self._budget.settle(prepared.reservation, cost)
            self._record(
                request_id=request.request_id,
                user_ref=request.user_ref,
                requested_model=voice.model_id,
                served_model=voice.voice_id,
                provider=self.routing.tts_provider,
                provider_request_id=meter.request_ids[-1] if meter.request_ids else None,
                started=started,
                status=status,
                error_class=error_class,
                cost=cost,
                attempts=attempts,
                is_mock=self.tts.is_mock,
                characters=meter.characters or None,
            )

    def _settled_tts_cost(self, voice: Voice, meter: _SynthesisMeter, estimate: float) -> float:
        if self.tts.is_mock:
            return 0.0
        if meter.characters:
            measured = self._tts_cost(voice, meter.characters)
            if measured is not None:
                return min(measured, estimate) if estimate > 0 else measured
        return estimate

    # ------------------------------------------------------------------------------ records

    def _record(
        self,
        *,
        request_id: str,
        user_ref: str,
        requested_model: str,
        served_model: str | None,
        provider: str,
        provider_request_id: str | None,
        started: dt.datetime,
        status: InvocationStatus,
        error_class: AiErrorCode | None,
        cost: float,
        attempts: int,
        is_mock: bool,
        audio_seconds: float | None = None,
        characters: int | None = None,
    ) -> None:
        emit_speech_record(
            self._sink,
            ModelInvocationRecord(
                id=uuid.uuid4().hex,
                trace_id=current_trace_id(),
                user_id_hash=user_ref,
                task_id=None,
                route_tier="AUDIO",
                task_route=None,
                selection="auto",
                gateway_request_id=provider_request_id,
                requested_model=requested_model,
                served_model=served_model,
                served_provider=provider,
                prompt_version=None,
                started_at=started,
                first_token_at=None,
                finished_at=self._clock(),
                status=status,
                error_class=error_class,
                input_tokens=None,
                output_tokens=None,
                cached_tokens=None,
                reasoning_tokens=None,
                estimated_cost_usd=cost,
                final_cost_usd=None,
                gateway_reported_cost_usd=None,
                consent_policy_id=None,
                data_residency_policy_id=None,
                retry_chain_id=request_id,
                attempts=attempts,
                is_mock=is_mock,
                audio_seconds=audio_seconds,
                characters=characters,
            ),
        )


def emit_speech_record(sink: InvocationSink, record: ModelInvocationRecord) -> None:
    try:
        sink.emit(record)
    except Exception:
        _logger.exception("invocation_sink_failed")
