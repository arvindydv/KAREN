from __future__ import annotations

import json
from typing import Any

import httpx2
import pytest
from pydantic import SecretStr

from karen_voice.bridge import CONTRACT_VERSION, AiServiceConversationBridge, BridgeError
from karen_voice.internal_auth import build_signing_string, sign_request
from karen_voice.pipeline import Transcript
from tests.conftest import REPO_ROOT, SIGNATURE_VECTORS, TEST_HMAC_SECRET

VECTORS: dict[str, Any] = json.loads(SIGNATURE_VECTORS.read_text())
TRANSCRIPT = Transcript(
    text="Pandrah sau ka recharge kar do", is_final=True, language="hi-Latn", start_ms=0, end_ms=900
)


@pytest.mark.parametrize("vector", VECTORS["vectors"])
def test_signature_vectors(vector: dict[str, Any]) -> None:
    body = vector["body"].encode()
    assert build_signing_string(vector["method"], vector["path_with_query"], body) == vector["signing_string"]
    assert (
        sign_request(
            VECTORS["secret"], vector["method"], vector["path_with_query"], body, vector["timestamp"]
        )
        == (vector["header"])
    )


def test_contract_version_matches_shared_contract() -> None:
    source = (REPO_ROOT / "packages/ai-model-contracts/src/index.ts").read_text()
    assert f"export const CONTRACT_VERSION = '{CONTRACT_VERSION}';" in source


def _bridge(handler: Any, secret: str | None = TEST_HMAC_SECRET) -> AiServiceConversationBridge:
    client = httpx2.AsyncClient(transport=httpx2.MockTransport(handler), base_url="http://ai-service.test")
    return AiServiceConversationBridge(
        client=client, hmac_secret=SecretStr(secret) if secret else None, system_prompt="Be careful."
    )


async def test_bridge_sends_signed_contract_request() -> None:
    seen: list[httpx2.Request] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        seen.append(request)
        fixture = json.loads(
            (REPO_ROOT / "packages/ai-model-contracts/fixtures/completion-response.mock.json").read_text()
        )
        return httpx2.Response(200, json=fixture)

    reply = await _bridge(handler).reply(TRANSCRIPT, session_id="job_1", user_ref="usr_hmac_voice")
    assert reply.startswith("[mock]")
    request = seen[0]
    body = json.loads(request.content)
    assert body["contract_version"] == CONTRACT_VERSION
    assert body["task_kind"] == "CHAT"
    assert body["messages"][1]["content"] == TRANSCRIPT.text
    assert request.headers["x-karen-caller"] == "voice-agent"
    timestamp = int(request.headers["x-karen-signature"].split(",")[0].removeprefix("t="))
    expected = sign_request(TEST_HMAC_SECRET, "POST", "/internal/v1/completions", request.content, timestamp)
    assert request.headers["x-karen-signature"] == expected


async def test_bridge_maps_error_envelope() -> None:
    def handler(_: httpx2.Request) -> httpx2.Response:
        error = {"code": "BUDGET_EXCEEDED", "message": "x", "retryable": False, "request_id": None}
        return httpx2.Response(403, json={"error": error})

    with pytest.raises(BridgeError) as exc:
        await _bridge(handler).reply(TRANSCRIPT, session_id="job_1", user_ref="usr_hmac_voice")
    assert (exc.value.code, exc.value.retryable) == ("BUDGET_EXCEEDED", False)


async def test_bridge_maps_timeouts_and_unsigned_local_mode() -> None:
    def handler(request: httpx2.Request) -> httpx2.Response:
        assert "x-karen-signature" not in request.headers
        raise httpx2.ReadTimeout("slow ai-service (test)")

    with pytest.raises(BridgeError) as exc:
        await _bridge(handler, secret=None).reply(TRANSCRIPT, session_id="job_1", user_ref="usr_hmac_voice")
    assert (exc.value.code, exc.value.retryable) == ("AI_SERVICE_TIMEOUT", True)
