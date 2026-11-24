"""Phase 03 M5a — /internal/v1/memory/extract, deterministic mock extractor (T-CTR-06…08, T-LOG-02)."""

from __future__ import annotations

import dataclasses
import json
import logging
from collections.abc import Callable
from typing import Any

import httpx2
import pytest
from fastapi import FastAPI

from karen_ai.contracts import CONTRACT_VERSION, MemoryExtractResponse
from karen_ai.core.redaction import REDACTED, redact_mapping
from karen_ai.memory.extractor import EXTRACT_PROMPT_VERSION, MockMemoryExtractor
from tests.conftest import (
    CONTRACT_FIXTURES,
    TEST_HMAC_SECRET,
    UNUSED_REDIS_URL,
    SettingsFactory,
    deployed_app,
    signed_headers,
)

ClientFor = Callable[[FastAPI], httpx2.AsyncClient]
EXTRACT = "/internal/v1/memory/extract"


def body(message: str, **over: Any) -> dict[str, Any]:
    return {
        "contract_version": CONTRACT_VERSION,
        "request_id": "memx_00000000-0000-4000-8000-000000000001_1",
        "user_ref": "usr_hmac_4f1c2a9b7d",
        "message_text": message,
        "max_candidates": 5,
        "max_cost_usd": 0.01,
        **over,
    }


async def test_shared_fixture_is_served_and_response_is_contract_valid(
    app: FastAPI, client_for: ClientFor
) -> None:
    res = await client_for(app).post(
        EXTRACT, content=(CONTRACT_FIXTURES / "memory-extract-request.valid.json").read_bytes()
    )
    assert res.status_code == 200
    parsed = MemoryExtractResponse.model_validate_json(res.text)
    assert parsed.is_mock is True
    assert parsed.prompt_version == EXTRACT_PROMPT_VERSION
    assert parsed.estimated_cost_usd == 0
    assert parsed.served_model is None
    assert all(c.sensitivity == "none" for c in parsed.candidates)
    # Optional keys are omitted, never null (the TS side rejects null for .optional()).
    for cand in res.json()["candidates"]:
        for key in ("subject_label", "trigger_text", "valid_until"):
            assert cand.get(key, "absent") is not None, key


@pytest.mark.parametrize(
    ("message", "value"),
    [
        ("Remember that I'm vegetarian", "I'm vegetarian"),
        ("yaad rakhna main subah 6 baje uthta hoon", "main subah 6 baje uthta hoon"),
        ("याद रखना मेरा घर पुणे में है", "मेरा घर पुणे में है"),
        ("I'm vegetarian, yaad rakhna", "I'm vegetarian"),
    ],
)
async def test_explicit_requests_yield_verbatim_explicit_candidates(message: str, value: str) -> None:
    result = await MockMemoryExtractor().extract(message, max_candidates=5)
    assert len(result.candidates) == 1
    c = result.candidates[0]
    assert c.explicit_request is True
    assert c.value_text == value
    assert c.value_text in c.source_span
    assert c.source_span in message


@pytest.mark.parametrize(
    "message",
    [
        "do you remember I'm vegetarian?",
        "remind me that I'm in Delhi",
        "kya tumhe yaad hai main kahan rehta hoon?",
    ],
)
async def test_questions_and_reminders_yield_nothing(message: str) -> None:
    assert (await MockMemoryExtractor().extract(message, max_candidates=5)).candidates == ()


async def test_multi_clause_only_the_triggered_clause_is_explicit() -> None:
    result = await MockMemoryExtractor().extract(
        "Remember to call mom. Also I hate cilantro", max_candidates=5
    )
    explicit = {c.value_text: c.explicit_request for c in result.candidates}
    assert explicit.get("I hate cilantro") is False


async def test_third_party_gets_a_label_and_is_never_explicit_self() -> None:
    result = await MockMemoryExtractor().extract("my sister loves jazz", max_candidates=5)
    assert len(result.candidates) == 1
    assert result.candidates[0].subject == "third_party"
    assert result.candidates[0].subject_label == "sister"


async def test_deterministic_and_bounded() -> None:
    msg = "Remember I like tea. Remember I like coffee. Remember I like rain. Remember I like dosa."
    a = await MockMemoryExtractor().extract(msg, max_candidates=2)
    b = await MockMemoryExtractor().extract(msg, max_candidates=2)
    assert a == b
    assert len(a.candidates) == 2


async def test_unsigned_and_invalid_requests_are_refused_without_echo(
    app: FastAPI, client_for: ClientFor, make_settings: SettingsFactory
) -> None:
    secured = deployed_app(
        make_settings(
            app_env="dev", internal_service_hmac_secret=TEST_HMAC_SECRET, redis_url=UNUSED_REDIS_URL
        )
    )
    async with httpx2.AsyncClient(transport=httpx2.ASGITransport(app=secured), base_url="http://t") as raw:
        assert (await raw.post(EXTRACT, json=body("remember I like tea"))).status_code == 401
        payload = json.dumps(body("remember I like tea")).encode()
        signed = await raw.post(EXTRACT, content=payload, headers=signed_headers("POST", EXTRACT, payload))
        assert signed.status_code == 200
    secret_text = "SECRET-MESSAGE-TEXT " * 300
    res = await client_for(app).post(EXTRACT, json=body(secret_text))
    assert res.status_code == 422
    assert "SECRET-MESSAGE-TEXT" not in res.text
    res = await client_for(app).post(
        EXTRACT, content=(CONTRACT_FIXTURES / "memory-extract-request.invalid-extra-field.json").read_bytes()
    )
    assert res.status_code == 422


async def test_t_log_02_no_message_text_in_logs_when_extraction_raises(
    app: FastAPI, client_for: ClientFor, caplog: pytest.LogCaptureFixture
) -> None:
    class Boom:
        async def extract(self, message_text: str, *, max_candidates: int) -> Any:
            raise RuntimeError("extractor exploded")

    app.state.container = dataclasses.replace(app.state.container, memory_extractor=Boom())
    caplog.set_level(logging.DEBUG)
    payload = body("remember my passport number is K1234567 SENSITIVE-LOG-PROBE")
    raw = json.dumps(payload).encode()
    headers = {"content-type": "application/json", **signed_headers("POST", EXTRACT, raw)}
    transport = httpx2.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx2.AsyncClient(transport=transport, base_url="http://t") as client:
        res = await client.post(EXTRACT, content=raw, headers=headers)
    assert res.status_code == 500
    logged = " ".join(
        r.getMessage() + json.dumps(getattr(r, "__dict__", {}), default=str) for r in caplog.records
    )
    assert "SENSITIVE-LOG-PROBE" not in logged
    assert "SENSITIVE-LOG-PROBE" not in res.text


def test_live_extraction_switch_refuses_startup(make_settings: SettingsFactory) -> None:
    with pytest.raises(ValueError, match="APP-1"):
        make_settings(karen_feature_memory_extraction_live=True)


def test_redaction_masks_memory_keys() -> None:
    out = redact_mapping(
        {
            "value_text": "x",
            "source_span": "x",
            "message_text": "x",
            "memory_context": ["x"],
            "text": "x",
            "subject_label": "x",
            "context": "kept",
        }
    )
    assert {k for k, v in out.items() if v == REDACTED} == {
        "value_text",
        "source_span",
        "message_text",
        "memory_context",
        "text",
        "subject_label",
    }
    assert out["context"] == "kept"
