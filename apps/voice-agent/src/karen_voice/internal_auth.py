"""Signing of internal requests to the AI service.

Byte-for-byte the same scheme as ``apps/ai-service`` and the TypeScript services; verified against
``packages/test-fixtures/fixtures/internal-auth/signature-vectors.json`` in tests.
"""

from __future__ import annotations

import hashlib
import hmac


def build_signing_string(method: str, path_with_query: str, body: bytes) -> str:
    return f"{method.upper()}\n{path_with_query}\n{hashlib.sha256(body).hexdigest()}"


def sign_request(secret: str, method: str, path_with_query: str, body: bytes, timestamp: int) -> str:
    message = f"{timestamp}.{build_signing_string(method, path_with_query, body)}".encode()
    return f"t={timestamp},v1={hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()}"
