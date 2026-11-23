"""ConversationBridge to the AI service text path.

``reply`` uses ``POST /internal/v1/completions``; ``reply_stream`` uses the SSE
``/internal/v1/completions/stream`` so speech can start on the first sentence, and closing the
generator (barge-in) closes the HTTP stream, which stops the generation upstream. Requests are
signed and contract-shaped (``packages/ai-model-contracts``; CONTRACT_VERSION must match). The
transcript's detected language becomes the ``locale`` hint, so the same task router and chat
prompt serve voice and text.
"""

from __future__ import annotations

import json
import time
import uuid
from collections.abc import AsyncIterator
from typing import Final, Literal

import httpx2
from pydantic import BaseModel, ConfigDict, SecretStr

from karen_voice.internal_auth import sign_request
from karen_voice.pipeline import Transcript

CONTRACT_VERSION: Final = "2026-11-22.v3"
COMPLETIONS_PATH: Final = "/internal/v1/completions"
STREAM_PATH: Final = "/internal/v1/completions/stream"
# Transcript language -> BCP 47 locale hint for the AI service prompt.
LOCALE_FOR_LANGUAGE: Final[dict[str, str]] = {"hi": "hi-IN", "hi-Latn": "hi-IN", "en": "en-IN"}
CALLER: Final = "voice-agent"


class BridgeError(RuntimeError):
    def __init__(self, code: str, retryable: bool) -> None:
        super().__init__(code)
        self.code = code
        self.retryable = retryable


class _CompletionSubset(BaseModel):
    """The fields the voice path consumes; full validation lives in the AI service contract tests."""

    model_config = ConfigDict(extra="ignore", frozen=True)

    contract_version: Literal["2026-11-22.v3"]
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

    def _request(
        self, path: str, transcript: Transcript, *, session_id: str, user_ref: str
    ) -> tuple[bytes, dict[str, str]]:
        request_id = f"voice-{uuid.uuid4().hex}"
        payload: dict[str, object] = {
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
        }
        locale = LOCALE_FOR_LANGUAGE.get(transcript.language or "")
        if locale is not None:
            payload["locale"] = locale
        body = json.dumps(payload, ensure_ascii=False).encode()
        headers = {"content-type": "application/json", "x-request-id": request_id, "x-karen-caller": CALLER}
        if self._secret is not None:
            headers["x-karen-signature"] = sign_request(
                self._secret.get_secret_value(), "POST", path, body, int(time.time())
            )
        return body, headers

    @staticmethod
    def _error(status: int, content: bytes) -> BridgeError:
        code, retryable = "AI_SERVICE_ERROR", status >= 500
        try:
            error = json.loads(content)["error"]
            code, retryable = str(error["code"]), bool(error["retryable"])
        except (ValueError, KeyError, TypeError):
            pass
        return BridgeError(code, retryable=retryable)

    async def reply_stream(
        self, transcript: Transcript, *, session_id: str, user_ref: str
    ) -> AsyncIterator[str]:
        """Reply text deltas. Closing the generator early cancels the generation upstream."""
        body, headers = self._request(STREAM_PATH, transcript, session_id=session_id, user_ref=user_ref)
        try:
            async with self._client.stream("POST", STREAM_PATH, content=body, headers=headers) as response:
                if response.status_code != 200:
                    raise self._error(response.status_code, await response.aread())
                async for line in response.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    event = json.loads(line.removeprefix("data: "))
                    kind = event.get("event")
                    if kind == "delta" and isinstance(event.get("text"), str):
                        yield event["text"]
                    elif kind == "error":
                        raise BridgeError(
                            str(event.get("code", "AI_SERVICE_ERROR")), bool(event.get("retryable"))
                        )
                    elif kind == "done":
                        return
        except httpx2.TimeoutException as exc:
            raise BridgeError("AI_SERVICE_TIMEOUT", retryable=True) from exc
        except httpx2.TransportError as exc:
            raise BridgeError("AI_SERVICE_UNREACHABLE", retryable=True) from exc

    async def reply(self, transcript: Transcript, *, session_id: str, user_ref: str) -> str:
        body, headers = self._request(COMPLETIONS_PATH, transcript, session_id=session_id, user_ref=user_ref)
        try:
            response = await self._client.post(COMPLETIONS_PATH, content=body, headers=headers)
        except httpx2.TimeoutException as exc:
            raise BridgeError("AI_SERVICE_TIMEOUT", retryable=True) from exc
        except httpx2.TransportError as exc:
            raise BridgeError("AI_SERVICE_UNREACHABLE", retryable=True) from exc
        if response.status_code != 200:
            raise self._error(response.status_code, response.content)
        return _CompletionSubset.model_validate_json(response.content).output_text
