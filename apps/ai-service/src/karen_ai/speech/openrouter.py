"""OpenRouter speech adapters: ``POST /audio/transcriptions`` and ``POST /audio/speech``.

Facts from OpenRouter's API reference (checked 2026-11-21); none is probe-verified yet:

- transcriptions accept JSON with base64 ``input_audio: {data, format}``; ``response_format:
  "verbose_json"`` adds the detected ``language`` and ``duration``; ``usage.cost`` is in USD;
  ``language`` is an ISO 639-1 hint (omitted = auto-detect); no streaming is documented;
- speech takes ``{model, input, voice, response_format: "mp3"|"pcm", speed}`` and returns binary
  audio (``audio/mpeg`` for mp3); usage/cost reporting for speech is not documented;
- both accept the ``provider`` routing object (``zdr``, ``data_collection``) and use the same
  error envelope and status codes as chat completions.

KAREN keeps the same rules as text: the key never leaves this process, retries only on timeouts,
408/429/5xx (bounded, jittered), never after audio bytes were delivered, and error messages never
echo upstream text. Transcription falls back to the next catalog model on a retryable failure.
"""

from __future__ import annotations

import asyncio
import base64
import random
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any, Final

import httpx2
from pydantic import SecretStr

from karen_ai.core.errors import KarenAIError
from karen_ai.gateway.base import GatewayError
from karen_ai.gateway.openrouter import (
    ProviderPreferences,
    error_type,
    internally_retryable,
    retry_after_seconds,
    status_error,
)
from karen_ai.speech.base import SynthesisInput, TranscriptionInput, TranscriptionOutput

_BACKOFF_BASE_SECONDS: Final = 0.25
_BACKOFF_CAP_SECONDS: Final = 4.0
_MAX_RETRY_AFTER_SECONDS: Final = 5.0
# OpenRouter's documented response formats are mp3 and pcm; mp3 frames concatenate cleanly.
SPEECH_FORMAT: Final = "mp3"

Sleep = Callable[[float], Awaitable[None]]


def _iso_639_1(hint: str | None) -> str | None:
    """Provider language hint; Hinglish is mixed speech, so let the provider auto-detect it."""
    return "hi" if hint == "hi" else "en" if hint == "en" else None


def _reported_cost(body: dict[str, Any]) -> float | None:
    usage = body.get("usage")
    value = usage.get("cost") if isinstance(usage, dict) else None
    if isinstance(value, bool) or not isinstance(value, int | float) or value < 0:
        return None
    return float(value)


def _number(value: object) -> float | None:
    return (
        float(value)
        if isinstance(value, int | float) and not isinstance(value, bool) and value >= 0
        else None
    )


