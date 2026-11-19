from __future__ import annotations

import io
import json
import logging

import pytest

from karen_ai.core.context import request_id_var, user_ref_var
from karen_ai.core.logging_setup import JsonFormatter, log_fields
from karen_ai.core.redaction import REDACTED, redact_mapping, redact_text


@pytest.mark.parametrize(
    ("raw", "leaked"),
    [
        ("Authorization: Bearer abc.def-ghi_123", "abc.def-ghi_123"),
        ("api_key=test-only-gateway-key-1234567890", "test-only-gateway-key-1234567890"),
        ("key sk-test0123456789abcdefXYZ here", "sk-test0123456789abcdefXYZ"),
        ("mail priya.sharma@example.com now", "priya.sharma@example.com"),
        ("call +91 98765 43210 today", "98765 43210"),
        ("call 9876543210 today", "9876543210"),
        ("aadhaar 1234 5678 9012", "1234 5678 9012"),
        ("card 4111111111111111", "4111111111111111"),
        ("jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl", "eyJzdWIiOiIxIn0"),
    ],
)
def test_redact_text_masks_secrets_and_pii(raw: str, leaked: str) -> None:
    assert leaked not in redact_text(raw)


def test_redact_text_keeps_ordinary_text() -> None:
    text = "Remind me at 5 PM on 2026-11-20 about ₹1,500 refund"
    assert redact_text(text) == text


def test_redact_mapping_masks_sensitive_keys_recursively() -> None:
    data = {"headers": {"Authorization": "x", "x-karen-signature": "t=1,v1=ab"}, "note": "a@b.co", "n": 3}
    assert redact_mapping(data) == {
        "headers": {"Authorization": REDACTED, "x-karen-signature": REDACTED},
        "note": "[REDACTED_EMAIL]",
        "n": 3,
    }


def test_metadata_keys_are_not_mistaken_for_secrets() -> None:
    data = {
        "input_tokens": 12,
        "first_token_at": "2026-11-19T17:43:44Z",
        "refresh_token": "abc",
        "secret_key": "abc",
        "x-api-key": "abc",
    }
    assert redact_mapping(data) == {
        "input_tokens": 12,
        "first_token_at": "2026-11-19T17:43:44Z",
        "refresh_token": REDACTED,
        "secret_key": REDACTED,
        "x-api-key": REDACTED,
    }


def test_json_log_lines_are_redacted_and_correlated() -> None:
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(JsonFormatter())
    logger = logging.getLogger("karen_ai.test_redaction")
    logger.handlers[:] = [handler]
    logger.propagate = False
    token_rid, token_user = request_id_var.set("req-log-0001"), user_ref_var.set("usr_hmac_x")
    try:
        logger.warning("user mail a@b.co", extra=log_fields(api_key="test-only-value", tier="ECONOMY"))
    finally:
        request_id_var.reset(token_rid)
        user_ref_var.reset(token_user)
    line = json.loads(stream.getvalue())
    assert line["request_id"] == "req-log-0001"
    assert line["user_ref"] == "usr_hmac_x"
    assert "a@b.co" not in line["msg"]
    assert line["fields"] == {"api_key": REDACTED, "tier": "ECONOMY"}
