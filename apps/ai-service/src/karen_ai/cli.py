"""Console entry points: ``karen-ai-dev`` (reload) and ``karen-ai-serve`` (production)."""

from __future__ import annotations

import sys

import uvicorn
from pydantic import ValidationError

from karen_ai.core.settings import Settings


def _load_settings() -> Settings:
    try:
        return Settings()
    except ValidationError as exc:
        print("karen-ai-service: invalid configuration, refusing to start:", file=sys.stderr)
        for err in exc.errors():
            location = ".".join(str(p) for p in err["loc"]) or "settings"
            print(f"  - {location}: {err['msg']}", file=sys.stderr)
        raise SystemExit(2) from None


def _run(*, reload: bool) -> None:
    settings = _load_settings()
    uvicorn.run(
        "karen_ai.api.app:create_app",
        factory=True,
        host="0.0.0.0" if not reload else "127.0.0.1",  # noqa: S104 - container bind in serve mode
        port=settings.ai_service_port,
        reload=reload,
        log_config=None,
        proxy_headers=not reload,
    )


def dev() -> None:
    _run(reload=True)


def serve() -> None:
    _run(reload=False)
