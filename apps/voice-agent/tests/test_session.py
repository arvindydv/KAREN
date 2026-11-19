from __future__ import annotations

import pytest

from karen_voice.session import InvalidTransitionError, SessionState, VoiceSession


def state_of(session: VoiceSession) -> SessionState:
    """Defeat mypy literal narrowing across state-changing calls."""
    return session.state


def test_happy_path_with_reconnect() -> None:
    session = VoiceSession(session_id="job_1")
    assert state_of(session) is SessionState.CONNECTING
    session.connected()
    session.connection_lost()
    assert state_of(session) is SessionState.RECONNECTING
    session.reconnected()
    session.end("user hung up")
    assert state_of(session) is SessionState.ENDED
    assert [t.to_state for t in session.history] == [
        SessionState.ACTIVE,
        SessionState.RECONNECTING,
        SessionState.ACTIVE,
        SessionState.ENDED,
    ]


def test_connection_failure_is_terminal() -> None:
    session = VoiceSession(session_id="job_2")
    session.connection_failed("ConnectError")
    assert state_of(session) is SessionState.FAILED
    assert session.failure_reason == "ConnectError"
    with pytest.raises(InvalidTransitionError):
        session.connected()


def test_reconnect_budget_exhaustion_fails_session() -> None:
    session = VoiceSession(session_id="job_3", max_reconnect_attempts=2)
    session.connected()
    for _ in range(2):
        session.connection_lost()
        session.reconnected()
    session.connection_lost()
    assert state_of(session) is SessionState.FAILED
    assert session.failure_reason == "reconnect attempts exhausted"


@pytest.mark.parametrize("action", ["reconnected", "connection_lost"])
def test_invalid_transitions_raise(action: str) -> None:
    session = VoiceSession(session_id="job_4")
    with pytest.raises(InvalidTransitionError):
        getattr(session, action)()


def test_end_and_fail_are_idempotent_on_terminal_states() -> None:
    session = VoiceSession(session_id="job_5")
    session.end()
    session.end()
    session.fail("late error")
    assert state_of(session) is SessionState.ENDED
    assert len(session.history) == 1
