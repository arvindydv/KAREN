"""Internal service request signatures (shared byte-for-byte with the TypeScript services).

Header ``x-karen-signature: t=<unix seconds>,v1=<hex>`` where
``hex = HMAC-SHA256(secret, f"{t}.{signing_string}")`` and
``signing_string = f"{METHOD}\\n{path_with_query}\\n{sha256_hex(raw_body)}"``.
Test vectors: ``packages/test-fixtures/fixtures/internal-auth/signature-vectors.json``.
"""

from __future__ import annotations

import hashlib
import hmac
import re
from collections.abc import Sequence
from typing import Final

DEFAULT_TOLERANCE_SECONDS: Final = 300
_HEADER_RE: Final = re.compile(r"^t=(?P<t>\d{1,12}),v1=(?P<sig>[0-9a-f]{64})$")
_CALLER_RE: Final = re.compile(r"^[a-z][a-z0-9-]{1,63}$")


class SignatureError(Exception):
    """Signature missing, malformed, stale or not matching. ``reason`` is safe to log."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def build_signing_string(method: str, path_with_query: str, body: bytes) -> str:
    return f"{method.upper()}\n{path_with_query}\n{sha256_hex(body)}"


def compute_signature(secret: str, timestamp: int, signing_string: str) -> str:
    message = f"{timestamp}.{signing_string}".encode()
    return hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()


def sign_request(secret: str, method: str, path_with_query: str, body: bytes, timestamp: int) -> str:
    """Return the ``x-karen-signature`` header value."""
    signature = compute_signature(secret, timestamp, build_signing_string(method, path_with_query, body))
    return f"t={timestamp},v1={signature}"


def verify_signature(
    *,
    secret: str,
    header_value: str | None,
    method: str,
    path_with_query: str,
    body: bytes,
    now: int,
    tolerance_seconds: int = DEFAULT_TOLERANCE_SECONDS,
    previous_secrets: Sequence[str] = (),
) -> str:
    """Raise ``SignatureError`` unless the header is a fresh, valid signature for the request.

    ``previous_secrets`` are also accepted (key rotation window). Returns the verified signature
    hex so callers can apply replay protection.
    """
    if not header_value:
        raise SignatureError("missing signature")
    match = _HEADER_RE.fullmatch(header_value.strip())
    if match is None:
        raise SignatureError("malformed signature header")
    timestamp = int(match["t"])
    if abs(now - timestamp) > tolerance_seconds:
        raise SignatureError("stale signature timestamp")
    signing_string = build_signing_string(method, path_with_query, body)
    presented = match["sig"]
    # Compare against every accepted key (no early exit, so timing does not reveal which matched).
    matched = False
    for key in (secret, *previous_secrets):
        matched |= hmac.compare_digest(compute_signature(key, timestamp, signing_string), presented)
    if not matched:
        raise SignatureError("signature mismatch")
    return presented


def validate_caller(caller: str | None) -> str:
    if not caller or _CALLER_RE.fullmatch(caller) is None:
        raise SignatureError("missing or invalid caller header")
    return caller
