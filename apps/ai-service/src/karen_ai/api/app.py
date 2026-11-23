"""FastAPI application factory."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from redis.asyncio import Redis

from karen_ai.api.dependencies import ServiceContainer
from karen_ai.api.errors import install_error_handlers
from karen_ai.api.middleware import RequestContextMiddleware
from karen_ai.api.routes import health_router, internal_router
from karen_ai.core.logging_setup import configure_logging, log_fields
from karen_ai.core.redis_store import create_redis
from karen_ai.core.replay_guard import (
    InMemorySignatureReplayGuard,
    RedisSignatureReplayGuard,
    SignatureReplayGuard,
)
from karen_ai.core.settings import Settings
from karen_ai.gateway.base import GatewayClient
from karen_ai.gateway.mock import MockGatewayClient, chat_responder
from karen_ai.gateway.openrouter import OpenRouterGatewayClient, ProviderPreferences
from karen_ai.model_router.router import ModelRouter
from karen_ai.model_router.service import CompletionService, ServiceLimits
from karen_ai.observability.invocations import InvocationSink, LoggingInvocationSink
from karen_ai.observability.telemetry import setup_telemetry
from karen_ai.policies.budget import (
    DailyBudgetTracker,
    InMemoryDailyBudgetTracker,
    RedisDailyBudgetTracker,
)
from karen_ai.speech.base import LiveTranscriber, SpeechToTextProvider, TextToSpeechProvider
from karen_ai.speech.deepgram import DeepgramSpeechClient
from karen_ai.speech.live import (
    InMemoryLiveSessionBus,
    LiveSessionBus,
    LiveSessionService,
    RedisLiveSessionBus,
)
from karen_ai.speech.mock import MockLiveTranscriber, MockSpeechToText, MockTextToSpeech
from karen_ai.speech.openrouter import OpenRouterAudioClient
from karen_ai.speech.service import SpeechLimits, SpeechRouting, SpeechService

_logger = logging.getLogger(__name__)


def build_gateway(settings: Settings) -> GatewayClient:
    if settings.is_mock:
        # Labelled chat replies + test scenario directives; mock mode is local/test/dev only.
        return MockGatewayClient(responder=chat_responder, scenarios=True)
    if settings.openrouter_api_key is None:  # pragma: no cover - enforced by settings validation
        raise RuntimeError("live gateway mode without OPENROUTER_API_KEY")
    return OpenRouterGatewayClient(
        base_url=settings.openrouter_base_url,
        api_key=settings.openrouter_api_key,
        timeout_seconds=settings.karen_ai_request_timeout_seconds,
        max_retries=settings.karen_ai_max_retries,
        provider=provider_preferences(settings),
    )


def provider_preferences(settings: Settings) -> ProviderPreferences:
    return ProviderPreferences(
        data_collection=settings.openrouter_data_collection, zdr=settings.openrouter_zdr
    )


SpeechProviders = tuple[SpeechToTextProvider, TextToSpeechProvider]


def build_speech_providers(
    settings: Settings,
) -> tuple[SpeechToTextProvider, TextToSpeechProvider, LiveTranscriber | None]:
    """One client per provider (shared between STT and TTS when both use it)."""
    deepgram: DeepgramSpeechClient | None = None
    openrouter: OpenRouterAudioClient | None = None

    def get_deepgram() -> DeepgramSpeechClient:
        nonlocal deepgram
        if settings.deepgram_api_key is None:  # pragma: no cover - enforced by settings validation
            raise RuntimeError("deepgram speech provider without DEEPGRAM_API_KEY")
        deepgram = deepgram or DeepgramSpeechClient(
            api_key=settings.deepgram_api_key,
            region=settings.deepgram_region,
            timeout_seconds=settings.karen_voice_timeout_seconds,
            max_retries=settings.karen_ai_max_retries,
            mip_opt_out=settings.deepgram_mip_opt_out,
            eot_threshold=settings.deepgram_eot_threshold,
            eot_timeout_ms=settings.deepgram_eot_timeout_ms,
        )
        return deepgram

    def get_openrouter() -> OpenRouterAudioClient:
        nonlocal openrouter
        if settings.openrouter_api_key is None:  # pragma: no cover - enforced by settings validation
            raise RuntimeError("openrouter speech provider without OPENROUTER_API_KEY")
        openrouter = openrouter or OpenRouterAudioClient(
            base_url=settings.openrouter_base_url,
            api_key=settings.openrouter_api_key,
            timeout_seconds=settings.karen_voice_timeout_seconds,
            max_retries=settings.karen_ai_max_retries,
            provider=provider_preferences(settings),
        )
        return openrouter

    stt: SpeechToTextProvider
    tts: TextToSpeechProvider
    live: LiveTranscriber | None
    match settings.stt_provider:
        case "mock":
            stt, live = MockSpeechToText(), MockLiveTranscriber()
        case "deepgram":
            client = get_deepgram()
            stt, live = client, client
        case "openrouter":
            stt, live = get_openrouter(), None  # no streaming STT documented for OpenRouter
    match settings.tts_provider:
        case "mock":
            tts = MockTextToSpeech()
        case "deepgram":
            tts = get_deepgram()
        case "openrouter":
            tts = get_openrouter()
    return stt, tts, live


def speech_routing(settings: Settings) -> SpeechRouting:
    restrict = settings.tts_voice_models()
    voices = tuple(
        v
        for v in settings.voice_catalog.usable_voices(
            require_verified=settings.tts_provider != "mock", provider=settings.tts_provider
        )
        if restrict is None or v.model_id in restrict
    )
    return SpeechRouting(
        stt_provider=settings.stt_provider,
        tts_provider=settings.tts_provider,
        batch_models=settings.stt_models("batch"),
        voices=voices,
        live_models=settings.stt_models("live"),
        live_enabled=settings.karen_feature_voice_live_enabled,
    )


def build_speech_service(
    settings: Settings,
    *,
    budget: DailyBudgetTracker,
    sink: InvocationSink,
    providers: SpeechProviders | None = None,
) -> SpeechService | None:
    if not settings.karen_feature_voice_enabled:
        return None
    stt, tts = providers or build_speech_providers(settings)[:2]
    return SpeechService(
        stt=stt,
        tts=tts,
        catalog=settings.voice_catalog,
        routing=speech_routing(settings),
        budget=budget,
        sink=sink,
        limits=SpeechLimits(
            stt_reserve_usd=settings.karen_voice_stt_reserve_usd,
            tts_reserve_usd=settings.karen_voice_tts_reserve_usd,
            max_request_cost_usd=settings.karen_ai_max_request_cost_usd,
            max_speech_chars=settings.karen_voice_max_speech_chars,
        ),
    )


def build_live_service(
    settings: Settings,
    speech: SpeechService | None,
    *,
    transcriber: LiveTranscriber | None,
    redis: Redis | None,
    bus: LiveSessionBus | None = None,
) -> LiveSessionService | None:
    if speech is None or not settings.karen_feature_voice_live_enabled or transcriber is None:
        return None
    if not transcriber.is_mock and not speech.routing.live_models:
        return None
    if bus is None:
        # Deployed replicas share sessions through Redis; local/test may use one process.
        bus = (
            RedisLiveSessionBus(redis)
            if settings.budget_store == "redis" and redis
            else InMemoryLiveSessionBus()
        )
    return LiveSessionService(
        transcriber=transcriber,
        speech=speech,
        bus=bus,
        models=speech.routing.live_models,
        max_seconds=settings.karen_voice_live_max_seconds,
        idle_seconds=settings.karen_voice_live_idle_seconds,
    )


def build_budget(settings: Settings, redis: Redis | None) -> DailyBudgetTracker:
    if settings.budget_store == "redis":
        if redis is None:  # pragma: no cover - create_app always passes it
            raise RuntimeError("redis budget store requires a Redis connection")
        return RedisDailyBudgetTracker(redis, settings.karen_ai_daily_budget_usd)
    return InMemoryDailyBudgetTracker(settings.karen_ai_daily_budget_usd)


def build_completion_service(
    settings: Settings,
    *,
    gateway: GatewayClient | None = None,
    budget: DailyBudgetTracker | None = None,
    sink: InvocationSink | None = None,
    redis: Redis | None = None,
) -> CompletionService:
    if budget is None:
        budget = build_budget(settings, redis)
    return CompletionService(
        router=ModelRouter.from_settings(settings),
        gateway=gateway or build_gateway(settings),
        budget=budget,
        sink=sink or LoggingInvocationSink(),
        limits=ServiceLimits(
            max_output_tokens=settings.karen_ai_max_output_tokens,
            max_request_cost_usd=settings.karen_ai_max_request_cost_usd,
        ),
    )


def create_app(
    settings: Settings | None = None,
    *,
    gateway: GatewayClient | None = None,
    budget: DailyBudgetTracker | None = None,
    sink: InvocationSink | None = None,
    replay_guard: SignatureReplayGuard | None = None,
    speech_providers: SpeechProviders | None = None,
    live_transcriber: LiveTranscriber | None = None,
    live_bus: LiveSessionBus | None = None,
) -> FastAPI:
    settings = settings or Settings()
    configure_logging(settings.log_level)
    redis_url = settings.redis_connection_url
    # Connections are lazy: nothing is opened until the first budget/replay operation.
    needs_redis = (budget is None and settings.budget_store == "redis") or replay_guard is None
    redis = create_redis(redis_url) if redis_url is not None and needs_redis else None
    # One service-wide daily budget and one record sink for text and speech.
    budget = budget or build_budget(settings, redis)
    sink = sink or LoggingInvocationSink()
    completions = build_completion_service(settings, gateway=gateway, budget=budget, sink=sink, redis=redis)
    built = (
        None
        if not settings.karen_feature_voice_enabled or (speech_providers and live_transcriber)
        else build_speech_providers(settings)
    )
    providers = speech_providers or (built[:2] if built else None)
    speech = build_speech_service(settings, budget=budget, sink=sink, providers=providers)
    transcriber = live_transcriber or (built[2] if built else None)
    live = build_live_service(settings, speech, transcriber=transcriber, redis=redis, bus=live_bus)
    if replay_guard is None:
        replay_guard = (
            RedisSignatureReplayGuard(redis) if redis is not None else InMemorySignatureReplayGuard()
        )

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        yield
        await completions.gateway.aclose()
        if live is not None:
            await live.aclose()
        if speech is not None:
            # One client may implement both protocols: close each object once.
            for provider in {id(p): p for p in (speech.stt, speech.tts)}.values():
                await provider.aclose()
        if redis is not None:
            await redis.aclose()

    app = FastAPI(title="KAREN AI service", version="0.1.0", lifespan=lifespan, docs_url=None, redoc_url=None)
    app.state.container = ServiceContainer(
        settings=settings, completions=completions, replay_guard=replay_guard, speech=speech, live=live
    )
    app.add_middleware(RequestContextMiddleware)
    install_error_handlers(app)
    app.include_router(health_router)
    app.include_router(internal_router)
    telemetry = setup_telemetry(app, settings)
    if not settings.signature_required:
        _logger.warning("internal signature verification DISABLED (no secret, APP_ENV=%s)", settings.app_env)
    _logger.info(
        "ai_service_configured",
        extra=log_fields(
            app_env=settings.app_env,
            gateway_mode=settings.karen_ai_gateway_mode,
            gateway="openrouter" if not settings.is_mock else "mock",
            provider_data_collection=settings.openrouter_data_collection,
            provider_zdr=settings.openrouter_zdr,
            budget_store=settings.budget_store,
            voice_enabled=speech is not None,
            voice_stt_provider=settings.stt_provider,
            voice_tts_provider=settings.tts_provider,
            voice_live_enabled=live is not None,
            otel=telemetry.otel_enabled,
            sentry=telemetry.sentry_enabled,
        ),
    )
    return app
