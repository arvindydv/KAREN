"""Optional Sentry and OpenTelemetry activation. Missing configuration never fails startup."""

from __future__ import annotations

import logging

from karen_voice.settings import VoiceSettings

_logger = logging.getLogger(__name__)


def setup_observability(settings: VoiceSettings) -> None:
    if settings.sentry_dsn is not None:
        try:
            import sentry_sdk

            sentry_sdk.init(
                dsn=settings.sentry_dsn.get_secret_value(),
                environment=settings.app_env,
                send_default_pii=False,
                traces_sample_rate=0.0,
                include_local_variables=False,
            )
        except Exception:
            _logger.exception("Sentry setup failed; continuing without error reporting")
    if settings.otel_exporter_otlp_endpoint:
        try:
            from livekit.agents.telemetry import set_tracer_provider
            from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
            from opentelemetry.sdk.resources import Resource
            from opentelemetry.sdk.trace import TracerProvider
            from opentelemetry.sdk.trace.export import BatchSpanProcessor

            provider = TracerProvider(resource=Resource.create({"service.name": settings.otel_service_name}))
            endpoint = settings.otel_exporter_otlp_endpoint.rstrip("/") + "/v1/traces"
            provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint=endpoint)))
            # allow_pii=False: never export transcripts/conversation content to our exporters.
            set_tracer_provider(provider, allow_pii=False)
        except Exception:
            _logger.exception("OpenTelemetry setup failed; continuing without tracing")
