"""Voice catalog generation from catalog data (pure; the real run reads the free public listing)."""

from __future__ import annotations

from typing import Any

import pytest

from karen_ai.speech.catalog_tool import build_catalog, catalog_json, voices_for

TTS = "test-creator/tts"
STT = "test-creator/stt"
VOICES = [
    "en-IN-Asha:Test",
    "hi-IN-Ravi:Test",
    "en-US-Sam:Test",
    "en-GB-Kim:Test",
    "fr-FR-Luc:Test",
    "plain-voice",
]


def test_voices_keep_only_supported_locales_with_accent_from_the_tag() -> None:
    parsed = {(v.voice_id, v.language, v.accent) for v in voices_for(TTS, VOICES)}
    assert parsed == {
        ("en-IN-Asha:Test", "en", "indian"),
        ("hi-IN-Ravi:Test", "hi", "indian"),
        ("en-US-Sam:Test", "en", "american"),
        ("en-GB-Kim:Test", "en", "british"),
    }
    assert all(v.gender is None for v in voices_for(TTS, VOICES))


def _entries(voices: list[str]) -> dict[str, dict[str, Any]]:
    return {TTS: {"id": TTS, "supported_voices": voices, "pricing": {"prompt": "0.00001"}}}


def test_catalog_is_written_unverified_with_pricing_provenance() -> None:
    catalog = build_catalog(
        stt=[STT],
        tts=[TTS],
        speech_entries=_entries(VOICES),
        transcription_entries={STT: {"id": STT}},
        today="2026-11-21",
    )
    assert all(m.verified_at is None for m in [*catalog.stt_models, *catalog.tts_models])
    assert "billing unit not documented" in (catalog.tts_models[0].notes or "")
    assert '"gender"' not in catalog_json(catalog)  # unknown gender is omitted, never guessed


def test_catalog_refuses_non_zdr_models_and_missing_hindi() -> None:
    with pytest.raises(SystemExit, match="not a ZDR transcription model"):
        build_catalog(
            stt=[STT], tts=[TTS], speech_entries=_entries(VOICES), transcription_entries={}, today="x"
        )
    with pytest.raises(SystemExit, match="both English and Hindi"):
        build_catalog(
            stt=[STT],
            tts=[TTS],
            speech_entries=_entries(["en-US-Sam:T"]),
            transcription_entries={STT: {}},
            today="x",
        )
