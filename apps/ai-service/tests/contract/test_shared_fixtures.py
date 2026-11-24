"""Validates the SAME fixture files as packages/ai-model-contracts/src/index.test.ts."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Final

import pytest
from pydantic import TypeAdapter, ValidationError

from karen_ai.contracts import (
    AI_ERROR_CODES,
    CONTRACT_VERSION,
    MEMORY_STATUSES,
    ROUTE_TIERS,
    TASK_KINDS,
    AiErrorEnvelope,
    CompletionRequest,
    CompletionResponse,
    MemoryExtractRequest,
    MemoryExtractResponse,
    StreamEvent,
)
from karen_ai.core.settings import MOCK_REGISTRY_PATH
from karen_ai.memory import charset
from karen_ai.model_router.registry import ModelRegistry

CONTRACTS_PACKAGE: Final = Path(__file__).resolve().parents[4] / "packages/ai-model-contracts"
FIXTURES: Final = CONTRACTS_PACKAGE / "fixtures"
TS_SOURCE: Final = (CONTRACTS_PACKAGE / "src/index.ts").read_text()


def fixture(name: str) -> Any:
    return json.loads((FIXTURES / name).read_text())


def _ts_string_array(const_name: str) -> list[str]:
    match = re.search(rf"export const {const_name} = \[(.*?)\] as const;", TS_SOURCE, re.S)
    assert match is not None, const_name
    return re.findall(r"'([A-Za-z0-9_-]+)'", match.group(1))


def test_contract_version_matches_typescript() -> None:
    assert f"export const CONTRACT_VERSION = '{CONTRACT_VERSION}';" in TS_SOURCE


def test_enums_match_typescript() -> None:
    assert list(ROUTE_TIERS) == _ts_string_array("ROUTE_TIERS")
    assert list(TASK_KINDS) == _ts_string_array("TASK_KINDS")
    assert list(AI_ERROR_CODES) == _ts_string_array("AI_ERROR_CODES")


def test_valid_completion_request_parses() -> None:
    request = CompletionRequest.model_validate(fixture("completion-request.valid.json"))
    assert request.contract_version == CONTRACT_VERSION


def test_request_that_picks_a_raw_model_is_rejected() -> None:
    with pytest.raises(ValidationError, match="model"):
        CompletionRequest.model_validate(fixture("completion-request.invalid-extra-field.json"))


def test_optional_keys_may_not_be_null() -> None:
    body = fixture("completion-request.valid.json") | {"task_id": None}
    with pytest.raises(ValidationError, match="task_id"):
        CompletionRequest.model_validate(body)


def test_no_type_coercion() -> None:
    body = fixture("completion-request.valid.json") | {"max_output_tokens": "400"}
    with pytest.raises(ValidationError):
        CompletionRequest.model_validate(body)


def test_mock_response_stream_events_and_error_envelope_parse() -> None:
    assert CompletionResponse.model_validate(fixture("completion-response.mock.json")).is_mock
    events = TypeAdapter(list[StreamEvent]).validate_python(fixture("stream-events.mock.json"))
    assert events[-1].event == "done"
    assert (
        AiErrorEnvelope.model_validate(fixture("error.budget-exceeded.json")).error.code == "BUDGET_EXCEEDED"
    )


def test_response_round_trips_to_identical_json() -> None:
    raw = fixture("completion-response.mock.json")
    dumped = CompletionResponse.model_validate(raw).model_dump(mode="json")
    assert dumped == raw


def test_example_registry_entries_are_valid_and_unverified() -> None:
    registry = ModelRegistry.model_validate_json((FIXTURES / "model-registry.example.json").read_text())
    assert all(m.verified_at is None and m.model_id.startswith("mock/") for m in registry.models)


def test_service_mock_registry_is_identical_to_shared_example() -> None:
    assert MOCK_REGISTRY_PATH.read_bytes() == (FIXTURES / "model-registry.example.json").read_bytes()


def test_v4_drops_reply_style() -> None:
    body = fixture("completion-request.valid.json")
    body["reply_style"] = "spoken"
    with pytest.raises(ValidationError, match="reply_style"):
        CompletionRequest.model_validate(body)


# ── v5: memory (T-CTR-01…08), mirrored from packages/ai-model-contracts/src/index.test.ts ──────


V5_INVALID: Final = [
    "newline",
    "delimiter",
    "bidi-override",
    "item-extra-field",
    "21-items",
    "context-without-on",
    "bad-ref",
    "bad-label",
    "not-chat",
    "duplicate-ref",
    "off-feature-status",
    "system-with-memory",
]


def test_v5_memory_request_valid() -> None:
    req = CompletionRequest.model_validate(fixture("completion-request.v5-memory.valid.json"))
    assert req.memory_status == "on"
    assert req.memory_context is not None
    assert len(req.memory_context) == 4
    CompletionRequest.model_validate(fixture("completion-request.v5-memory-off.valid.json"))


@pytest.mark.parametrize("name", V5_INVALID)
def test_v5_memory_request_invalid(name: str) -> None:
    with pytest.raises(ValidationError):
        CompletionRequest.model_validate(fixture(f"completion-request.v5-invalid-{name}.json"))


def test_v5_extract_contract() -> None:
    MemoryExtractRequest.model_validate(fixture("memory-extract-request.valid.json"))
    for name in (
        "memory-extract-request.invalid-too-long.json",
        "memory-extract-request.invalid-extra-field.json",
    ):
        with pytest.raises(ValidationError):
            MemoryExtractRequest.model_validate(fixture(name))
    res = MemoryExtractResponse.model_validate(fixture("memory-extract-response.mock.json"))
    assert res.is_mock is True
    with pytest.raises(ValidationError):
        MemoryExtractResponse.model_validate(fixture("memory-extract-response.invalid-sensitivity.json"))


def test_v5_memory_wire_statuses_match_ts() -> None:
    domain = (CONTRACTS_PACKAGE.parent / "domain/src/memory/vocabulary.ts").read_text()
    match = re.search(r"export const MEMORY_WIRE_STATUSES = \[(.*?)\] as const;", domain, re.S)
    assert match is not None
    assert tuple(re.findall(r"'([a-z_]+)'", match.group(1))) == MEMORY_STATUSES


def test_m01_charset_tables_identical_to_shared_fixture() -> None:
    fx = fixture("memory-charset.v1.json")
    assert fx["unicode_version"] == charset.MEMORY_UNICODE_VERSION
    assert fx["text_disallowed_ranges"] == charset.TEXT_DISALLOWED_RANGES
    assert fx["label_first_ranges"] == charset.LABEL_FIRST_RANGES
    assert fx["label_rest_ranges"] == charset.LABEL_REST_RANGES


def test_m01_charset_behaviour_spot_checks() -> None:
    assert charset.is_memory_text_allowed("मेरा घर पुणे में है")
    assert charset.is_memory_text_allowed("\u0915\u094d\u200d\u0937")  # ZWJ allowed (conjuncts)
    for bad in ("a\nb", "a<b", "a`b", "a{b", "x\u202ey", "\u200bzero", "", "   ", "x" * 281):
        assert not charset.is_memory_text_allowed(bad), repr(bad)
    assert charset.is_memory_label_allowed("sister")
    assert charset.is_memory_label_allowed("D\u2019Souza")
    assert not charset.is_memory_label_allowed("1sister")
    assert not charset.is_memory_label_allowed("a" * 41)


def test_m01_bmp_behaviour_digests_match_ts() -> None:
    """Recomputes the TS policy digests over every BMP code point (true behavioural parity)."""
    import hashlib

    def digest(allowed: Any) -> str:
        return hashlib.sha256(bytes(1 if allowed(cp) else 0 for cp in range(0x10000))).hexdigest()

    def sur(cp: int) -> bool:
        return 0xD800 <= cp <= 0xDFFF

    fx = fixture("memory-charset.v1.json")
    assert digest(charset.is_memory_code_point_allowed) == fx["bmp_text_allowed_sha256"]
    assert (
        digest(lambda cp: not sur(cp) and charset.is_memory_label_allowed(chr(cp)))
        == fx["bmp_label_first_sha256"]
    )
    assert (
        digest(lambda cp: not sur(cp) and charset.is_memory_label_allowed("a" + chr(cp)))
        == fx["bmp_label_rest_sha256"]
    )
