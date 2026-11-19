"""Every error leaves the service as the contract ``aiErrorSchema`` envelope."""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from karen_ai.contracts import AiErrorCode
from karen_ai.core.context import request_id_var
from karen_ai.core.errors import KarenAIError

_logger = logging.getLogger(__name__)


def _request_id(request: Request) -> str | None:
    body_request_id = getattr(request.state, "body_request_id", None)
    return body_request_id if isinstance(body_request_id, str) else request_id_var.get()


def error_response(request: Request, error: KarenAIError) -> JSONResponse:
    envelope = error.to_envelope(_request_id(request))
    return JSONResponse(status_code=error.http_status, content=envelope.model_dump(mode="json"))


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(KarenAIError)
    async def _karen_error(request: Request, exc: KarenAIError) -> JSONResponse:
        return error_response(request, exc)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        # Field locations only: pydantic messages can echo request content.
        locations = sorted({".".join(str(p) for p in err.get("loc", ())) for err in exc.errors()})
        message = "Request failed contract validation at: " + ", ".join(locations[:10])
        return error_response(request, KarenAIError("VALIDATION_ERROR", message))

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        code: AiErrorCode = "VALIDATION_ERROR" if 400 <= exc.status_code < 500 else "INTERNAL_ERROR"
        response = error_response(request, KarenAIError(code, f"HTTP {exc.status_code}."))
        response.status_code = exc.status_code
        return response

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        _logger.exception("unhandled_error")
        return error_response(request, KarenAIError("INTERNAL_ERROR", "Internal error."))
