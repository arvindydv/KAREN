"""ConversationBridge to the AI service text path (``POST /internal/v1/completions``).

Sends a signed, contract-shaped request and returns ``output_text``. Wire contract:
``packages/ai-model-contracts`` (CONTRACT_VERSION below must match).
"""

from __future__ import annotations

import json
import time
import uuid
from typing import Final, Literal

import httpx2
from pydantic import BaseModel, ConfigDict, SecretStr

from karen_voice.internal_auth import sign_request
from karen_voice.pipeline import Transcript

CONTRACT_VERSION: Final = "2026-11-24.v5"
COMPLETIONS_PATH: Final = "/internal/v1/completions"
CALLER: Final = "voice-agent"


class BridgeError(RuntimeError):
    def __init__(self, code: str, retryable: bool) -> None:
        super().__init__(code)
        self.code = code
        self.retryable = retryable


class _CompletionSubset(BaseModel):
    """The fields the voice path consumes; full validation lives in the AI service contract tests."""

    model_config = ConfigDict(extra="ignore", frozen=True)

    contract_version: Literal["2026-11-24.v5"]
    output_text: str
    is_mock: bool


class AiServiceConversationBridge:
    def __init__(
        self,
        *,
        client: httpx2.AsyncClient,
        hmac_secret: SecretStr | None,
        system_prompt: str,
        prompt_version: str = "voice.v0",
    ) -> None:
        self._client = client
        self._secret = hmac_secret
        self._system_prompt = system_prompt
        self._prompt_version = prompt_version

    async def reply(self, transcript: Transcript, *, session_id: str, user_ref: str) -> str:
        request_id = f"voice-{uuid.uuid4().hex}"
        body = json.dumps(
            {
                "contract_version": CONTRACT_VERSION,
                "request_id": request_id,
                "task_kind": "CHAT",
                "messages": [
                    {"role": "system", "content": self._system_prompt},
                    {"role": "user", "content": transcript.text},
                ],
                "user_ref": user_ref,
                "task_id": session_id,
                "prompt_version": self._prompt_version,
            },
            ensure_ascii=False,
        ).encode()
        headers = {"content-type": "application/json", "x-request-id": request_id, "x-karen-caller": CALLER}
        if self._secret is not None:
            headers["x-karen-signature"] = sign_request(
                self._secret.get_secret_value(), "POST", COMPLETIONS_PATH, body, int(time.time())
            )
        try:
            response = await self._client.post(COMPLETIONS_PATH, content=body, headers=headers)
        except httpx2.TimeoutException as exc:
            raise BridgeError("AI_SERVICE_TIMEOUT", retryable=True) from exc
        except httpx2.TransportError as exc:
            raise BridgeError("AI_SERVICE_UNREACHABLE", retryable=True) from exc
        if response.status_code != 200:
            code, retryable = "AI_SERVICE_ERROR", response.status_code >= 500
            try:
                error = response.json()["error"]
                code, retryable = str(error["code"]), bool(error["retryable"])
            except (ValueError, KeyError, TypeError):
                pass
            raise BridgeError(code, retryable=retryable)
        return _CompletionSubset.model_validate_json(response.content).output_text
