from __future__ import annotations

from collections.abc import Callable

import httpx2
from fastapi import FastAPI

from karen_ai.contracts import CONTRACT_VERSION
from tests.conftest import TEST_HMAC_SECRET, UNUSED_REDIS_URL, SettingsFactory, deployed_app

ClientFor = Callable[[FastAPI], httpx2.AsyncClient]


async def test_live_is_always_ok(app: FastAPI, client_for: ClientFor) -> None:
    response = await client_for(app).get("/health/live")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


async def test_ready_reports_local_configuration_only(app: FastAPI, client_for: ClientFor) -> None:
    response = await client_for(app).get("/health/ready")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ready"
    assert body["gateway_mode"] == "mock"
    assert body["contract_version"] == CONTRACT_VERSION


async def test_health_is_unauthenticated_even_when_signatures_required(
    make_settings: SettingsFactory, client_for: ClientFor
) -> None:
    app = deployed_app(
        make_settings(
            app_env="dev", internal_service_hmac_secret=TEST_HMAC_SECRET, redis_url=UNUSED_REDIS_URL
        )
    )
    client = client_for(app)
    assert (await client.get("/health/live")).status_code == 200
    assert (await client.get("/health/ready")).status_code == 200


async def test_ready_is_503_without_container(app: FastAPI, client_for: ClientFor) -> None:
    del app.state.container
    assert (await client_for(app).get("/health/ready")).status_code == 503


async def test_request_id_is_propagated(app: FastAPI, client_for: ClientFor) -> None:
    response = await client_for(app).get("/health/live", headers={"x-request-id": "corr-12345678"})
    assert response.headers["x-request-id"] == "corr-12345678"
    generated = await client_for(app).get("/health/live", headers={"x-request-id": "bad id!"})
    assert generated.headers["x-request-id"] != "bad id!"
