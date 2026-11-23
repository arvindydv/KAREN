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
    AUDIO_INPUT_FORMATS,
    CONTRACT_VERSION,
    MAX_SPEECH_TEXT_CHARS,
    MAX_TRANSCRIPTION_AUDIO_BYTES,
    MAX_TRANSCRIPTION_AUDIO_MS,
    ROUTE_TIERS,
    SPEECH_LANGUAGES,
    SPEECH_RESPONSE_HEADERS,
    TASK_KINDS,
    TEXT_GENERATION_TIERS,
    VOICE_ACCENTS,
    VOICE_GENDERS,
    AiErrorEnvelope,
    CompletionRequest,
    CompletionResponse,
    SpeechRequest,
    StreamEvent,
    TranscriptionRequest,
    TranscriptionResponse,
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


def test_speech_enums_and_limits_match_typescript() -> None:
    assert sorted(TEXT_GENERATION_TIERS) == sorted(_ts_string_array("TEXT_GENERATION_TIERS"))
    assert list(SPEECH_LANGUAGES) == _ts_string_array("SPEECH_LANGUAGES")
    assert list(VOICE_ACCENTS) == _ts_string_array("VOICE_ACCENTS")
    assert list(VOICE_GENDERS) == _ts_string_array("VOICE_GENDERS")
    assert list(AUDIO_INPUT_FORMATS) == _ts_string_array("AUDIO_INPUT_FORMATS")
    for name, value in (
        ("MAX_TRANSCRIPTION_AUDIO_BYTES", MAX_TRANSCRIPTION_AUDIO_BYTES),
        ("MAX_TRANSCRIPTION_AUDIO_MS", MAX_TRANSCRIPTION_AUDIO_MS),
        ("MAX_SPEECH_TEXT_CHARS", MAX_SPEECH_TEXT_CHARS),
    ):
        assert f"export const {name} = {value:_};" in TS_SOURCE
    for key, header in SPEECH_RESPONSE_HEADERS.items():
        assert f"{key}: '{header}'," in TS_SOURCE


def test_speech_fixtures_parse() -> None:
    transcription = TranscriptionRequest.model_validate(fixture("transcription-request.valid.json"))
    assert transcription.audio_format == "webm"
    assert TranscriptionResponse.model_validate(fixture("transcription-response.mock.json")).is_mock
    speech = SpeechRequest.model_validate(fixture("speech-request.valid.json"))
    assert speech.voice.accent == "indian"


def test_speech_request_rejects_out_of_range_voice_speed() -> None:
    body = fixture("speech-request.valid.json")
    body["voice"]["speed"] = 3.0
    with pytest.raises(ValidationError, match="speed"):
        SpeechRequest.model_validate(body)


# ------------------------------------------------------------------------ v3 voice (ADR-0027)


def test_v3_voice_and_live_fixtures_parse() -> None:
    from karen_ai.contracts import (
        LIVE_SESSION_ID_PATTERN,
        MAX_LIVE_CHUNK_BYTES,
        VOICE_SPEED_MAX,
        VOICE_SPEED_MIN,
        LiveAudioChunk,
        LiveSessionStartRequest,
        LiveSessionStartResponse,
        LiveSessionUsage,
        VoiceCatalogResponse,
    )

    assert (
        LiveSessionStartRequest.model_validate(fixture("live-session-start-request.valid.json")).audio_format
        == "webm"
    )
    started = LiveSessionStartResponse.model_validate(fixture("live-session-start-response.mock.json"))
    assert started.is_mock
    assert LiveAudioChunk.model_validate(fixture("live-audio-chunk.valid.json")).seq == 0
    catalog = VoiceCatalogResponse.model_validate(fixture("voice-catalog-response.mock.json"))
    assert {v.language for v in catalog.voices} == {"en", "hi"}
    closed = fixture("live-events.mock.json")[-1]
    assert LiveSessionUsage.model_validate(closed["usage"]).reason == "client_closed"
    assert SpeechRequest.model_validate(fixture("speech-request.valid.json")).voice.voice_id
    assert (
        CompletionRequest.model_validate(fixture("completion-request.valid.json")).reply_language == "hi-Latn"
    )
    assert f"export const MAX_LIVE_CHUNK_BYTES = {MAX_LIVE_CHUNK_BYTES:_};" in TS_SOURCE
    assert f"export const VOICE_SPEED_MIN = {VOICE_SPEED_MIN};" in TS_SOURCE
    assert f"export const VOICE_SPEED_MAX = {VOICE_SPEED_MAX};" in TS_SOURCE
    assert LIVE_SESSION_ID_PATTERN.strip("^$") in TS_SOURCE


def test_live_events_produced_by_the_service_match_the_fixture_shapes() -> None:
    from karen_ai.speech.base import LiveTranscriptEvent
    from karen_ai.speech.live import wire_event

    produced = [
        wire_event(LiveTranscriptEvent(kind="ready")),
        wire_event(LiveTranscriptEvent(kind="speech_started", turn_index=0)),
        wire_event(LiveTranscriptEvent(kind="partial", text="mujhe kal ke", turn_index=0)),
        wire_event(
            LiveTranscriptEvent(
                kind="end_of_turn", text="mujhe kal ke meetings ka summary batao", turn_index=0
            )
        ),
        wire_event(LiveTranscriptEvent(kind="error", error_code="PROVIDER_ERROR")),
    ]
    assert produced == fixture("live-events.mock.json")[:5]
