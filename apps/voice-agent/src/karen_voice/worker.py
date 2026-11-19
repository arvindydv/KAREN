"""LiveKit worker wiring (livekit-agents 1.8.x ``AgentServer`` API, read from the installed SDK).

Token boundary: this worker NEVER mints client access tokens. The API (NestJS) mints short-lived
LiveKit access tokens for end users; the worker authenticates to LiveKit with its own server
credentials (LIVEKIT_API_KEY/SECRET) only to receive dispatched jobs.
"""

from __future__ import annotations

import logging
from typing import Any, Protocol

from livekit.agents import AgentServer, AutoSubscribe, JobContext

from karen_voice.audio_gate import AudioCapabilityGate
from karen_voice.session import SessionState, VoiceSession
from karen_voice.settings import VoiceSettings

_logger = logging.getLogger(__name__)


class RoomEvents(Protocol):
    def on(self, event: Any, callback: Any = None) -> Any: ...


class RoomJob(Protocol):
    """The subset of ``livekit.agents.JobContext`` the lifecycle code relies on."""

    @property
    def room(self) -> RoomEvents: ...

    async def connect(self, *, auto_subscribe: AutoSubscribe = ...) -> None: ...

    def shutdown(self, reason: str = ...) -> None: ...


def bind_room_lifecycle(job: RoomJob, session: VoiceSession) -> None:
    """Map LiveKit room connection events onto the session state machine."""

    def on_reconnecting(*_: object) -> None:
        if session.state is not SessionState.ACTIVE:
            return
        session.connection_lost()
        if session.is_terminal:
            job.shutdown(reason=session.failure_reason or "reconnect failed")

    def on_reconnected(*_: object) -> None:
        if session.state is SessionState.RECONNECTING:
            session.reconnected()

    def on_disconnected(*_: object) -> None:
        session.end("room disconnected")

    job.room.on("reconnecting", on_reconnecting)
    job.room.on("reconnected", on_reconnected)
    job.room.on("disconnected", on_disconnected)


async def run_session(job: RoomJob, session: VoiceSession) -> None:
    """Connect to the room and track lifecycle; connection failures end in FAILED."""
    bind_room_lifecycle(job, session)
    try:
        await job.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
    except Exception as exc:
        session.connection_failed(type(exc).__name__)
        raise
    session.connected()


async def entrypoint(ctx: JobContext) -> None:
    settings = VoiceSettings()
    decision = AudioCapabilityGate.from_settings(settings).evaluate()
    if not decision.enabled:
        _logger.warning("audio path disabled (%s): %s", decision.verification, "; ".join(decision.reasons))
        ctx.shutdown(reason=f"audio capability {decision.verification}")
        return
    session = VoiceSession(session_id=ctx.job.id)
    await run_session(ctx, session)
    # The gate is open, but no speech provider has been validated with this transport yet
    # (architecture §2.8, §6). Fail loudly instead of joining a room and staying silent.
    _logger.error("audio gate is open but no verified STT/TTS pipeline is wired; ending session")
    session.fail("no verified STT/TTS pipeline is wired")
    ctx.shutdown(reason="speech pipeline NOT VERIFIED")


def build_server(settings: VoiceSettings) -> AgentServer:
    server = AgentServer(
        ws_url=settings.livekit_url,
        api_key=settings.livekit_api_key,
        api_secret=settings.livekit_api_secret.get_secret_value() if settings.livekit_api_secret else None,
        port=settings.voice_agent_health_port,
        log_level=settings.log_level,
    )
    server.rtc_session(entrypoint, agent_name="karen-voice")
    return server