class OpenRouterAudioClient:
    """Implements both ``SpeechToTextProvider`` and ``TextToSpeechProvider``."""

    def __init__(
        self,
        *,
        base_url: str,
        api_key: SecretStr,
        timeout_seconds: float,
        max_retries: int,
        provider: ProviderPreferences | None = None,
        http_client: httpx2.AsyncClient | None = None,
        sleep: Sleep = asyncio.sleep,
        rng: random.Random | None = None,
    ) -> None:
        self._http = http_client or httpx2.AsyncClient()
        self._base = base_url.rstrip("/")
        self._headers = {"Authorization": f"Bearer {api_key.get_secret_value()}"}
        self._timeout = httpx2.Timeout(timeout_seconds)
        self._max_retries = max_retries
        self._provider = provider or ProviderPreferences()
        self._sleep = sleep
        self._rng = rng or random.Random()  # noqa: S311 - jitter, not cryptography

    @property
    def is_mock(self) -> bool:
        return False

    @property
    def media_type(self) -> str:
        return "audio/mpeg"

    @property
    def concatenable(self) -> bool:
        return True

    # ------------------------------------------------------------------------------ helpers

    def _backoff(self, attempt: int) -> float:
        ceiling = min(_BACKOFF_CAP_SECONDS, _BACKOFF_BASE_SECONDS * 2.0 ** (attempt - 1))
        return ceiling * self._rng.uniform(0.5, 1.0)

    def _retry_delay(self, attempt: int, exc: BaseException, error: GatewayError) -> float | None:
        if attempt > self._max_retries or not internally_retryable(error):
            return None
        retry_after = retry_after_seconds(exc)
        if retry_after is None:
            return self._backoff(attempt)
        return None if retry_after > _MAX_RETRY_AFTER_SECONDS else max(retry_after, self._backoff(attempt))

    @staticmethod
    def _map(exc: BaseException, *, attempts: int, partial: bool) -> GatewayError:
        common: dict[str, Any] = {"attempts": attempts, "partial": partial}
        if isinstance(exc, GatewayError):
            exc.attempts, exc.partial = attempts, partial
            return exc
        if isinstance(exc, httpx2.TimeoutException):
            return GatewayError(
                "GATEWAY_TIMEOUT", "Speech gateway request timed out.", retryable=True, **common
            )
        if isinstance(exc, httpx2.HTTPStatusError):
            body: object
            try:
                body = exc.response.json()
            except ValueError:
                body = None
            return status_error(exc.response.status_code, error_type(body), has_fallback=False, **common)
        if isinstance(exc, httpx2.TransportError):
            return GatewayError(
                "GATEWAY_PROVIDER_ERROR", "Speech gateway connection failed.", retryable=True, **common
            )
        if isinstance(exc, ValueError):
            return GatewayError(
                "GATEWAY_INVALID_RESPONSE",
                "Speech gateway returned an invalid response.",
                retryable=False,
                **common,
            )
        return GatewayError(
            "GATEWAY_INVALID_RESPONSE", "Unexpected speech gateway failure.", retryable=False, **common
        )

    # -------------------------------------------------------------------------- transcription

    async def transcribe(self, request: TranscriptionInput) -> TranscriptionOutput:
        if not request.models:
            raise KarenAIError("CAPABILITY_UNAVAILABLE", "No speech-to-text model is configured.")
        audio_b64 = base64.b64encode(request.audio).decode("ascii")
        attempts = 0
        last: GatewayError | None = None
        for model in request.models:
            body: dict[str, Any] = {
                "model": model,
                "input_audio": {"data": audio_b64, "format": request.audio_format},
                "response_format": "verbose_json",
                "provider": self._provider.as_body(),
            }
            hint = _iso_639_1(request.language_hint)
            if hint is not None:
                body["language"] = hint
            try:
                result, used = await self._transcribe_with_retries(body)
            except GatewayError as error:
                attempts += error.attempts
                last = error
                if not error.retryable and error.status_code != 404:
                    raise
                continue  # next catalog model
            attempts += used
            return TranscriptionOutput(
                text=str(result.get("text") or "").strip(),
                language=result.get("language") if isinstance(result.get("language"), str) else None,
                duration_seconds=_number(result.get("duration")),
                served_model=model,
                reported_cost_usd=_reported_cost(result),
                attempts=attempts,
            )
        if last is None:  # pragma: no cover - loop always runs
            raise KarenAIError("INTERNAL_ERROR", "Transcription did not run.")
        last.attempts = attempts
        raise last

    async def _transcribe_with_retries(self, body: dict[str, Any]) -> tuple[dict[str, Any], int]:
        attempt = 0
        while True:
            attempt += 1
            try:
                response = await self._http.post(
                    f"{self._base}/audio/transcriptions",
                    json=body,
                    headers=self._headers,
                    timeout=self._timeout,
                )
                response.raise_for_status()
                data = response.json()
                if not isinstance(data, dict) or not isinstance(data.get("text"), str):
                    raise ValueError("transcription response without text")
                return data, attempt
            except Exception as exc:
                error = self._map(exc, attempts=attempt, partial=False)
                delay = self._retry_delay(attempt, exc, error)
                if delay is None:
                    raise error from exc
            await self._sleep(delay)

    # ------------------------------------------------------------------------------- speech

    async def synthesize(self, request: SynthesisInput) -> AsyncIterator[bytes]:
        body: dict[str, Any] = {
            "model": request.model,
            "input": request.text,
            "voice": request.voice_id,
            "response_format": SPEECH_FORMAT,
            "provider": self._provider.as_body(),
        }
        if abs(request.speed - 1.0) > 1e-6:
            body["speed"] = round(request.speed, 2)
        attempt = 0
        while True:
            attempt += 1
            delivered = False
            try:
                async with self._http.stream(
                    "POST",
                    f"{self._base}/audio/speech",
                    json=body,
                    headers=self._headers,
                    timeout=self._timeout,
                ) as response:
                    if response.is_error:
                        await response.aread()
                        response.raise_for_status()
                    async for chunk in response.aiter_bytes():
                        if chunk:
                            delivered = True
                            yield chunk
                if not delivered:
                    raise ValueError("speech response had no audio")
                return
            except Exception as exc:
                error = self._map(exc, attempts=attempt, partial=delivered)
                # Never restart a synthesis once audio reached the caller.
                delay = None if delivered else self._retry_delay(attempt, exc, error)
                if delay is None:
                    raise error from exc
            await self._sleep(delay)

    async def aclose(self) -> None:
        await self._http.aclose()
