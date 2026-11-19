"""Voice session lifecycle state machine (transport level, independent of speech models).

    CONNECTING -> ACTIVE -> RECONNECTING -> ACTIVE ... -> ENDED
         |                      |
         +------> FAILED <------+   (connect failure, reconnect budget exhausted, fatal error)

ENDED and FAILED are terminal. Invalid transitions raise: a state bug must be loud.
"""

from __future__ import annotations

import datetime as dt
import enum
import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Final

_logger = logging.getLogger(__name__)


class SessionState(enum.StrEnum):
    CONNECTING = "CONNECTING"
    ACTIVE = "ACTIVE"
    RECONNECTING = "RECONNECTING"
    ENDED = "ENDED"
    FAILED = "FAILED"


TERMINAL_STATES: Final = frozenset({SessionState.ENDED, SessionState.FAILED})

_ALLOWED: Final[dict[SessionState, frozenset[SessionState]]] = {
    SessionState.CONNECTING: frozenset({SessionState.ACTIVE, SessionState.FAILED, SessionState.ENDED}),
    SessionState.ACTIVE: frozenset({SessionState.RECONNECTING, SessionState.ENDED, SessionState.FAILED}),
    SessionState.RECONNECTING: frozenset({SessionState.ACTIVE, SessionState.ENDED, SessionState.FAILED}),
    SessionState.ENDED: frozenset(),
    SessionState.FAILED: frozenset(),
}


class InvalidTransitionError(RuntimeError):
    pass


@dataclass(frozen=True)
class Transition:
    from_state: SessionState
    to_state: SessionState
    reason: str
    at: dt.datetime


@dataclass
class VoiceSession:
    """``max_reconnect_attempts`` is a per-session budget: repeated flapping eventually fails."""

    session_id: str
    max_reconnect_attempts: int = 3
    clock: Callable[[], dt.datetime] = field(default=lambda: dt.datetime.now(dt.UTC))
    state: SessionState = SessionState.CONNECTING
    reconnect_attempts: int = 0
    failure_reason: str | None = None
    history: list[Transition] = field(default_factory=list)

    @property
    def is_terminal(self) -> bool:
        return self.state in TERMINAL_STATES

    def _move(self, target: SessionState, reason: str) -> None:
        if target not in _ALLOWED[self.state]:
            raise InvalidTransitionError(f"{self.state} -> {target} is not allowed ({reason})")
        self.history.append(Transition(self.state, target, reason, self.clock()))
        _logger.info("voice_session_transition %s -> %s (%s)", self.state, target, reason)
        self.state = target

    def _require(self, expected: SessionState, event: str) -> None:
        if self.state is not expected:
            raise InvalidTransitionError(f"{event} is only valid in {expected}, not {self.state}")

    def connected(self) -> None:
        self._require(SessionState.CONNECTING, "connected")
        self._move(SessionState.ACTIVE, "connected")
        self.reconnect_attempts = 0

    def connection_failed(self, reason: str) -> None:
        self.failure_reason = reason
        self._move(SessionState.FAILED, f"connection failed: {reason}")

    def connection_lost(self) -> None:
        self._require(SessionState.ACTIVE, "connection_lost")
        if self.reconnect_attempts >= self.max_reconnect_attempts:
            self.failure_reason = "reconnect attempts exhausted"
            self._move(SessionState.FAILED, self.failure_reason)
            return
        self._move(SessionState.RECONNECTING, f"connection lost (attempt {self.reconnect_attempts + 1})")
        self.reconnect_attempts += 1

    def reconnected(self) -> None:
        self._require(SessionState.RECONNECTING, "reconnected")
        self._move(SessionState.ACTIVE, "reconnected")

    def end(self, reason: str = "session ended") -> None:
        """Idempotent for terminal states so shutdown paths can always call it."""
        if not self.is_terminal:
            self._move(SessionState.ENDED, reason)

    def fail(self, reason: str) -> None:
        if not self.is_terminal:
            self.failure_reason = reason
            self._move(SessionState.FAILED, reason)
