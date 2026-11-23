"""Pre-call cost estimation and spend caps (architecture §2.7, layers 1-2).

Gateway-side key credit limits (layer 3) are a backstop configured in OpenRouter, not here.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import logging
import math
import uuid
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Final, Protocol

from redis.asyncio import Redis
from redis.exceptions import RedisError

from karen_ai.contracts import ChatMessage, ModelCapability, Usage
from karen_ai.core.errors import KarenAIError
from karen_ai.core.logging_setup import log_fields
from karen_ai.core.redis_store import coordination_unavailable

_logger = logging.getLogger(__name__)

# Conservative heuristic: 1 token per 3 UTF-8 bytes (over-counts English, closer for Devanagari)
# plus a fixed per-message framing overhead. Only used for pre-call budget checks.
_BYTES_PER_TOKEN: Final = 3
_MESSAGE_OVERHEAD_TOKENS: Final = 4


# Conservative per-image allowance for pre-call checks (providers tokenise images differently;
# a high-detail image is typically well under this). Not a billing figure.
IMAGE_TOKENS_ESTIMATE: Final = 2_000


def estimate_prompt_tokens(messages: Sequence[ChatMessage]) -> int:
    return sum(
        math.ceil(len(m.content.encode()) / _BYTES_PER_TOKEN)
        + _MESSAGE_OVERHEAD_TOKENS
        + IMAGE_TOKENS_ESTIMATE * len(m.images or ())
        for m in messages
    )


def cost_usd(model: ModelCapability, input_tokens: int, output_tokens: int) -> float:
    return (
        input_tokens / 1_000_000 * model.input_usd_per_million_tokens
        + output_tokens / 1_000_000 * model.output_usd_per_million_tokens
    )


def worst_case_cost_usd(
    candidates: Sequence[ModelCapability], input_tokens: int, max_output_tokens: int
) -> float:
    """Upper bound across the primary and any gateway fallback that might serve the request."""
    return max(cost_usd(m, input_tokens, max_output_tokens) for m in candidates)


def usage_cost_usd(model: ModelCapability | None, usage: Usage) -> float | None:
    """Cost from reported usage. ``None`` when usage was not reported: never invent numbers."""
    if model is None or usage.input_tokens is None or usage.output_tokens is None:
        return None
    return cost_usd(model, usage.input_tokens, usage.output_tokens)


@dataclass(frozen=True)
class Reservation:
    id: str
    day: dt.date
    amount_usd: float


class DailyBudgetTracker(Protocol):
    """Service-wide daily spend guard.

    Implementations must be atomic across all replicas to be meaningful in production.
    """

    async def reserve(self, amount_usd: float) -> Reservation: ...

    async def settle(self, reservation: Reservation, actual_usd: float) -> None: ...

    async def release(self, reservation: Reservation) -> None: ...

    async def spent_today(self) -> float: ...


class InMemoryDailyBudgetTracker:
    """Single-process tracker for local/test ONLY.

    With N replicas it would allow up to N x the configured daily budget and it resets on
    restart, so settings refuse it in dev/staging/production (use ``RedisDailyBudgetTracker``).
    """

    def __init__(self, daily_budget_usd: float, clock: Callable[[], dt.datetime] | None = None) -> None:
        self._limit = daily_budget_usd
        self._clock = clock or (lambda: dt.datetime.now(dt.UTC))
        self._lock = asyncio.Lock()
        self._day = self._today()
        self._committed = 0.0
        self._reserved: dict[str, float] = {}

    def _today(self) -> dt.date:
        return self._clock().astimezone(dt.UTC).date()

    def _roll_day(self) -> None:
        today = self._today()
        if today != self._day:
            self._day, self._committed, self._reserved = today, 0.0, {}

    async def reserve(self, amount_usd: float) -> Reservation:
        async with self._lock:
            self._roll_day()
            if self._committed + sum(self._reserved.values()) + amount_usd > self._limit:
                raise KarenAIError(
                    "BUDGET_EXCEEDED", "Request would exceed the daily AI budget.", retryable=False
                )
            reservation = Reservation(id=uuid.uuid4().hex, day=self._day, amount_usd=amount_usd)
            self._reserved[reservation.id] = amount_usd
            return reservation

    async def settle(self, reservation: Reservation, actual_usd: float) -> None:
        async with self._lock:
            self._roll_day()
            if reservation.day == self._day and self._reserved.pop(reservation.id, None) is not None:
                self._committed += actual_usd

    async def release(self, reservation: Reservation) -> None:
        async with self._lock:
            self._reserved.pop(reservation.id, None)

    async def spent_today(self) -> float:
        async with self._lock:
            self._roll_day()
            return self._committed


# Amounts are stored as integer micro-USD so Redis arithmetic is exact (no float drift).
_MICRO: Final = 1_000_000
_KEY_TTL_SECONDS: Final = 3 * 24 * 3600

# KEYS[1]=day hash; ARGV: amount_micro, limit_micro, reservation_id, ttl
_RESERVE_LUA: Final = """
local committed = tonumber(redis.call('HGET', KEYS[1], 'committed') or '0')
local reserved = tonumber(redis.call('HGET', KEYS[1], 'reserved') or '0')
local amount = tonumber(ARGV[1])
if committed + reserved + amount > tonumber(ARGV[2]) then return 0 end
redis.call('HSET', KEYS[1], 'r:' .. ARGV[3], amount)
redis.call('HINCRBY', KEYS[1], 'reserved', amount)
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[4]))
return 1
"""

# KEYS[1]=day hash; ARGV: reservation_id, actual_micro (or -1 to release without spend)
_SETTLE_LUA: Final = """
local amount = redis.call('HGET', KEYS[1], 'r:' .. ARGV[1])
if not amount then return 0 end
redis.call('HDEL', KEYS[1], 'r:' .. ARGV[1])
redis.call('HINCRBY', KEYS[1], 'reserved', -tonumber(amount))
local actual = tonumber(ARGV[2])
if actual >= 0 then redis.call('HINCRBY', KEYS[1], 'committed', actual) end
return 1
"""


def _to_micro(amount_usd: float) -> int:
    # Round UP: the guard must never under-count spend.
    return max(0, math.ceil(amount_usd * _MICRO))


class RedisDailyBudgetTracker:
    """Service-wide daily spend guard shared by every ai-service replica (ADR-0013).

    Reserve/settle/release are single Lua scripts, so check-and-reserve is atomic across
    replicas. Per-UTC-day hash ``karen:ai:budget:<date>`` holds ``committed``, ``reserved`` and
    one ``r:<id>`` field per in-flight reservation; it expires after a few days.

    Failure behaviour is FAIL CLOSED: if Redis is unreachable no reservation is granted and the
    request is refused before any gateway call. A reservation whose process dies before
    settling stays counted as reserved for that day (over-counts, never under-counts).
    """

    def __init__(
        self,
        redis: Redis,
        daily_budget_usd: float,
        clock: Callable[[], dt.datetime] | None = None,
        key_prefix: str = "karen:ai:budget",
    ) -> None:
        self._redis = redis
        self._limit_micro = _to_micro(daily_budget_usd)
        self._clock = clock or (lambda: dt.datetime.now(dt.UTC))
        self._prefix = key_prefix
        self._reserve = redis.register_script(_RESERVE_LUA)
        self._settle = redis.register_script(_SETTLE_LUA)

    def _today(self) -> dt.date:
        return self._clock().astimezone(dt.UTC).date()

    def _key(self, day: dt.date) -> str:
        return f"{self._prefix}:{day.isoformat()}"

    async def reserve(self, amount_usd: float) -> Reservation:
        day = self._today()
        reservation = Reservation(id=uuid.uuid4().hex, day=day, amount_usd=amount_usd)
        try:
            granted = await self._reserve(
                keys=[self._key(day)],
                args=[_to_micro(amount_usd), self._limit_micro, reservation.id, _KEY_TTL_SECONDS],
            )
        except RedisError as exc:
            _logger.error("budget_store_unavailable", extra=log_fields(operation="reserve"))
            raise coordination_unavailable("AI budget enforcement") from exc
        if int(granted) != 1:
            raise KarenAIError(
                "BUDGET_EXCEEDED", "Request would exceed the daily AI budget.", retryable=False
            )
        return reservation

    async def _finish(self, reservation: Reservation, actual_micro: int, operation: str) -> None:
        try:
            await self._settle(keys=[self._key(reservation.day)], args=[reservation.id, actual_micro])
        except RedisError:
            # The reservation stays counted as "reserved" (conservative). The response is not
            # failed after the fact; operators are alerted via this error log.
            _logger.error(
                "budget_settle_failed",
                extra=log_fields(operation=operation, reservation_id=reservation.id),
            )

    async def settle(self, reservation: Reservation, actual_usd: float) -> None:
        await self._finish(reservation, _to_micro(actual_usd), "settle")

    async def release(self, reservation: Reservation) -> None:
        await self._finish(reservation, -1, "release")

    async def spent_today(self) -> float:
        try:
            committed = await self._redis.hget(self._key(self._today()), "committed")
        except RedisError as exc:
            raise coordination_unavailable("AI budget enforcement") from exc
        return int(committed or 0) / _MICRO


def budget_cap_usd(*, service_cap_usd: float, request_cap_usd: float | None) -> float:
    return service_cap_usd if request_cap_usd is None else min(service_cap_usd, request_cap_usd)


def check_request_budget(
    estimated_usd: float, *, service_cap_usd: float, request_cap_usd: float | None
) -> None:
    cap = budget_cap_usd(service_cap_usd=service_cap_usd, request_cap_usd=request_cap_usd)
    if estimated_usd > cap:
        raise KarenAIError(
            "BUDGET_EXCEEDED",
            "Estimated request cost exceeds the per-request budget.",
            retryable=False,
        )
