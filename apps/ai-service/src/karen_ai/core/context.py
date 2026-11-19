"""Per-request correlation context propagated into JSON logs."""

from __future__ import annotations

from contextvars import ContextVar
from typing import Final

request_id_var: Final[ContextVar[str | None]] = ContextVar("request_id", default=None)
user_ref_var: Final[ContextVar[str | None]] = ContextVar("user_ref", default=None)
task_id_var: Final[ContextVar[str | None]] = ContextVar("task_id", default=None)
