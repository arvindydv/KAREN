from __future__ import annotations

import json
import time
from collections.abc import Callable
from typing import Any

import httpx2
import pytest
from fastapi import FastAPI

from karen_ai.core.internal_auth import (
    SignatureError,
    build_signing_string,
    sign_request,
    verify_signature,
)
from tests.conftest import (
    SIGNATURE_VECTORS,
    TEST_HMAC_SECRET,
    UNUSED_REDIS_URL,
    SettingsFactory,
    completion_body,
    deployed_app,
    signed_headers,
)

ClientFor = Callable[[FastAPI], httpx2.AsyncClient]
PATH = "/internal/v1/completions"
VECTORS: dict[str, Any] = json.loads(SIGNATURE_VECTORS.read_text())


@pytest.mark.parametrize("vector", VECTORS["vectors"], ids=lambda v: f"{v['method']} {v['path_with_query']}")
def test_shared_vectors_reproduce_exactly(vector: dict[str, Any]) -> None:
    body = vector["body"].encode()
    assert build_signing_string(vector["method"], vector["path_with_query"], body) == vector["signing_string"]
    header = sign_request(
        VECTORS["secret"], vector["method"], vector["path_with_query"], body, vector["timestamp"]
    )
    assert header == vector["header"]
    verify_signature(
        secret=VECTORS["secret"],
        header_value=vector["header"],
        method=vector["method"],
        path_with_query=vector["path_with_query"],
        body=body,
        now=vector["timestamp"] + VECTORS["tolerance_seconds"],
    )


@pytest.mark.parametrize(
    ("header", "body", "now_offset", "reason"),
    [
        (None, b'{"hello":"world"}', 0, "missing signature"),
        ("t=1763550000,v1=zz", b'{"hello":"world"}', 0, "malformed"),
        ("use-vector", b'{"hello":"world!"}', 0, "mismatch"),
        ("use-vector", b'{"hello":"world"}', 301, "stale"),
        ("use-vector", b'{"hello":"world"}', -301, "stale"),
    ],
)
def test_verification_failures(header: str | None, body: bytes, now_offset: int, reason: str) -> None:
    vector = VECTORS["vectors"][0]
    with pytest.raises(SignatureError, match=reason):
        verify_signature(
            secret=VECTORS["secret"],
            header_value=vector["header"] if header == "use-vector" else header,
            method="POST",
            path_with_query=vector["path_with_query"],
            body=body,
            now=vector["timestamp"] + now_offset,
        )


@pytest.fixture
def secured_app(make_settings: SettingsFactory) -> FastAPI:
    return deployed_app(
        make_settings(
            app_env="dev", internal_service_hmac_secret=TEST_HMAC_SECRET, redis_url=UNUSED_REDIS_URL
        )
    )


async def test_valid_signature_is_accepted(secured_app: FastAPI, client_for: ClientFor) -> None:
    body = json.dumps(completion_body()).encode()
    response = await client_for(secured_app).post(
        PATH, content=body, headers=signed_headers("POST", PATH, body)
    )
    assert response.status_code == 200


async def _assert_unauthorized(response: httpx2.Response) -> None:
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHORIZED"


async def test_missing_signature_is_401(secured_app: FastAPI, client_for: ClientFor) -> None:
    await _assert_unauthorized(await client_for(secured_app).post(PATH, json=completion_body()))


async def test_tampered_body_is_401(secured_app: FastAPI, client_for: ClientFor) -> None:
    body = json.dumps(completion_body()).encode()
    headers = signed_headers("POST", PATH, body)
    tampered = body.replace(b"CHAT", b"COMPARISON")
    await _assert_unauthorized(await client_for(secured_app).post(PATH, content=tampered, headers=headers))


async def test_wrong_path_or_query_is_401(secured_app: FastAPI, client_for: ClientFor) -> None:
    body = json.dumps(completion_body()).encode()
    headers = signed_headers("POST", PATH, body)
    await _assert_unauthorized(
        await client_for(secured_app).post(PATH + "?x=1", content=body, headers=headers)
    )


async def test_stale_signature_is_401(secured_app: FastAPI, client_for: ClientFor) -> None:
    body = json.dumps(completion_body()).encode()
    stale = sign_request(TEST_HMAC_SECRET, "POST", PATH, body, int(time.time()) - 301)
    headers = {"x-karen-signature": stale, "x-karen-caller": "api", "content-type": "application/json"}
    await _assert_unauthorized(await client_for(secured_app).post(PATH, content=body, headers=headers))


async def test_wrong_secret_is_401(secured_app: FastAPI, client_for: ClientFor) -> None:
    body = json.dumps(completion_body()).encode()
    headers = signed_headers("POST", PATH, body, secret="test-only-some-other-secret-0123456789")
    await _assert_unauthorized(await client_for(secured_app).post(PATH, content=body, headers=headers))


async def test_missing_caller_is_401(secured_app: FastAPI, client_for: ClientFor) -> None:
    body = json.dumps(completion_body()).encode()
    headers = signed_headers("POST", PATH, body)
    del headers["x-karen-caller"]
    await _assert_unauthorized(await client_for(secured_app).post(PATH, content=body, headers=headers))


async def test_auth_runs_before_body_validation(secured_app: FastAPI, client_for: ClientFor) -> None:
    await _assert_unauthorized(await client_for(secured_app).post(PATH, content=b"{not json"))


async def test_stream_route_is_protected(secured_app: FastAPI, client_for: ClientFor) -> None:
    await _assert_unauthorized(await client_for(secured_app).post(PATH + "/stream", json=completion_body()))


async def test_replayed_signature_is_401(secured_app: FastAPI, client_for: ClientFor) -> None:
    body = json.dumps(completion_body()).encode()
    headers = signed_headers("POST", PATH, body)
    client = client_for(secured_app)
    assert (await client.post(PATH, content=body, headers=headers)).status_code == 200
    await _assert_unauthorized(await client.post(PATH, content=body, headers=headers))


async def test_previous_secret_is_accepted_during_rotation(
    make_settings: SettingsFactory, client_for: ClientFor
) -> None:
    old = "test-only-previous-internal-hmac-secret-0123456789"
    app = deployed_app(
        make_settings(
            app_env="dev",
            internal_service_hmac_secret=TEST_HMAC_SECRET,
            internal_service_hmac_secret_previous=old,
            redis_url=UNUSED_REDIS_URL,
        )
    )
    client = client_for(app)
    for key in (TEST_HMAC_SECRET, old):
        body = json.dumps(completion_body(request_id=f"req_rotation_{key[:12]}")).encode()
        response = await client.post(
            PATH, content=body, headers=signed_headers("POST", PATH, body, secret=key)
        )
        assert response.status_code == 200
    body = json.dumps(completion_body(request_id="req_rotation_unknown")).encode()
    unknown = signed_headers("POST", PATH, body, secret="test-only-never-configured-secret-0123456789")
    await _assert_unauthorized(await client.post(PATH, content=body, headers=unknown))


def test_rotation_accepts_either_key_offline() -> None:
    vector = VECTORS["vectors"][0]
    body = vector["body"].encode()
    signature = verify_signature(
        secret="test-only-new-key-0123456789abcdef0123",
        previous_secrets=[VECTORS["secret"]],
        header_value=vector["header"],
        method=vector["method"],
        path_with_query=vector["path_with_query"],
        body=body,
        now=vector["timestamp"],
    )
    assert vector["header"].endswith(signature)
