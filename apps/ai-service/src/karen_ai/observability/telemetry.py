"""Optional OpenTelemetry and Sentry activation. Missing configuration never fails startup.

Langfuse is intentionally not a dependency: its integration point is an ``InvocationSink``
(``karen_ai.observability.invocations``) that forwards metadata-only records. If Langfuse keys
are configured, startup logs that the integration is not implemented instead of failing.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from fastapi import FastAPI

from karen_ai.core.settings import Settings

_logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class TelemetryStatus:
    otel_enabled: bool
    sentry_enabled: bool
    langfuse_configured: bool


def setup_telemetry(app: FastAPI, settings: Settings) -> TelemetryStatus:
    otel = _setup_otel(app, settings)
    sentry = _setup_sentry(settings)
    langfuse = settings.langfuse_public_key is not None and settings.langfuse_secret_key is not None
    if langfuse:
        _logger.warning("Langfuse keys are set but no Langfuse sink is implemented; keys ignored")
    return TelemetryStatus(otel_enabled=otel, sentry_enabled=sentry, langfuse_configured=langfuse)


def _setup_otel(app: FastAPI, settings: Settings) -> bool:
    if not settings.otel_exporter_otlp_endpoint:
        return False
    try:
        from opentelemetry import trace
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor

        provider = TracerProvider(resource=Resource.create({"service.name": settings.otel_service_name}))
        endpoint = settings.otel_exporter_otlp_endpoint.rstrip("/") + "/v1/traces"
        provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint=endpoint)))
        trace.set_tracer_provider(provider)
        FastAPIInstrumentor.instrument_app(app, tracer_provider=provider, excluded_urls="health/.*")
    except Exception:
        _logger.exception("OpenTelemetry setup failed; continuing without tracing")
        return False
    return True


def _setup_sentry(settings: Settings) -> bool:
    if settings.sentry_dsn is None:
        return False
    try:
        import sentry_sdk

        sentry_sdk.init(
            dsn=settings.sentry_dsn.get_secret_value(),
            environment=settings.app_env,
            send_default_pii=False,
            traces_sample_rate=0.0,
            include_local_variables=False,
            max_request_body_size="never",
        )
    except Exception:
        _logger.exception("Sentry setup failed; continuing without error reporting")
        return False
    return True
