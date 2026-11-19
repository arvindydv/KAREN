"""``karen-voice`` console script: validates settings, then delegates to the LiveKit agents CLI.

livekit-agents 1.8.x marks its built-in Python CLI (``cli.run_app``) as deprecated in favour of the
LiveKit CLI (``lk agent ...``); it is still the documented in-process entry in this version.
"""

from __future__ import annotations

import sys
from typing import Final

from pydantic import ValidationError

from karen_voice.settings import VoiceSettings

CONNECTING_COMMANDS: Final = frozenset({"dev", "start", "connect", "console"})


def _fail(message: str) -> int:
    print(f"karen-voice: {message}", file=sys.stderr)
    return 2


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    try:
        settings = VoiceSettings()
    except ValidationError as exc:
        details = "; ".join(f"{'.'.join(map(str, e['loc'])) or 'settings'}: {e['msg']}" for e in exc.errors())
        return _fail(f"invalid configuration, refusing to start: {details}")
    command = args[0] if args else None
    if command in CONNECTING_COMMANDS and not settings.livekit_configured:
        missing = ", ".join(settings.missing_livekit_settings)
        return _fail(
            f"refusing to connect: {missing} not set. The worker needs LiveKit server credentials; "
            "it never mints client tokens (the API does)."
        )

    from livekit.agents import cli

    from karen_voice.observability import setup_observability
    from karen_voice.worker import build_server

    setup_observability(settings)
    sys.argv = [sys.argv[0], *args]
    cli.run_app(build_server(settings))
    return 0
