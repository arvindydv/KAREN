"""Replay protection for signed internal requests (ADR-0007 follow-up, ADR-0013).

The HMAC timestamp bounds replay to the tolerance window; this guard closes that window for
non-idempotent methods: each verified signature may be used exactly once. Legitimate callers
never resend a signature (every attempt is re-signed with a fresh timestamp, and request bodies
carry a unique ``request_id``).
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Callable
from typing import Final, Protocol

from redis.asyncio import Redis
from redis.exceptions import RedisError

from karen_ai.core.redis_store import coordination_unavailable

_MAX_MEMORY_ENTRIES: Final = 100_000


class SignatureReplayGuard(Protocol):
    async def claim(self, signature: str, ttl_seconds: int) -> bool:
        """True the first time ``signature`` is seen within ``ttl_seconds``; False on replay."""
        ...


class RedisSignatureReplayGuard:
    """Shared across replicas. FAILS CLOSED: an unreachable store refuses the request (503)."""

    def __init__(self, redis: Redis, key_prefix: str = "karen:internal-auth:seen") -> None:
        self._redis = redis
        self._prefix = key_prefix

    async def claim(self, signature: str, ttl_seconds: int) -> bool:
        try:
            created = await self._redis.set(f"{self._prefix}:{signature}", "1", ex=ttl_seconds, nx=True)
        except RedisError as exc:
            raise coordination_unavailable("Internal request verification") from exc
        return bool(created)


class InMemorySignatureReplayGuard:
    """Per-process guard for local/test (and the single-process default when no Redis exists)."""

    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._seen: dict[str, float] = {}
        self._clock = clock
        self._lock = asyncio.Lock()

    async def claim(self, signature: str, ttl_seconds: int) -> bool:
        async with self._lock:
            now = self._clock()
            if len(self._seen) >= _MAX_MEMORY_ENTRIES:
                self._seen = {k: exp for k, exp in self._seen.items() if exp > now}
            expires = self._seen.get(signature)
            if expires is not None and expires > now:
                return False
            self._seen[signature] = now + ttl_seconds
            return True
