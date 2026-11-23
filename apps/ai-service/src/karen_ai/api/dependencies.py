"""FastAPI dependencies: service container access and internal signature verification."""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass

from fastapi import Request

from karen_ai.contracts import INTERNAL_CALLER_HEADER, INTERNAL_SIGNATURE_HEADER
from karen_ai.core.errors import KarenAIError
from karen_ai.core.internal_auth import (
    DEFAULT_TOLERANCE_SECONDS,
    SignatureError,
    validate_caller,
    verify_signature,
)
from karen_ai.core.logging_setup import log_fields
from karen_ai.core.replay_guard import SignatureReplayGuard
from karen_ai.core.settings import Settings
from karen_ai.model_router.service import CompletionService
from karen_ai.speech.live import LiveSessionService
from karen_ai.speech.service import SpeechService

_logger = logging.getLogger(__name__)

# Safe methods may legitimately repeat an identical signed request within one second.
_REPLAY_PROTECTED_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})


@dataclass(frozen=True)
class ServiceContainer:
    settings: Settings
    completions: CompletionService
    replay_guard: SignatureReplayGuard
    # None when KAREN_FEATURE_VOICE_ENABLED=false.
    speech: SpeechService | None = None
    # None unless KAREN_FEATURE_VOICE_LIVE_ENABLED=true and a live model is usable (ADR-0027).
    live: LiveSessionService | None = None

    def require_speech(self) -> SpeechService:
        if self.speech is None:
            raise KarenAIError("TIER_DISABLED", "Voice is disabled by feature flag.")
        return self.speech

    def require_live(self) -> LiveSessionService:
        self.require_speech()
        if self.live is None:
            raise KarenAIError("TIER_DISABLED", "Live voice conversations are disabled.")
        return self.live


def get_container(request: Request) -> ServiceContainer:
    container: ServiceContainer = request.app.state.container
    return container


def _path_with_query(request: Request) -> str:
    raw_path = request.scope.get("raw_path")
    path = raw_path.decode("latin-1") if isinstance(raw_path, bytes) else request.url.path
    query = request.scope.get("query_string", b"").decode("latin-1")
    return f"{path}?{query}" if query else path


async def require_internal_signature(request: Request) -> None:
    """Guard for every ``/internal/*`` route.

    Disabled only when no secret is configured AND APP_ENV is local/test (settings enforce the
    secret in dev/staging/production).
    """
    container = get_container(request)
    settings = container.settings
    secret = settings.internal_service_hmac_secret
    if secret is None and not settings.signature_required:
        return
    try:
        if secret is None:  # pragma: no cover - prevented by settings validation
            raise SignatureError("signature secret not configured")
        caller = validate_caller(request.headers.get(INTERNAL_CALLER_HEADER))
        current, *previous = settings.internal_hmac_secrets
        signature = verify_signature(
            secret=current,
            previous_secrets=previous,
            header_value=request.headers.get(INTERNAL_SIGNATURE_HEADER),
            method=request.method,
            path_with_query=_path_with_query(request),
            body=await request.body(),
            now=int(time.time()),
            tolerance_seconds=DEFAULT_TOLERANCE_SECONDS,
        )
        # Covers the whole acceptance window (timestamps up to +/- tolerance).
        replay_ttl = 2 * DEFAULT_TOLERANCE_SECONDS + 1
        if request.method.upper() in _REPLAY_PROTECTED_METHODS and not await container.replay_guard.claim(
            signature, replay_ttl
        ):
            raise SignatureError("replayed signature")
    except SignatureError as exc:
        _logger.warning("internal_auth_rejected", extra=log_fields(reason=exc.reason))
        raise KarenAIError("UNAUTHORIZED", "Invalid or missing internal service signature.") from exc
    request.state.caller = caller
