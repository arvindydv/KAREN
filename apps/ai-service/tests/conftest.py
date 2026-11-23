"""Shared fixtures. Tests are deterministic and never touch the network."""

from __future__ import annotations

import json
import os
import socket
import time
from collections.abc import AsyncIterator, Callable, Mapping
from pathlib import Path
from typing import Any, Final
from urllib.parse import urlsplit

import httpx2
import pytest
from fastapi import FastAPI

from karen_ai.api.app import create_app
from karen_ai.contracts import CONTRACT_VERSION
from karen_ai.core.internal_auth import sign_request
from karen_ai.core.replay_guard import InMemorySignatureReplayGuard
from karen_ai.core.settings import MOCK_REGISTRY_PATH, Settings
from karen_ai.policies.budget import InMemoryDailyBudgetTracker

REPO_ROOT: Final = Path(__file__).resolve().parents[3]
CONTRACT_FIXTURES: Final = REPO_ROOT / "packages/ai-model-contracts/fixtures"
SIGNATURE_VECTORS: Final = REPO_ROOT / "packages/test-fixtures/fixtures/internal-auth/signature-vectors.json"
TEST_HMAC_SECRET: Final = "test-only-internal-hmac-secret-0123456789abcdef"
TEST_GATEWAY_KEY: Final = "test-only-gateway-key-not-real"
# Deployed-env settings require a Redis location. Unit tests inject in-memory stores, so this
# unroutable URL is never connected to (connections are lazy).
UNUSED_REDIS_URL: Final = "redis://127.0.0.1:1/0"

SettingsFactory = Callable[..., Settings]


_ALLOWED_TEST_HOSTS: Final = frozenset(
    {"localhost", "127.0.0.1", "::1", urlsplit(os.environ.get("KAREN_TEST_REDIS_URL", "")).hostname or ""}
) - {""}


@pytest.fixture(autouse=True)
def _no_external_network(monkeypatch: pytest.MonkeyPatch) -> None:
    """Hard guard: tests can never reach the real gateway (or any non-loopback host) and spend money.

    Fake transports (``httpx2.MockTransport``/``ASGITransport``) never resolve names, and the
    Redis integration tests use loopback (or ``KAREN_TEST_REDIS_URL``'s host), so only an
    accidental real call trips this.
    """
    real_getaddrinfo = socket.getaddrinfo

    def guarded(host: Any, *args: Any, **kwargs: Any) -> Any:
        name = host.decode() if isinstance(host, bytes) else str(host)
        if name not in _ALLOWED_TEST_HOSTS:
            raise OSError(f"external network access is blocked in tests (host {name!r})")
        return real_getaddrinfo(host, *args, **kwargs)

    monkeypatch.setattr(socket, "getaddrinfo", guarded)


@pytest.fixture(autouse=True)
def _isolated_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """Settings must come only from explicit test overrides, never the developer's shell/.env."""
    for name in Settings.model_fields:
        monkeypatch.delenv(name.upper(), raising=False)
    monkeypatch.chdir(tmp_path)


@pytest.fixture
def make_settings() -> SettingsFactory:
    def factory(**overrides: Any) -> Settings:
        values: dict[str, Any] = {"app_env": "test", "karen_model_registry_path": MOCK_REGISTRY_PATH}
        values.update(overrides)
        return Settings(_env_file=None, **values)

    return factory


def write_registry(
    path: Path,
    *,
    verified: bool = False,
    price: float = 0.0,
    changes: Mapping[str, dict[str, Any]] | None = None,
) -> Path:
    """Copy the mock registry, optionally marking entries verified and priced (test-only data)."""
    data = json.loads(MOCK_REGISTRY_PATH.read_text())
    for model in data["models"]:
        model["verified_at"] = "2026-11-01" if verified else None
        model["input_usd_per_million_tokens"] = price
        model["output_usd_per_million_tokens"] = price
        model.update((changes or {}).get(model["model_id"], {}))
    path.write_text(json.dumps(data))
    return path


def completion_body(**overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "contract_version": CONTRACT_VERSION,
        "request_id": "req_test_0001",
        "task_kind": "CHAT",
        "messages": [{"role": "user", "content": "Kal shaam 5 baje yaad dilana."}],
        "user_ref": "usr_hmac_test01",
    }
    body.update(overrides)
    return body


def signed_headers(method: str, path: str, body: bytes, *, secret: str = TEST_HMAC_SECRET) -> dict[str, str]:
    return {
        "x-karen-signature": sign_request(secret, method, path, body, int(time.time())),
        "x-karen-caller": "api",
        "content-type": "application/json",
    }


@pytest.fixture
async def client_for() -> AsyncIterator[Callable[[FastAPI], httpx2.AsyncClient]]:
    clients: list[httpx2.AsyncClient] = []

    def factory(app: FastAPI) -> httpx2.AsyncClient:
        client = httpx2.AsyncClient(
            transport=httpx2.ASGITransport(app=app), base_url="http://ai-service.test"
        )
        clients.append(client)
        return client

    yield factory
    for client in clients:
        await client.aclose()


@pytest.fixture
def app(make_settings: SettingsFactory) -> FastAPI:
    return create_app(make_settings())


def deployed_app(settings: Settings) -> FastAPI:
    """App for a deployed APP_ENV with in-memory coordination stores (no network in unit tests)."""
    return create_app(
        settings,
        budget=InMemoryDailyBudgetTracker(settings.karen_ai_daily_budget_usd),
        replay_guard=InMemorySignatureReplayGuard(),
    )
