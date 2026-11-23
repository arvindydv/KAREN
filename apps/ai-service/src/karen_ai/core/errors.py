"""Typed service errors mapped onto the contract error codes and HTTP statuses."""

from __future__ import annotations

from typing import Final

from karen_ai.contracts import AiErrorBody, AiErrorCode, AiErrorEnvelope

HTTP_STATUS_BY_CODE: Final[dict[AiErrorCode, int]] = {
    "VALIDATION_ERROR": 422,
    "UNAUTHORIZED": 401,
    "BUDGET_EXCEEDED": 403,
    "CAPABILITY_UNAVAILABLE": 503,
    "TIER_DISABLED": 503,
    "GATEWAY_TIMEOUT": 504,
    "GATEWAY_RATE_LIMITED": 429,
    "GATEWAY_PROVIDER_ERROR": 502,
    "GATEWAY_INVALID_RESPONSE": 502,
    "FALLBACK_EXHAUSTED": 502,
    "INTERNAL_ERROR": 500,
    # v3 (ADR-0027): unknown session, or one owned by another user (indistinguishable on purpose).
    "NOT_FOUND": 404,
}


class KarenAIError(Exception):
    """An error that is safe to surface to internal callers.

    ``message`` must never contain prompt/response content, secrets or upstream error bodies.
    """

    def __init__(self, code: AiErrorCode, message: str, *, retryable: bool = False) -> None:
        super().__init__(message)
        self.code: AiErrorCode = code
        self.message = message
        self.retryable = retryable

    @property
    def http_status(self) -> int:
        return HTTP_STATUS_BY_CODE[self.code]

    def to_envelope(self, request_id: str | None) -> AiErrorEnvelope:
        return AiErrorEnvelope(
            error=AiErrorBody(
                code=self.code,
                message=self.message,
                retryable=self.retryable,
                request_id=request_id,
            )
        )
