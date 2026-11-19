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
    ROUTE_TIERS,
    TASK_KINDS,
    AiErrorEnvelope,
    CompletionRequest,
    CompletionResponse,
    StreamEvent,
)
from karen_ai.core.settings import MOCK_REGISTRY_PATH
from karen_ai.model_router.registry import ModelRegistry

CONTRACTS_PACKAGE: Final = Path(__file__).resolve().parents[4] / "packages/ai-model-contracts"
FIXTURES: Final = CONTRACTS_PACKAGE / "fixtures"
TS_SOURCE: Final = (CONTRACTS_PACKAGE / "src/index.ts").read_text()


def fixture(name: str) -> Any:
    return json.loads((FIXTURES / name).read_text())


def _ts_string_array(const_name: str) -> list[str]:
    match = re.search(rf"export const {const_name} = \[(.*?)\] as const;", TS_SOURCE, re.S)
    assert match is not None, const_name
    return re.findall(r"'([A-Z_]+)'", match.group(1))


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
