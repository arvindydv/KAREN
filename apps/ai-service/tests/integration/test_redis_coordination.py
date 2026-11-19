"""Integration tests against a REAL Redis (``pnpm infra:up``; run with ``pytest -m integration``).

They prove the properties ADR-0013 relies on: budget reservation is atomic across replicas,
an unreachable store fails closed, and signatures cannot be replayed across replicas.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import os
import uuid
from collections.abc import AsyncIterator

import pytest
from redis.asyncio import Redis

from karen_ai.core.errors import KarenAIError
from karen_ai.core.redis_store import create_redis
from karen_ai.core.replay_guard import RedisSignatureReplayGuard
from karen_ai.policies.budget import RedisDailyBudgetTracker

pytestmark = pytest.mark.integration

REDIS_URL = os.environ.get("KAREN_TEST_REDIS_URL", "redis://localhost:6390/2")
DAY = dt.datetime(2026, 11, 20, 12, tzinfo=dt.UTC)


@pytest.fixture
async def redis() -> AsyncIterator[Redis]:
    client = create_redis(REDIS_URL)
    yield client
    await client.aclose()


@pytest.fixture
def prefix() -> str:
    return f"karen:test:{uuid.uuid4().hex}"


async def test_budget_is_atomic_across_replicas(redis: Redis, prefix: str) -> None:
    # Two trackers on separate connections behave like two ai-service replicas.
    second = create_redis(REDIS_URL)
    try:
        replicas = [
            RedisDailyBudgetTracker(r, 1.0, clock=lambda: DAY, key_prefix=prefix) for r in (redis, second)
        ]

        results = await asyncio.gather(
            *(replicas[i % 2].reserve(0.1) for i in range(50)), return_exceptions=True
        )
        refused = [r for r in results if isinstance(r, KarenAIError)]
        assert all(r.code == "BUDGET_EXCEEDED" for r in refused)
        assert len(results) - len(refused) == 10  # exactly the budget, never N x budget
    finally:
        await second.aclose()


async def test_settle_release_and_day_rollover(redis: Redis, prefix: str) -> None:
    now = [DAY]
    tracker = RedisDailyBudgetTracker(redis, 1.0, clock=lambda: now[0], key_prefix=prefix)
    first = await tracker.reserve(0.6)
    with pytest.raises(KarenAIError, match="daily AI budget"):
        await tracker.reserve(0.5)
    await tracker.settle(first, 0.2)
    assert await tracker.spent_today() == pytest.approx(0.2)
    second = await tracker.reserve(0.5)
    await tracker.release(second)
    await tracker.settle(second, 0.9)  # already released: settling twice is a no-op
    assert await tracker.spent_today() == pytest.approx(0.2)
    now[0] = DAY + dt.timedelta(days=1)
    assert await tracker.spent_today() == 0.0
    await tracker.reserve(0.9)
    ttl = await redis.ttl(f"{prefix}:{now[0].date().isoformat()}")
    assert 0 < ttl <= 3 * 24 * 3600


async def test_budget_fails_closed_when_redis_is_unreachable() -> None:
    dead = create_redis("redis://127.0.0.1:1/0")
    try:
        tracker = RedisDailyBudgetTracker(dead, 100.0)
        with pytest.raises(KarenAIError) as info:
            await tracker.reserve(0.01)
        assert info.value.code == "CAPABILITY_UNAVAILABLE"
        assert info.value.retryable
    finally:
        await dead.aclose()


async def test_replay_guard_is_shared_and_expires(redis: Redis, prefix: str) -> None:
    second = create_redis(REDIS_URL)
    try:
        a, b = RedisSignatureReplayGuard(redis, prefix), RedisSignatureReplayGuard(second, prefix)
        assert await a.claim("sig-1", 1)
        assert not await b.claim("sig-1", 1)  # replay on another replica is refused
        await asyncio.sleep(1.1)
        assert await b.claim("sig-1", 1)
    finally:
        await second.aclose()


async def test_replay_guard_fails_closed() -> None:
    dead = create_redis("redis://127.0.0.1:1/0")
    try:
        with pytest.raises(KarenAIError) as info:
            await RedisSignatureReplayGuard(dead).claim("sig", 10)
        assert info.value.code == "CAPABILITY_UNAVAILABLE"
    finally:
        await dead.aclose()
