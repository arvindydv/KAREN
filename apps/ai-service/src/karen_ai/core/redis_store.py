"""Shared Redis connection for cross-replica coordination (ADR-0013).

Redis holds only ephemeral coordination state here (daily AI spend counters, internal-auth
replay markers); it is never the system of record. Timeouts are short so an outage surfaces as
a fast, typed refusal instead of hanging requests.
"""

from __future__ import annotations

from typing import Final

from redis.asyncio import Redis

from karen_ai.core.errors import KarenAIError

_TIMEOUT_SECONDS: Final = 2.0


def create_redis(url: str) -> Redis:
    return Redis.from_url(
        url,
        socket_timeout=_TIMEOUT_SECONDS,
        socket_connect_timeout=_TIMEOUT_SECONDS,
        retry_on_timeout=False,
        health_check_interval=30,
    )


def coordination_unavailable(what: str) -> KarenAIError:
    """Fail-closed refusal used when the coordination store cannot be reached.

    Uses the existing contract code (503, retryable) rather than widening the wire contract.
    """
    return KarenAIError(
        "CAPABILITY_UNAVAILABLE",
        f"{what} is temporarily unavailable. Please retry shortly.",
        retryable=True,
    )
