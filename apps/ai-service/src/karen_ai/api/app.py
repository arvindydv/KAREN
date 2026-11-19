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
from karen_ai.gateway.mock import MockGatewayClient
from karen_ai.gateway.vercel import VercelGatewayClient
from karen_ai.model_router.router import ModelRouter
from karen_ai.model_router.service import CompletionService, ServiceLimits
from karen_ai.observability.invocations import InvocationSink, LoggingInvocationSink
from karen_ai.observability.telemetry import setup_telemetry
from karen_ai.policies.budget import (
    DailyBudgetTracker,
    InMemoryDailyBudgetTracker,
    RedisDailyBudgetTracker,
)

_logger = logging.getLogger(__name__)


def build_gateway(settings: Settings) -> GatewayClient:
    if settings.is_mock:
        return MockGatewayClient()
    if settings.ai_gateway_api_key is None:  # pragma: no cover - enforced by settings validation
        raise RuntimeError("live gateway mode without AI_GATEWAY_API_KEY")
    return VercelGatewayClient(
        base_url=settings.ai_gateway_base_url,
        api_key=settings.ai_gateway_api_key,
        timeout_seconds=settings.karen_ai_request_timeout_seconds,
        max_retries=settings.karen_ai_max_retries,
    )


def build_completion_service(
    settings: Settings,
    *,
    gateway: GatewayClient | None = None,
    budget: DailyBudgetTracker | None = None,
    sink: InvocationSink | None = None,
    redis: Redis | None = None,
) -> CompletionService:
    if budget is None:
        if settings.budget_store == "redis":
            if redis is None:  # pragma: no cover - create_app always passes it
                raise RuntimeError("redis budget store requires a Redis connection")
            budget = RedisDailyBudgetTracker(redis, settings.karen_ai_daily_budget_usd)
        else:
            budget = InMemoryDailyBudgetTracker(settings.karen_ai_daily_budget_usd)
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
) -> FastAPI:
    settings = settings or Settings()
    configure_logging(settings.log_level)
    redis_url = settings.redis_connection_url
    # Connections are lazy: nothing is opened until the first budget/replay operation.
    needs_redis = (budget is None and settings.budget_store == "redis") or replay_guard is None
    redis = create_redis(redis_url) if redis_url is not None and needs_redis else None
    completions = build_completion_service(settings, gateway=gateway, budget=budget, sink=sink, redis=redis)
    if replay_guard is None:
        replay_guard = (
            RedisSignatureReplayGuard(redis) if redis is not None else InMemorySignatureReplayGuard()
        )

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        yield
        await completions.gateway.aclose()
        if redis is not None:
            await redis.aclose()

    app = FastAPI(title="KAREN AI service", version="0.1.0", lifespan=lifespan, docs_url=None, redoc_url=None)
    app.state.container = ServiceContainer(
        settings=settings, completions=completions, replay_guard=replay_guard
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
            budget_store=settings.budget_store,
            otel=telemetry.otel_enabled,
            sentry=telemetry.sentry_enabled,
        ),
    )
    return app
