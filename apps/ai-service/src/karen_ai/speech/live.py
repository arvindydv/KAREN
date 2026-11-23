"""Live voice sessions (ADR-0027): streamed audio in, partial/final transcripts out.

Why a bus: the browser cannot open a WebSocket through the BFF, and API / ai-service run as
several replicas. So the client streams small audio chunks over ordinary signed HTTP requests and
reads events over SSE; every chunk and event goes through a per-session bus (Redis Streams when
deployed, in-process locally). Exactly one replica — the one that opened the provider stream —
runs the session's pump: bus audio -> provider; provider events -> bus.

Guarantees:
- The provider key never leaves this process; clients never talk to the provider.
- Every session is owned by one ``user_ref``; another user's audio/events/close calls get the
  same NOT_FOUND as an unknown session.
- Spend: the worst case (``max_seconds`` of audio) is reserved before the provider is contacted
  and settled to the measured audio on close; a session ends by itself on idle or max duration.
- Duplicate or out-of-order chunks (client retries) are dropped by ``seq``.
- Audio is held only in the bus, briefly (stream entries expire); never stored or logged.
  Transcript text appears only in the event stream that the owning user reads.
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import contextlib
import datetime as dt
import hmac
import json
import logging
import time
import uuid
from collections.abc import AsyncIterator, Callable
from dataclasses import asdict, dataclass
from typing import Any, Final, Protocol

from redis.asyncio import Redis
from redis.exceptions import RedisError

from karen_ai.contracts import (
    CONTRACT_VERSION,
    MAX_LIVE_CHUNK_BYTES,
    AiErrorCode,
    LiveAudioChunk,
    LiveCloseReason,
    LiveSessionStartRequest,
    LiveSessionStartResponse,
    LiveSessionUsage,
    SpeechLanguage,
)
from karen_ai.core.errors import KarenAIError
from karen_ai.core.logging_setup import log_fields
from karen_ai.core.redis_store import coordination_unavailable
from karen_ai.gateway.base import GatewayError
from karen_ai.observability.invocations import InvocationStatus, ModelInvocationRecord
from karen_ai.policies.budget import Reservation
from karen_ai.speech.base import LiveConfig, LiveStream, LiveTranscriber, LiveTranscriptEvent
from karen_ai.speech.mock import MOCK_STT_MODEL
from karen_ai.speech.service import (
    SpeechService,
    current_trace_id,
    emit_speech_record,
    transcript_language,
    utcnow,
)

_logger = logging.getLogger(__name__)

CLOSE_SEQ: Final = -1
_READ_BLOCK_MS: Final = 500
_EVENT_BLOCK_MS: Final = 1000
_DRAIN_SECONDS: Final = 5.0
# Keep the event log readable for a short while after close (late SSE reconnects).
_AFTER_CLOSE_TTL_SECONDS: Final = 120
_STREAM_MAXLEN: Final = 4000
# Browser MediaRecorder timeslice: the last chunk's audio length when measuring streamed audio.
_CHUNK_SECONDS: Final = 0.25

Inbound = tuple[int, bytes]
EventItem = tuple[str, dict[str, Any]]


def language_hints(hint: SpeechLanguage | None) -> tuple[str, ...]:
    """Provider language hints: one language when known, else English + Hindi code-switching."""
    if hint == "en":
        return ("en",)
    if hint == "hi":
        return ("hi",)
    return ("en", "hi")


@dataclass(frozen=True)
class LiveSessionMeta:
    session_id: str
    user_ref: str
    model: str
    is_mock: bool
    max_seconds: int
    idle_seconds: int

    def dumps(self) -> str:
        return json.dumps(asdict(self), separators=(",", ":"))

    @classmethod
    def loads(cls, raw: str | bytes) -> LiveSessionMeta:
        data = json.loads(raw)
        return cls(
            session_id=str(data["session_id"]),
            user_ref=str(data["user_ref"]),
            model=str(data["model"]),
            is_mock=bool(data["is_mock"]),
            max_seconds=int(data["max_seconds"]),
            idle_seconds=int(data["idle_seconds"]),
        )


class LiveSessionBus(Protocol):
    async def create(self, meta: LiveSessionMeta, ttl_seconds: int) -> None: ...

    async def get(self, session_id: str) -> LiveSessionMeta | None: ...

    async def push_inbound(self, session_id: str, seq: int, data: bytes, ttl_seconds: int) -> None: ...

    async def read_inbound(
        self, session_id: str, cursor: str, block_ms: int
    ) -> tuple[list[Inbound], str]: ...

    async def push_event(self, session_id: str, payload: dict[str, Any], ttl_seconds: int) -> None: ...

    async def read_events(
        self, session_id: str, cursor: str, block_ms: int
    ) -> tuple[list[EventItem], str]: ...

    async def expire(self, session_id: str, ttl_seconds: int) -> None: ...


# ------------------------------------------------------------------------------ in-memory bus


@dataclass
class _MemorySession:
    meta: LiveSessionMeta
    inbound: list[Inbound]
    events: list[dict[str, Any]]
    changed: asyncio.Condition


class InMemoryLiveSessionBus:
    """Single-process bus for local development and tests (never when deployed)."""

    def __init__(self) -> None:
        self._sessions: dict[str, _MemorySession] = {}

    async def create(self, meta: LiveSessionMeta, ttl_seconds: int) -> None:
        self._sessions[meta.session_id] = _MemorySession(meta, [], [], asyncio.Condition())

    async def get(self, session_id: str) -> LiveSessionMeta | None:
        session = self._sessions.get(session_id)
        return session.meta if session else None

    async def push_inbound(self, session_id: str, seq: int, data: bytes, ttl_seconds: int) -> None:
        session = self._sessions.get(session_id)
        if session is None:
            return
        async with session.changed:
            session.inbound.append((seq, data))
            session.changed.notify_all()

    async def read_inbound(self, session_id: str, cursor: str, block_ms: int) -> tuple[list[Inbound], str]:
        session = self._sessions.get(session_id)
        if session is None:
            return [], cursor
        start = int(cursor or 0)
        async with session.changed:
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(
                    session.changed.wait_for(lambda: len(session.inbound) > start), block_ms / 1000
                )
            items = session.inbound[start:]
        return items, str(start + len(items))

    async def push_event(self, session_id: str, payload: dict[str, Any], ttl_seconds: int) -> None:
        session = self._sessions.get(session_id)
        if session is None:
            return
        async with session.changed:
            session.events.append(payload)
            session.changed.notify_all()

    async def read_events(self, session_id: str, cursor: str, block_ms: int) -> tuple[list[EventItem], str]:
        session = self._sessions.get(session_id)
        if session is None:
            return [], cursor
        start = int(cursor or 0)
        async with session.changed:
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(
                    session.changed.wait_for(lambda: len(session.events) > start), block_ms / 1000
                )
            items = session.events[start:]
        return [(str(start + i + 1), e) for i, e in enumerate(items)], str(start + len(items))

    async def expire(self, session_id: str, ttl_seconds: int) -> None:
        asyncio.get_running_loop().call_later(ttl_seconds, self._sessions.pop, session_id, None)


# --------------------------------------------------------------------------------- Redis bus


def _text(value: bytes | str) -> str:
    return value.decode() if isinstance(value, bytes) else value


class RedisLiveSessionBus:
    """Redis Streams bus shared by all ai-service replicas. Fails closed when Redis is down."""

    def __init__(self, redis: Redis, key_prefix: str = "karen:ai:live") -> None:
        self._redis = redis
        self._prefix = key_prefix

    def _key(self, session_id: str, part: str) -> str:
        return f"{self._prefix}:{session_id}:{part}"

    async def create(self, meta: LiveSessionMeta, ttl_seconds: int) -> None:
        try:
            created = await self._redis.set(
                self._key(meta.session_id, "meta"), meta.dumps(), ex=ttl_seconds, nx=True
            )
        except RedisError as exc:
            raise coordination_unavailable("Live voice") from exc
        if not created:  # pragma: no cover - 128-bit random IDs
            raise KarenAIError("INTERNAL_ERROR", "Live session ID collision.")

    async def get(self, session_id: str) -> LiveSessionMeta | None:
        try:
            raw = await self._redis.get(self._key(session_id, "meta"))
        except RedisError as exc:
            raise coordination_unavailable("Live voice") from exc
        return LiveSessionMeta.loads(raw) if raw is not None else None

    async def _append(self, key: str, fields: dict[str, bytes | str], ttl_seconds: int) -> None:
        try:
            async with self._redis.pipeline(transaction=False) as pipe:
                pipe.xadd(key, fields, maxlen=_STREAM_MAXLEN, approximate=True)  # type: ignore[arg-type]
                pipe.expire(key, ttl_seconds)
                await pipe.execute()
        except RedisError as exc:
            raise coordination_unavailable("Live voice") from exc

    async def _read(
        self, key: str, cursor: str, block_ms: int
    ) -> tuple[list[tuple[str, dict[bytes, bytes]]], str]:
        try:
            response: Any = await self._redis.xread({key: cursor or "0-0"}, count=200, block=block_ms)
        except RedisError as exc:
            raise coordination_unavailable("Live voice") from exc
        entries: list[tuple[str, dict[bytes, bytes]]] = []
        for _stream, items in response or []:
            for entry_id, fields in items:
                entries.append((_text(entry_id), fields))
        return entries, entries[-1][0] if entries else cursor

    async def push_inbound(self, session_id: str, seq: int, data: bytes, ttl_seconds: int) -> None:
        await self._append(self._key(session_id, "in"), {"s": str(seq), "d": data}, ttl_seconds)

    async def read_inbound(self, session_id: str, cursor: str, block_ms: int) -> tuple[list[Inbound], str]:
        entries, next_cursor = await self._read(self._key(session_id, "in"), cursor, block_ms)
        return [(int(_text(f[b"s"])), f.get(b"d", b"")) for _, f in entries], next_cursor

    async def push_event(self, session_id: str, payload: dict[str, Any], ttl_seconds: int) -> None:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        await self._append(self._key(session_id, "ev"), {"d": body}, ttl_seconds)

    async def read_events(self, session_id: str, cursor: str, block_ms: int) -> tuple[list[EventItem], str]:
        entries, next_cursor = await self._read(self._key(session_id, "ev"), cursor, block_ms)
        return [(entry_id, json.loads(f[b"d"])) for entry_id, f in entries], next_cursor

    async def expire(self, session_id: str, ttl_seconds: int) -> None:
        try:
            async with self._redis.pipeline(transaction=False) as pipe:
                for part in ("meta", "in", "ev"):
                    pipe.expire(self._key(session_id, part), ttl_seconds)
                await pipe.execute()
        except RedisError:
            _logger.warning("live_session_expire_failed")


# ---------------------------------------------------------------------------------- service


def wire_event(event: LiveTranscriptEvent) -> dict[str, Any] | None:
    """Public event payload (``liveEventSchema``)."""
    if event.kind == "ready":
        return {"type": "ready"}
    if event.kind == "speech_started":
        return {"type": "speech_started", "turn_index": event.turn_index}
    if event.kind == "partial":
        return {"type": "partial", "turn_index": event.turn_index, "text": event.text}
    if event.kind == "end_of_turn":
        return {
            "type": "end_of_turn",
            "turn_index": event.turn_index,
            "text": event.text,
            "language": transcript_language(event.text, event.language) if event.text else None,
        }
    if event.kind == "error":
        return {"type": "error", "code": event.error_code or "PROVIDER_ERROR", "retryable": True}
    return None


@dataclass
class _PumpState:
    provider_seconds: float = 0.0
    provider_request_id: str | None = None
    provider_failed: bool = False
    first_audio: float | None = None
    last_audio: float | None = None


class LiveSessionService:
    def __init__(
        self,
        *,
        transcriber: LiveTranscriber,
        speech: SpeechService,
        bus: LiveSessionBus,
        models: tuple[str, ...],
        max_seconds: int,
        idle_seconds: int,
        monotonic: Callable[[], float] = time.monotonic,
    ) -> None:
        self.transcriber = transcriber
        self._speech = speech
        self._bus = bus
        self._models = models
        self._max_seconds = max_seconds
        self._idle_seconds = idle_seconds
        self._monotonic = monotonic
        self._tasks: dict[str, asyncio.Task[None]] = {}

    @property
    def _ttl(self) -> int:
        return self._max_seconds + self._idle_seconds + _AFTER_CLOSE_TTL_SECONDS

    def _cost(self, model: str, seconds: float) -> float | None:
        entry = self._speech.catalog.stt_model(model)
        return entry.cost_usd(seconds / 60.0) if entry is not None else None

    def _reserve_amount(self, model: str) -> float:
        priced = self._cost(model, float(self._max_seconds))
        if priced is not None:
            return priced
        # Unpriced model: the per-request STT reservation for each started minute.
        return self._speech.limits.stt_reserve_usd * -(-self._max_seconds // 60)

    async def start(self, request: LiveSessionStartRequest) -> LiveSessionStartResponse:
        model = MOCK_STT_MODEL if self.transcriber.is_mock else (self._models[0] if self._models else None)
        if model is None:
            raise KarenAIError("CAPABILITY_UNAVAILABLE", "Live transcription is not available.")
        estimate = self._reserve_amount(model)
        reservation = await self._speech.reserve(estimate, request.max_cost_usd, "live_session")
        started = utcnow()
        try:
            stream = await self.transcriber.connect(
                LiveConfig(
                    request_id=request.request_id,
                    model=model,
                    language_hints=language_hints(request.language_hint),
                    audio_format=request.audio_format,
                )
            )
        except GatewayError as exc:
            await self._speech.budget.settle(reservation, 0.0)  # nothing was streamed
            self._record(
                user_ref=request.user_ref,
                request_id=request.request_id,
                model=model,
                started=started,
                status="failed",
                error_class=exc.code,
                cost=0.0,
                seconds=0.0,
                provider_request_id=None,
            )
            raise
        meta = LiveSessionMeta(
            session_id=f"lv_{uuid.uuid4().hex}{uuid.uuid4().hex[:8]}",
            user_ref=request.user_ref,
            model=model,
            is_mock=self.transcriber.is_mock,
            max_seconds=self._max_seconds,
            idle_seconds=self._idle_seconds,
        )
        try:
            await self._bus.create(meta, self._ttl)
        except Exception:
            await stream.abort()
            await self._speech.budget.settle(reservation, 0.0)
            raise
        task = asyncio.create_task(
            self._pump(
                meta=meta,
                stream=stream,
                reservation=reservation,
                estimate=estimate,
                request_id=request.request_id,
                started=started,
            ),
            name=f"live-session-{meta.session_id}",
        )
        self._tasks[meta.session_id] = task
        task.add_done_callback(lambda _t: self._tasks.pop(meta.session_id, None))
        _logger.info("live_session_started", extra=log_fields(model=model, is_mock=meta.is_mock))
        return LiveSessionStartResponse(
            contract_version=CONTRACT_VERSION,
            session_id=meta.session_id,
            served_model=model,
            is_mock=meta.is_mock,
            max_seconds=self._max_seconds,
            idle_seconds=self._idle_seconds,
            reserved_cost_usd=estimate,
        )

    async def _owned(self, session_id: str, user_ref: str) -> LiveSessionMeta:
        meta = await self._bus.get(session_id)
        if meta is None or not hmac.compare_digest(meta.user_ref.encode(), user_ref.encode()):
            raise KarenAIError("NOT_FOUND", "Live session not found.")
        return meta

    async def append_audio(self, session_id: str, chunk: LiveAudioChunk) -> None:
        await self._owned(session_id, chunk.user_ref)
        try:
            data = base64.b64decode(chunk.audio_base64, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise KarenAIError("VALIDATION_ERROR", "Audio is not valid base64.") from exc
        if not data or len(data) > MAX_LIVE_CHUNK_BYTES:
            raise KarenAIError("VALIDATION_ERROR", "Audio chunk is empty or too large.")
        await self._bus.push_inbound(session_id, chunk.seq, data, self._ttl)

    async def close(self, session_id: str, user_ref: str) -> None:
        await self._owned(session_id, user_ref)
        await self._bus.push_inbound(session_id, CLOSE_SEQ, b"", self._ttl)

    async def events(
        self, session_id: str, user_ref: str, after: str | None
    ) -> AsyncIterator[EventItem | None]:
        """Events after ``after``; ``None`` items are idle ticks (SSE heartbeats). Ends after ``closed``."""
        await self._owned(session_id, user_ref)
        return self._follow(session_id, after or "")

    async def _follow(self, session_id: str, cursor: str) -> AsyncIterator[EventItem | None]:
        while True:
            items, cursor = await self._bus.read_events(session_id, cursor, _EVENT_BLOCK_MS)
            if not items:
                if await self._bus.get(session_id) is None:
                    return  # expired: the session is long over
                yield None
                continue
            for item in items:
                yield item
                if item[1].get("type") == "closed":
                    return

    # ------------------------------------------------------------------------------ pump

    async def _pump(
        self,
        *,
        meta: LiveSessionMeta,
        stream: LiveStream,
        reservation: Reservation,
        estimate: float,
        request_id: str,
        started: dt.datetime,
    ) -> None:
        state = _PumpState()
        reason: LiveCloseReason = "client_closed"
        events_task = asyncio.create_task(self._forward_events(meta, stream, state))
        try:
            reason = await self._pump_audio(meta, stream, state, events_task)
            await stream.finish()
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(asyncio.shield(events_task), _DRAIN_SECONDS)
        except GatewayError:
            reason = "provider_error"
        except asyncio.CancelledError:
            reason = "shutdown"
            await stream.abort()
            raise
        except Exception:
            _logger.exception("live_session_pump_failed")
            reason = "provider_error"
            await stream.abort()
        finally:
            if not events_task.done():
                events_task.cancel()
            await self._finish(
                meta=meta,
                state=state,
                reason=reason,
                reservation=reservation,
                estimate=estimate,
                request_id=request_id,
                started=started,
            )

    async def _pump_audio(
        self, meta: LiveSessionMeta, stream: LiveStream, state: _PumpState, events_task: asyncio.Task[None]
    ) -> LiveCloseReason:
        cursor = ""
        last_seq = -1
        last_activity = self._monotonic()
        while True:
            if events_task.done():
                return "provider_error" if state.provider_failed else "client_closed"
            now = self._monotonic()
            if state.first_audio is not None and now - state.first_audio >= meta.max_seconds:
                return "max_duration"
            if now - last_activity >= meta.idle_seconds:
                return "idle_timeout"
            items, cursor = await self._bus.read_inbound(meta.session_id, cursor, _READ_BLOCK_MS)
            for seq, data in items:
                if seq == CLOSE_SEQ:
                    return "client_closed"
                if seq <= last_seq:
                    continue  # duplicate or out-of-order retry
                last_seq = seq
                last_activity = self._monotonic()
                state.first_audio = state.first_audio if state.first_audio is not None else last_activity
                state.last_audio = last_activity
                await stream.send_audio(data)

    async def _forward_events(self, meta: LiveSessionMeta, stream: LiveStream, state: _PumpState) -> None:
        async for event in stream.events():
            if event.provider_request_id:
                state.provider_request_id = event.provider_request_id
            if event.audio_seconds is not None:
                state.provider_seconds = max(state.provider_seconds, event.audio_seconds)
            payload = wire_event(event)
            if payload is not None:
                await self._bus.push_event(meta.session_id, payload, self._ttl)
            if event.kind == "error":
                state.provider_failed = True
                return

    async def _finish(
        self,
        *,
        meta: LiveSessionMeta,
        state: _PumpState,
        reason: LiveCloseReason,
        reservation: Reservation,
        estimate: float,
        request_id: str,
        started: dt.datetime,
    ) -> None:
        wall = 0.0
        if state.first_audio is not None and state.last_audio is not None:
            wall = state.last_audio - state.first_audio + _CHUNK_SECONDS
        # Billing is per streamed audio second; take the larger of provider-reported and measured.
        seconds = round(min(max(state.provider_seconds, wall), float(meta.max_seconds)), 3)
        priced = self._cost(meta.model, seconds)
        cost = 0.0 if meta.is_mock else min(priced if priced is not None else estimate, estimate)
        status: InvocationStatus = (
            "failed" if reason == "provider_error" else "cancelled" if reason == "shutdown" else "succeeded"
        )
        error_class: AiErrorCode | None = "GATEWAY_PROVIDER_ERROR" if reason == "provider_error" else None
        try:
            await self._speech.budget.settle(reservation, cost)
        except Exception:
            _logger.exception("live_session_settle_failed")
        self._record(
            user_ref=meta.user_ref,
            request_id=request_id,
            model=meta.model,
            started=started,
            status=status,
            error_class=error_class,
            cost=cost,
            seconds=seconds,
            provider_request_id=state.provider_request_id,
        )
        usage = LiveSessionUsage(
            session_id=meta.session_id,
            status=status,
            reason=reason,
            audio_seconds=seconds,
            estimated_cost_usd=cost,
            served_model=meta.model,
            provider_request_id=state.provider_request_id,
            is_mock=meta.is_mock,
        )
        try:
            await self._bus.push_event(
                meta.session_id, {"type": "closed", "usage": usage.model_dump(mode="json")}, self._ttl
            )
            await self._bus.expire(meta.session_id, _AFTER_CLOSE_TTL_SECONDS)
        except Exception:
            _logger.exception("live_session_close_event_failed")
        _logger.info(
            "live_session_closed",
            extra=log_fields(reason=reason, audio_seconds=seconds, estimated_cost_usd=cost, status=status),
        )

    def _record(
        self,
        *,
        user_ref: str,
        request_id: str,
        model: str,
        started: dt.datetime,
        status: InvocationStatus,
        error_class: AiErrorCode | None,
        cost: float,
        seconds: float,
        provider_request_id: str | None,
    ) -> None:
        emit_speech_record(
            self._speech.sink,
            ModelInvocationRecord(
                id=uuid.uuid4().hex,
                trace_id=current_trace_id(),
                user_id_hash=user_ref,
                task_id=None,
                route_tier="AUDIO",
                task_route=None,
                selection="auto",
                gateway_request_id=provider_request_id,
                requested_model=model,
                served_model=model,
                served_provider=self._speech.routing.stt_provider,
                prompt_version=None,
                started_at=started,
                first_token_at=None,
                finished_at=utcnow(),
                status=status,
                error_class=error_class,
                input_tokens=None,
                output_tokens=None,
                cached_tokens=None,
                reasoning_tokens=None,
                estimated_cost_usd=cost,
                final_cost_usd=None,
                gateway_reported_cost_usd=None,
                consent_policy_id=None,
                data_residency_policy_id=None,
                retry_chain_id=request_id,
                attempts=1,
                is_mock=self.transcriber.is_mock,
                audio_seconds=seconds,
            ),
        )

    async def aclose(self) -> None:
        tasks = list(self._tasks.values())
        for task in tasks:
            task.cancel()
        for task in tasks:
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await task
