"""HTTP routes. Health probes are unauthenticated; ``/internal/*`` requires a signature."""

from __future__ import annotations

import json
import re
from collections.abc import AsyncIterator
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import ValidationError

from karen_ai.api.dependencies import ServiceContainer, get_container, require_internal_signature
from karen_ai.api.sse import encode_stream
from karen_ai.contracts import (
    CONTRACT_VERSION,
    SPEECH_RESPONSE_HEADERS,
    CompletionRequest,
    CompletionResponse,
    LiveAudioChunk,
    LiveSessionCloseRequest,
    LiveSessionStartRequest,
    LiveSessionStartResponse,
    SpeechRequest,
    TranscriptionRequest,
    TranscriptionResponse,
    VoiceCatalogResponse,
)
from karen_ai.core.context import task_id_var, user_ref_var
from karen_ai.core.errors import KarenAIError

Container = Annotated[ServiceContainer, Depends(get_container)]

health_router = APIRouter(prefix="/health", tags=["health"])
internal_router = APIRouter(
    prefix="/internal/v1", tags=["internal"], dependencies=[Depends(require_internal_signature)]
)


@health_router.get("/live")
async def live() -> dict[str, str]:
    return {"status": "ok"}


@health_router.get("/ready")
async def ready(request: Request) -> JSONResponse:
    # Readiness never calls the paid gateway: it reflects local configuration only.
    container: ServiceContainer | None = getattr(request.app.state, "container", None)
    if container is None:
        return JSONResponse(status_code=503, content={"status": "not_ready"})
    settings = container.settings
    return JSONResponse(
        content={
            "status": "ready",
            "app_env": settings.app_env,
            "gateway_mode": settings.karen_ai_gateway_mode,
            "contract_version": CONTRACT_VERSION,
            "registry_version": settings.registry.registry_version,
            "voice_enabled": settings.karen_feature_voice_enabled,
            "voice_catalog_version": settings.voice_catalog.catalog_version,
            "voice_stt_provider": settings.stt_provider,
            "voice_tts_provider": settings.tts_provider,
            "voice_live_enabled": container.live is not None,
        }
    )


async def _parse_body[
    M: (
        CompletionRequest,
        TranscriptionRequest,
        SpeechRequest,
        LiveSessionStartRequest,
        LiveAudioChunk,
        LiveSessionCloseRequest,
    )
](request: Request, model: type[M]) -> M:
    body = await request.body()
    try:
        raw: Any = json.loads(body)
    except ValueError as exc:
        raise KarenAIError("VALIDATION_ERROR", "Request body is not valid JSON.") from exc
    if isinstance(raw, dict) and isinstance(raw.get("request_id"), str):
        request.state.body_request_id = raw["request_id"][:128]
    try:
        parsed = model.model_validate(raw)
    except ValidationError as exc:
        # Locations only: never echo values (they may be audio, text or prompts).
        locations = sorted({".".join(str(p) for p in err["loc"]) or "body" for err in exc.errors()})
        raise KarenAIError(
            "VALIDATION_ERROR", "Request failed contract validation at: " + ", ".join(locations[:10])
        ) from exc
    user_ref_var.set(parsed.user_ref)
    return parsed


async def _parse_completion_request(request: Request) -> CompletionRequest:
    parsed = await _parse_body(request, CompletionRequest)
    task_id_var.set(parsed.task_id)
    return parsed


@internal_router.post("/completions", response_model=CompletionResponse)
async def create_completion(request: Request, container: Container) -> CompletionResponse:
    payload = await _parse_completion_request(request)
    return await container.completions.complete(payload)


@internal_router.post("/completions/stream", response_class=StreamingResponse)
async def stream_completion(request: Request, container: Container) -> StreamingResponse:
    payload = await _parse_completion_request(request)
    # Refusals (tier, capability, budget) happen here and return a JSON error envelope;
    # once the stream starts, failures arrive as a terminal `error` event.
    prepared = await container.completions.prepare(payload, stream=True)
    return StreamingResponse(
        encode_stream(container.completions.stream_events(prepared)),
        media_type="text/event-stream",
        headers={"cache-control": "no-cache", "x-accel-buffering": "no"},
    )


