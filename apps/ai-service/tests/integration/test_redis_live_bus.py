"""Live-session bus against a REAL Redis (``pnpm infra:up``; ``pytest -m integration``).

Proves what ADR-0027 relies on across replicas: chunks written through one connection reach the
pump on another in order, events can be resumed from a cursor, and keys expire.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import AsyncIterator

import pytest
from redis.asyncio import Redis

from karen_ai.core.redis_store import create_redis
from karen_ai.speech.live import LiveSessionMeta, RedisLiveSessionBus

pytestmark = pytest.mark.integration

REDIS_URL = os.environ.get("KAREN_TEST_REDIS_URL", "redis://localhost:6390/2")


@pytest.fixture
async def redis() -> AsyncIterator[Redis]:
    client = create_redis(REDIS_URL)
    yield client
    await client.aclose()


def meta(session_id: str) -> LiveSessionMeta:
    return LiveSessionMeta(
        session_id=session_id,
        user_ref="usr_hmac_test01",
        model="mock/stt",
        is_mock=True,
        max_seconds=60,
        idle_seconds=5,
    )


async def test_chunks_and_events_cross_replicas_in_order(redis: Redis) -> None:
    prefix = f"karen:test:{uuid.uuid4().hex}"
    other = create_redis(REDIS_URL)
    try:
        api_side, pump_side = RedisLiveSessionBus(redis, prefix), RedisLiveSessionBus(other, prefix)
        sid = f"lv_{uuid.uuid4().hex}"
        await api_side.create(meta(sid), ttl_seconds=60)
        assert await pump_side.get(sid) == meta(sid)
        for seq in range(3):
            await api_side.push_inbound(sid, seq, f"chunk-{seq}".encode(), ttl_seconds=60)
        items, cursor = await pump_side.read_inbound(sid, "", block_ms=200)
        assert items == [(0, b"chunk-0"), (1, b"chunk-1"), (2, b"chunk-2")]
        assert (await pump_side.read_inbound(sid, cursor, block_ms=50))[0] == []

        await pump_side.push_event(sid, {"type": "ready"}, ttl_seconds=60)
        await pump_side.push_event(sid, {"type": "partial", "turn_index": 0, "text": "नमस्ते"}, ttl_seconds=60)
        events, _ = await api_side.read_events(sid, "", block_ms=200)
        assert [e for _, e in events][1]["text"] == "नमस्ते"
        resumed, _ = await api_side.read_events(sid, events[0][0], block_ms=50)
        assert [e["type"] for _, e in resumed] == ["partial"]

        await api_side.expire(sid, 1)
        assert 0 < await redis.ttl(f"{prefix}:{sid}:ev") <= 1
    finally:
        await other.aclose()
