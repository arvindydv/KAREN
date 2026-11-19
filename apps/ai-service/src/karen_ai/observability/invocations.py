"""``model_invocations`` audit records (architecture §2.6) and pluggable sinks.

Records carry metadata only, never prompt or response content. Fields the gateway did not
report stay ``None``. ``final_cost_usd`` is always ``None`` here: it is filled by periodic
reconciliation against Vercel gateway usage reports, not by this service.
"""

from __future__ import annotations

import datetime as dt
import logging
from typing import Literal, Protocol

from pydantic import BaseModel, ConfigDict

from karen_ai.contracts import AiErrorCode, RouteTier
from karen_ai.core.logging_setup import log_fields

InvocationStatus = Literal["succeeded", "failed", "cancelled"]

_logger = logging.getLogger("karen_ai.model_invocations")


class ModelInvocationRecord(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str
    trace_id: str | None
    user_id_hash: str
    task_id: str | None
    route_tier: RouteTier
    gateway_request_id: str | None
    requested_model: str
    served_model: str | None
    served_provider: str | None
    prompt_version: str | None
    started_at: dt.datetime
    first_token_at: dt.datetime | None
    finished_at: dt.datetime
    status: InvocationStatus
    error_class: AiErrorCode | None
    input_tokens: int | None
    output_tokens: int | None
    cached_tokens: int | None
    reasoning_tokens: int | None
    estimated_cost_usd: float | None
    final_cost_usd: float | None
    consent_policy_id: str | None
    data_residency_policy_id: str | None
    retry_chain_id: str
    # Not in the §2.6 column list but needed for honest reconciliation:
    attempts: int
    is_mock: bool


class InvocationSink(Protocol):
    """Destination for invocation records (Postgres ledger, Langfuse, analytics...)."""

    def emit(self, record: ModelInvocationRecord) -> None: ...


class LoggingInvocationSink:
    """Default sink: one structured metadata-only log line per invocation."""

    def emit(self, record: ModelInvocationRecord) -> None:
        _logger.info("model_invocation", extra=log_fields(**record.model_dump(mode="json")))


class InMemoryInvocationSink:
    def __init__(self) -> None:
        self.records: list[ModelInvocationRecord] = []

    def emit(self, record: ModelInvocationRecord) -> None:
        self.records.append(record)
