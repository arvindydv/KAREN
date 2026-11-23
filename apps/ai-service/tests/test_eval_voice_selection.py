"""Voice-selection evaluation over the synthetic dataset, against the mock AND live catalogs."""

from __future__ import annotations

import json
from typing import Any

import pytest

from karen_ai.contracts import VoicePreferences
from karen_ai.core.language import detect_language
from karen_ai.core.settings import MOCK_VOICE_CATALOG_PATH, SERVICE_ROOT
from karen_ai.speech.catalog import load_catalog
from karen_ai.speech.voices import select_voice
from tests.conftest import REPO_ROOT

DATASET = json.loads((REPO_ROOT / "evals/datasets/voice/voice-selection.synthetic.json").read_text())
CATALOGS = {
    "mock": load_catalog(MOCK_VOICE_CATALOG_PATH),
    "live": load_catalog(SERVICE_ROOT / "config" / "voice-catalog.live.json"),
}


@pytest.mark.parametrize("catalog_name", sorted(CATALOGS))
@pytest.mark.parametrize("case", DATASET["cases"], ids=lambda c: c["id"])
def test_voice_selection_case(catalog_name: str, case: dict[str, Any]) -> None:
    catalog = CATALOGS[catalog_name]
    language = detect_language(case["text"])
    assert language == case["expect"]["language"]
    assert language is not None
    preferences = VoicePreferences(accent=case["accent"], gender=case["gender"], speed=1.0)
    choice = select_voice(
        language, preferences, catalog.voices, hinglish_voice_language=catalog.hinglish_voice_language
    )
    assert choice.voice.language == case["expect"]["voice_language"]
    assert choice.voice.accent == case["expect"]["accent"]
    if case["gender"] != "any" and catalog_name == "mock":  # live voices have no verified gender yet
        assert choice.voice.gender == case["gender"]
