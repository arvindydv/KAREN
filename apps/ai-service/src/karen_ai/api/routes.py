"""HTTP routes. Health probes are unauthenticated; ``/internal/*`` requires a signature."""

from __future__ import annotations

import json
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import ValidationError

from karen_ai.api.dependencies import ServiceContainer, get_container, require_internal_signature
from karen_ai.api.sse import encode_stream
from karen_ai.contracts import CONTRACT_VERSION, CompletionRequest, CompletionResponse
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
        }
    )


async def _parse_body(request: Request, model: type[CompletionRequest]) -> CompletionRequest:
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
        # Locations only: never echo values (they may be prompts or personal data).
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
