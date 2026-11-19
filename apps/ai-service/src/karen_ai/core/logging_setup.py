"""Structured JSON logging (stdlib only).

Every line carries ``request_id``, ``user_ref`` (already pseudonymous) and ``task_id`` from the
request context, plus ``trace_id``/``span_id`` when an OpenTelemetry span is active. Messages and
extra fields pass through the redaction utility. Prompt/response content is never logged.
"""

from __future__ import annotations

import datetime as dt
import json
import logging
import sys
from typing import Any, Final

from opentelemetry import trace

from karen_ai.core.context import request_id_var, task_id_var, user_ref_var
from karen_ai.core.redaction import redact_mapping, redact_text

FIELDS_ATTR: Final = "karen_fields"


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": dt.datetime.fromtimestamp(record.created, tz=dt.UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "msg": redact_text(record.getMessage()),
            "request_id": request_id_var.get(),
            "user_ref": user_ref_var.get(),
            "task_id": task_id_var.get(),
        }
        span_context = trace.get_current_span().get_span_context()
        if span_context.is_valid:
            payload["trace_id"] = format(span_context.trace_id, "032x")
            payload["span_id"] = format(span_context.span_id, "016x")
        fields = getattr(record, FIELDS_ATTR, None)
        if isinstance(fields, dict):
            payload["fields"] = redact_mapping(fields)
        if record.exc_info and record.exc_info[0] is not None:
            # Exception type only: messages/tracebacks may contain request content.
            payload["exc_type"] = record.exc_info[0].__name__
        return json.dumps(payload, default=str, ensure_ascii=False)


def configure_logging(level: str) -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level)
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logger = logging.getLogger(name)
        logger.handlers.clear()
        logger.propagate = True


def log_fields(**fields: object) -> dict[str, object]:
    """``logger.info("event", extra=log_fields(key=value))``."""
    return {FIELDS_ATTR: fields}