@internal_router.post("/audio/transcriptions", response_model=TranscriptionResponse)
async def create_transcription(request: Request, container: Container) -> TranscriptionResponse:
    speech = container.require_speech()
    payload = await _parse_body(request, TranscriptionRequest)
    return await speech.transcribe(payload)


@internal_router.post("/audio/speech", response_class=StreamingResponse)
async def create_speech(request: Request, container: Container) -> StreamingResponse:
    speech = container.require_speech()
    payload = await _parse_body(request, SpeechRequest)
    # Refusals happen here as a JSON error envelope; once audio starts, a failure ends the stream.
    prepared = await speech.prepare_speech(payload)
    voice = prepared.choice.voice
    headers = {
        SPEECH_RESPONSE_HEADERS["voiceId"]: voice.voice_id,
        SPEECH_RESPONSE_HEADERS["language"]: prepared.choice.spoken_language,
        SPEECH_RESPONSE_HEADERS["servedModel"]: voice.model_id,
        SPEECH_RESPONSE_HEADERS["isMock"]: "true" if speech.tts.is_mock else "false",
        SPEECH_RESPONSE_HEADERS["estimatedCostUsd"]: f"{prepared.estimated_cost_usd:.6f}",
        SPEECH_RESPONSE_HEADERS["textTruncated"]: "true" if prepared.truncated else "false",
        "cache-control": "no-store",
    }
    return StreamingResponse(speech.stream_speech(prepared), media_type=speech.media_type, headers=headers)


# ------------------------------------------------------------------- voice catalog + live (ADR-0027)


@internal_router.get("/audio/voices", response_model=VoiceCatalogResponse)
async def list_voices(container: Container) -> VoiceCatalogResponse:
    return container.require_speech().voice_catalog()


def _session_id(session_id: str) -> str:
    if not re.fullmatch(r"lv_[A-Za-z0-9]{24,48}", session_id):
        raise KarenAIError("NOT_FOUND", "Live session not found.")
    return session_id


@internal_router.post("/audio/live-sessions", response_model=LiveSessionStartResponse)
async def start_live_session(request: Request, container: Container) -> LiveSessionStartResponse:
    live = container.require_live()
    payload = await _parse_body(request, LiveSessionStartRequest)
    return await live.start(payload)


@internal_router.post("/audio/live-sessions/{session_id}/audio", status_code=204)
async def append_live_audio(session_id: str, request: Request, container: Container) -> Response:
    live = container.require_live()
    payload = await _parse_body(request, LiveAudioChunk)
    await live.append_audio(_session_id(session_id), payload)
    return Response(status_code=204)


@internal_router.post("/audio/live-sessions/{session_id}/close", status_code=202)
async def close_live_session(session_id: str, request: Request, container: Container) -> Response:
    live = container.require_live()
    payload = await _parse_body(request, LiveSessionCloseRequest)
    await live.close(_session_id(session_id), payload.user_ref)
    return Response(status_code=202)


@internal_router.get("/audio/live-sessions/{session_id}/events", response_class=StreamingResponse)
async def live_session_events(
    session_id: str,
    container: Container,
    user_ref: Annotated[str, Query(min_length=8, max_length=128)],
    after: Annotated[str | None, Query(max_length=64, pattern=r"^[0-9-]+$")] = None,
) -> StreamingResponse:
    live = container.require_live()
    user_ref_var.set(user_ref)
    # Ownership is checked here, so an unknown/foreign session is a JSON 404, not an empty stream.
    events = await live.events(_session_id(session_id), user_ref, after)

    async def encode() -> AsyncIterator[bytes]:
        idle = 0
        async for item in events:
            if item is None:
                idle += 1
                if idle % 15 == 0:
                    yield b": keep-alive\n\n"
                continue
            idle = 0
            event_id, payload = item
            data = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
            yield f"id: {event_id}\nevent: {payload['type']}\ndata: {data}\n\n".encode()

    return StreamingResponse(
        encode(),
        media_type="text/event-stream",
        headers={"cache-control": "no-cache", "x-accel-buffering": "no"},
    )
