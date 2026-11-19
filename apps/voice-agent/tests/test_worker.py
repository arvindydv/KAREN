from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pytest
from livekit.agents import AgentServer, AutoSubscribe

from karen_voice.session import SessionState, VoiceSession
from karen_voice.worker import build_server, run_session
from tests.conftest import SettingsFactory


def state_of(session: VoiceSession) -> SessionState:
    """Defeat mypy literal narrowing across state-changing calls."""
    return session.state


class FakeRoom:
    def __init__(self) -> None:
        self.handlers: dict[str, Callable[..., None]] = {}

    def on(self, event: Any, callback: Any = None) -> Any:
        self.handlers[event] = callback
        return callback

    def emit(self, event: str) -> None:
        self.handlers[event]()


class FakeJob:
    def __init__(self, *, fail_connect: bool = False) -> None:
        self._room = FakeRoom()
        self.fail_connect = fail_connect
        self.auto_subscribe: AutoSubscribe | None = None
        self.shutdown_reasons: list[str] = []

    @property
    def room(self) -> FakeRoom:
        return self._room

    async def connect(self, *, auto_subscribe: AutoSubscribe = AutoSubscribe.SUBSCRIBE_ALL) -> None:
        self.auto_subscribe = auto_subscribe
        if self.fail_connect:
            raise ConnectionError("livekit unreachable (test)")

    def shutdown(self, reason: str = "") -> None:
        self.shutdown_reasons.append(reason)


async def test_session_connects_audio_only_and_tracks_room_events() -> None:
    job, session = FakeJob(), VoiceSession(session_id="job_a", max_reconnect_attempts=1)
    await run_session(job, session)
    assert job.auto_subscribe is AutoSubscribe.AUDIO_ONLY
    assert state_of(session) is SessionState.ACTIVE
    job.room.emit("reconnecting")
    assert state_of(session) is SessionState.RECONNECTING
    job.room.emit("reconnected")
    assert state_of(session) is SessionState.ACTIVE
    job.room.emit("reconnecting")  # budget of 1 exhausted
    assert state_of(session) is SessionState.FAILED
    assert job.shutdown_reasons == ["reconnect attempts exhausted"]
    job.room.emit("disconnected")  # terminal: no-op
    assert state_of(session) is SessionState.FAILED


async def test_disconnect_ends_session() -> None:
    job, session = FakeJob(), VoiceSession(session_id="job_b")
    await run_session(job, session)
    job.room.emit("disconnected")
    assert state_of(session) is SessionState.ENDED


async def test_connection_failure_marks_failed() -> None:
    job, session = FakeJob(fail_connect=True), VoiceSession(session_id="job_c")
    with pytest.raises(ConnectionError):
        await run_session(job, session)
    assert state_of(session) is SessionState.FAILED
    assert session.failure_reason == "ConnectionError"


def test_server_builds_without_credentials_or_network(make_settings: SettingsFactory) -> None:
    server = build_server(make_settings())
    assert isinstance(server, AgentServer)
