"""Deepgram speech adapters (ADR-0027): batch STT, streaming STT and TTS.

Facts used here come from Deepgram's public documentation, read 2026-11-22 (links in
``docs/voice/deepgram.md``); none is probe-verified until ``karen-ai-speech-probe`` passes:

- batch STT: ``POST {base}/v1/listen?model=...`` with the raw audio as the body and its
  ``Content-Type``; ``language=multi`` is Nova-3's code-switching mode (``language_hint`` steers
  it), ``language=hi`` / ``en`` are monolingual. The response carries ``metadata.request_id``,
  ``metadata.duration`` (seconds) and ``results.channels[0].alternatives[0].transcript``;
- streaming STT (Flux): ``wss://{host}/v2/listen?model=flux-...``; containerised WebM/Ogg Opus is
  sent without ``encoding``/``sample_rate``; ``language_hint`` is repeatable (multilingual model
  only). Server messages: ``Connected``, ``TurnInfo`` (``event`` = StartOfTurn / Update /
  EagerEndOfTurn / TurnResumed / EndOfTurn, ``transcript``, ``turn_index``, ``audio_window_end``,
  optional ``languages``) and fatal ``Error``; the client ends with ``{"type": "CloseStream"}``;
- TTS: Flux TTS ``POST {base}/v2/speak`` and Aura ``POST {base}/v1/speak``, both
  ``?model=<voice>&encoding=mp3`` with ``{"text": ...}``; the voice *is* the model parameter;
  ``speed`` is optional (Aura-2 0.7-1.5, Flux 0.5-1.5, English only per the docs);
- auth header ``Authorization: Token <key>``; errors are JSON ``{err_code, err_msg, request_id}``
  with 400/401/402/403/413/429/5xx; ``dg-request-id`` / ``dg-char-count`` response headers.

Rules shared with the OpenRouter adapter: the key never leaves this process and is never logged;
retries only on timeouts, 408/429/5xx (bounded, jittered) and never after audio reached the
caller; error messages never echo upstream text (it can contain transcripts).
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import random
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping
from typing import Any, Final, Literal
from urllib.parse import urlencode

import httpx2
from pydantic import SecretStr
from websockets.asyncio.client import ClientConnection, connect
from websockets.exceptions import ConnectionClosed, ConnectionClosedOK, InvalidStatus, WebSocketException

from karen_ai.contracts import AudioInputFormat, SpeechLanguage
from karen_ai.core.errors import KarenAIError
from karen_ai.gateway.base import GatewayError
from karen_ai.gateway.openrouter import internally_retryable, retry_after_seconds, status_error
from karen_ai.speech.base import (
    LiveConfig,
    LiveTranscriptEvent,
    SynthesisInput,
    SynthesisUsage,
    TranscriptionInput,
    TranscriptionOutput,
)

DeepgramRegion = Literal["global", "in", "eu", "au"]
# Documented regional hosts (developers.deepgram.com/reference/regional-endpoints).
REGION_HOSTS: Final[dict[DeepgramRegion, str]] = {
    "global": "api.deepgram.com",
    "in": "api.in.deepgram.com",
    "eu": "api.eu.deepgram.com",
    "au": "api.au.deepgram.com",
}
MODEL_PREFIX: Final = "deepgram/"
SPEECH_ENCODING: Final = "mp3"  # documented for /v1 and /v2 speak; MP3 frames concatenate cleanly
PCM16_SAMPLE_RATE: Final = 16_000  # live `pcm16` audio (phone microphone stream, ADR-0031)
_CONTENT_TYPES: Final[dict[AudioInputFormat, str]] = {
    "webm": "audio/webm",
    "ogg": "audio/ogg",
    "mp3": "audio/mpeg",
    "wav": "audio/wav",
    "m4a": "audio/mp4",
    "aac": "audio/aac",
    "flac": "audio/flac",
}
_BACKOFF_BASE_SECONDS: Final = 0.25
_BACKOFF_CAP_SECONDS: Final = 4.0
_MAX_RETRY_AFTER_SECONDS: Final = 5.0
# Flux end-of-turn defaults are Deepgram's documented defaults; operators may tune them.
DEFAULT_EOT_THRESHOLD: Final = 0.7
DEFAULT_EOT_TIMEOUT_MS: Final = 5000
_LIVE_OPEN_TIMEOUT_SECONDS: Final = 10.0
_LIVE_MAX_MESSAGE_BYTES: Final = 1 << 20

Sleep = Callable[[float], Awaitable[None]]
Connector = Callable[[str, Mapping[str, str]], Awaitable[ClientConnection]]


def provider_model(model_id: str) -> str:
    """``deepgram/nova-3`` -> ``nova-3``; refuses IDs that are not Deepgram catalog entries."""
    if not model_id.startswith(MODEL_PREFIX):
        raise KarenAIError("CAPABILITY_UNAVAILABLE", "Speech model is not served by Deepgram.")
    return model_id[len(MODEL_PREFIX) :]


def batch_language_params(hint: SpeechLanguage | None) -> list[tuple[str, str]]:
    """Nova-3 language selection: monolingual when the language is known, else code-switching.

    Hinglish and unknown speech use ``language=multi`` (Nova-3 multilingual) with English and
    Hindi hints. Accuracy on Indian code-switched speech is NOT VERIFIED (needs a WER baseline).
    """
    if hint == "hi":
        return [("language", "hi")]
    if hint == "en":
        return [("language", "en")]
    return [("language", "multi"), ("language_hint", "en"), ("language_hint", "hi")]


def _number(value: object) -> float | None:
    return (
        float(value)
        if isinstance(value, int | float) and not isinstance(value, bool) and value >= 0
        else None
    )


def _first_language(value: object) -> str | None:
    """``languages`` may be a list of codes or of objects with a ``language`` key."""
    if not isinstance(value, list) or not value:
        return None
    first = value[0]
    if isinstance(first, str):
        return first
    if isinstance(first, dict) and isinstance(first.get("language"), str):
        return str(first["language"])
    return None


def parse_batch_transcription(body: object) -> tuple[str, str | None, float | None, str | None]:
    """(transcript, language, duration seconds, request id) from a ``/v1/listen`` response."""
    if not isinstance(body, dict):
        raise ValueError("transcription response is not an object")
    metadata = body.get("metadata") if isinstance(body.get("metadata"), dict) else {}
    results = body.get("results")
    channels = results.get("channels") if isinstance(results, dict) else None
    if not isinstance(channels, list) or not channels or not isinstance(channels[0], dict):
        raise ValueError("transcription response without channels")
    channel = channels[0]
    alternatives = channel.get("alternatives")
    if not isinstance(alternatives, list) or not alternatives or not isinstance(alternatives[0], dict):
        raise ValueError("transcription response without alternatives")
    best = alternatives[0]
    text = best.get("transcript")
    if not isinstance(text, str):
        raise ValueError("transcription response without transcript")
    language = channel.get("detected_language")
    if not isinstance(language, str):
        language = _first_language(best.get("languages"))
    request_id = metadata.get("request_id") if isinstance(metadata, dict) else None
    duration = _number(metadata.get("duration")) if isinstance(metadata, dict) else None
    return text.strip(), language, duration, request_id if isinstance(request_id, str) else None


def flux_event(message: Mapping[str, Any]) -> LiveTranscriptEvent | None:  # noqa: PLR0911 - flat mapping table
    """Normalise one Flux server message; ``None`` for messages KAREN does not use."""
    kind = message.get("type")
    request_id = message.get("request_id") if isinstance(message.get("request_id"), str) else None
    if kind == "Connected":
        return LiveTranscriptEvent(kind="ready", provider_request_id=request_id)
    if kind == "Error":
        return LiveTranscriptEvent(kind="error", error_code="PROVIDER_ERROR")
    if kind != "TurnInfo":
        return None
    event = message.get("event")
    raw_text = message.get("transcript")
    text = raw_text if isinstance(raw_text, str) else ""
    turn = message.get("turn_index")
    common: dict[str, Any] = {
        "text": text.strip(),
        "turn_index": turn if isinstance(turn, int) and not isinstance(turn, bool) else None,
        "audio_seconds": _number(message.get("audio_window_end")),
        "language": _first_language(message.get("languages")),
        "provider_request_id": request_id,
    }
    if event == "StartOfTurn":
        return LiveTranscriptEvent(kind="speech_started", **common)
    if event == "EndOfTurn":
        return LiveTranscriptEvent(kind="end_of_turn", **common)
    if event in ("Update", "EagerEndOfTurn", "TurnResumed"):
        return LiveTranscriptEvent(kind="partial", **common)
    return None


def _ws_error(exc: BaseException) -> GatewayError:
    if isinstance(exc, InvalidStatus):
        return status_error(exc.response.status_code, None, has_fallback=False)
    if isinstance(exc, TimeoutError):
        return GatewayError("GATEWAY_TIMEOUT", "Speech provider connection timed out.", retryable=True)
    return GatewayError("GATEWAY_PROVIDER_ERROR", "Speech provider connection failed.", retryable=True)


class DeepgramLiveStream:
    """One Flux streaming session. Audio in, normalised ``LiveTranscriptEvent`` out."""

    def __init__(self, socket: ClientConnection) -> None:
        self._socket = socket
        self._closed = False
        self._sent_audio = False

    async def send_audio(self, chunk: bytes) -> None:
        if self._closed or not chunk:
            return
        try:
            await self._socket.send(chunk)
            self._sent_audio = True
        except ConnectionClosed as exc:
            self._closed = True
            raise GatewayError(
                "GATEWAY_PROVIDER_ERROR", "Speech provider closed the stream.", retryable=True, partial=True
            ) from exc

    async def events(self) -> AsyncIterator[LiveTranscriptEvent]:
        try:
            async for raw in self._socket:
                if isinstance(raw, bytes):
                    continue
                try:
                    message = json.loads(raw)
                except ValueError:
                    continue
                if not isinstance(message, dict):
                    continue
                event = flux_event(message)
                if event is not None:
                    yield event
                    if event.kind == "error":
                        return
        except ConnectionClosedOK:
            return  # normal close after CloseStream
        except ConnectionClosed:
            yield LiveTranscriptEvent(kind="error", error_code="PROVIDER_DISCONNECTED")

    async def finish(self) -> None:
        if self._closed:
            return
        self._closed = True
        if not self._sent_audio:
            # Verified live 2026-11-22: CloseStream on a stream that never received audio makes Flux
            # reply Error UNPARSABLE_CLIENT_MESSAGE (it tries to decode an empty container). A session
            # closed before the user spoke is a normal close, so end the socket instead.
            with contextlib.suppress(WebSocketException, OSError):
                await self._socket.close()
            return
        with contextlib.suppress(ConnectionClosed):
            await self._socket.send(json.dumps({"type": "CloseStream"}))

    async def abort(self) -> None:
        self._closed = True
        with contextlib.suppress(WebSocketException, OSError):
            await self._socket.close()


class DeepgramSpeechClient:
    """Implements ``SpeechToTextProvider``, ``TextToSpeechProvider`` and ``LiveTranscriber``."""

    def __init__(
        self,
        *,
        api_key: SecretStr,
        region: DeepgramRegion = "global",
        timeout_seconds: float,
        max_retries: int,
        mip_opt_out: bool = True,
        eot_threshold: float = DEFAULT_EOT_THRESHOLD,
        eot_timeout_ms: int = DEFAULT_EOT_TIMEOUT_MS,
        http_client: httpx2.AsyncClient | None = None,
        ws_connect: Connector | None = None,
        sleep: Sleep = asyncio.sleep,
        rng: random.Random | None = None,
        base_url: str | None = None,
    ) -> None:
        host = REGION_HOSTS[region]
        self._base = (base_url or f"https://{host}").rstrip("/")
        self._ws_base = self._base.replace("https://", "wss://", 1).replace("http://", "ws://", 1)
        self._key = api_key
        self._http = http_client or httpx2.AsyncClient()
        self._timeout = httpx2.Timeout(timeout_seconds)
        self._max_retries = max_retries
        self._mip_opt_out = mip_opt_out
        self._eot_threshold = eot_threshold
        self._eot_timeout_ms = eot_timeout_ms
        self._ws_connect = ws_connect or self._default_connect
        self._sleep = sleep
        self._rng = rng or random.Random()  # noqa: S311 - jitter, not cryptography

    # ------------------------------------------------------------------------- properties

    @property
    def is_mock(self) -> bool:
        return False

    @property
    def media_type(self) -> str:
        return "audio/mpeg"

    @property
    def concatenable(self) -> bool:
        return True

    @property
    def _auth(self) -> dict[str, str]:
        return {"Authorization": f"Token {self._key.get_secret_value()}"}

    def _common_params(self) -> list[tuple[str, str]]:
        return [("mip_opt_out", "true")] if self._mip_opt_out else []

    # ------------------------------------------------------------------------------ retries

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
                "GATEWAY_TIMEOUT", "Speech provider request timed out.", retryable=True, **common
            )
        if isinstance(exc, httpx2.HTTPStatusError):
            # Deepgram error bodies may quote input; only the status is used.
            return status_error(exc.response.status_code, None, has_fallback=False, **common)
        if isinstance(exc, httpx2.TransportError):
            return GatewayError(
                "GATEWAY_PROVIDER_ERROR", "Speech provider connection failed.", retryable=True, **common
            )
        return GatewayError(
            "GATEWAY_INVALID_RESPONSE",
            "Speech provider returned an invalid response.",
            retryable=False,
            **common,
        )

    # ------------------------------------------------------------------------ batch STT

    async def transcribe(self, request: TranscriptionInput) -> TranscriptionOutput:
        if not request.models:
            raise KarenAIError("CAPABILITY_UNAVAILABLE", "No speech-to-text model is configured.")
        attempts = 0
        last: GatewayError | None = None
        for model in request.models:
            params = [
                ("model", provider_model(model)),
                ("smart_format", "true"),
                ("punctuate", "true"),
                *batch_language_params(request.language_hint),
                *self._common_params(),
            ]
            try:
                body, used = await self._listen_with_retries(params, request)
            except GatewayError as error:
                attempts += error.attempts
                last = error
                if not error.retryable and error.status_code not in (403, 404):
                    raise
                continue  # next catalog model (403 = model not enabled for this project)
            attempts += used
            text, language, duration, request_id = parse_batch_transcription(body)
            return TranscriptionOutput(
                text=text,
                language=language,
                duration_seconds=duration,
                served_model=model,
                reported_cost_usd=None,  # Deepgram reports usage, not cost: priced from the catalog
                attempts=attempts,
                provider_request_id=request_id,
            )
        if last is None:  # pragma: no cover - loop always runs
            raise KarenAIError("INTERNAL_ERROR", "Transcription did not run.")
        last.attempts = attempts
        raise last

    async def _listen_with_retries(
        self, params: list[tuple[str, str]], request: TranscriptionInput
    ) -> tuple[object, int]:
        attempt = 0
        while True:
            attempt += 1
            try:
                response = await self._http.post(
                    f"{self._base}/v1/listen?{urlencode(params)}",
                    content=request.audio,
                    headers={**self._auth, "Content-Type": _CONTENT_TYPES[request.audio_format]},
                    timeout=self._timeout,
                )
                response.raise_for_status()
                body = response.json()
                parse_batch_transcription(body)  # validate before returning (no retry on bad shape)
                return body, attempt
            except ValueError as exc:
                raise self._map(exc, attempts=attempt, partial=False) from exc
            except Exception as exc:
                error = self._map(exc, attempts=attempt, partial=False)
                delay = self._retry_delay(attempt, exc, error)
                if delay is None:
                    raise error from exc
            await self._sleep(delay)

    # ----------------------------------------------------------------------------- TTS

    def _speak_url(self, request: SynthesisInput) -> str:
        family = provider_model(request.model)
        path = "/v2/speak" if family.startswith("flux") else "/v1/speak"
        params = [("model", request.voice_id), ("encoding", SPEECH_ENCODING), *self._common_params()]
        if abs(request.speed - 1.0) > 1e-6:
            params.append(("speed", f"{request.speed:.2f}"))
        return f"{self._base}{path}?{urlencode(params)}"

    async def synthesize(self, request: SynthesisInput) -> AsyncIterator[bytes]:
        url = self._speak_url(request)
        attempt = 0
        while True:
            attempt += 1
            delivered = False
            try:
                async with self._http.stream(
                    "POST",
                    url,
                    json={"text": request.text},
                    headers=self._auth,
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
                    if request.on_usage is not None:
                        request.on_usage(_synthesis_usage(response.headers, request))
                return
            except Exception as exc:
                error = self._map(exc, attempts=attempt, partial=delivered)
                # Never restart a synthesis once audio reached the caller.
                delay = None if delivered else self._retry_delay(attempt, exc, error)
                if delay is None:
                    raise error from exc
            await self._sleep(delay)

    # ----------------------------------------------------------------------- live STT

    def live_url(self, config: LiveConfig) -> str:
        model = provider_model(config.model)
        if not model.startswith("flux"):
            raise KarenAIError("CAPABILITY_UNAVAILABLE", "Live transcription needs a Flux model.")
        params: list[tuple[str, str]] = [
            ("model", model),
            ("eot_threshold", f"{self._eot_threshold:g}"),
            ("eot_timeout_ms", str(self._eot_timeout_ms)),
            *self._common_params(),
        ]
        # language_hint is valid only on the multilingual Flux model.
        if "multi" in model:
            params.extend(("language_hint", code) for code in config.language_hints)
        if config.audio_format == "pcm16":
            # Raw audio has no container: Deepgram must be told the encoding and sample rate.
            params.extend((("encoding", "linear16"), ("sample_rate", str(PCM16_SAMPLE_RATE))))
        # Containerised WebM/Ogg Opus: Deepgram reads the container, so no encoding/sample_rate.
        return f"{self._ws_base}/v2/listen?{urlencode(params)}"

    async def _default_connect(self, url: str, headers: Mapping[str, str]) -> ClientConnection:
        return await connect(
            url,
            additional_headers=dict(headers),
            open_timeout=_LIVE_OPEN_TIMEOUT_SECONDS,
            max_size=_LIVE_MAX_MESSAGE_BYTES,
            # Deepgram keeps the stream alive while audio flows; no client pings needed.
            ping_interval=None,
        )

    async def connect(self, config: LiveConfig) -> DeepgramLiveStream:
        url = self.live_url(config)
        attempt = 0
        while True:
            attempt += 1
            try:
                socket = await self._ws_connect(url, self._auth)
                return DeepgramLiveStream(socket)
            except (WebSocketException, OSError, TimeoutError) as exc:
                error = _ws_error(exc)
                error.attempts = attempt
                delay = self._retry_delay(attempt, exc, error)
                if delay is None:
                    raise error from exc
            await self._sleep(delay)

    async def aclose(self) -> None:
        await self._http.aclose()


def _synthesis_usage(headers: httpx2.Headers, request: SynthesisInput) -> SynthesisUsage:
    raw_count = headers.get("dg-char-count")
    try:
        characters = int(raw_count) if raw_count is not None else len(request.text)
    except ValueError:
        characters = len(request.text)
    return SynthesisUsage(
        characters=max(characters, 0),
        provider_request_id=headers.get("dg-request-id"),
        served_model=headers.get("dg-model-name") or request.voice_id,
    )
