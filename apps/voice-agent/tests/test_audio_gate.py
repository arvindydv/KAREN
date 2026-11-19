from __future__ import annotations

import json
from pathlib import Path

from karen_voice.audio_gate import AudioCapabilityGate
from tests.conftest import REPO_ROOT, SettingsFactory

AUDIO_MODEL = "test-creator/test-audio"


def registry(tmp_path: Path, *, verified: bool, tiers: list[str] | None = None) -> Path:
    path = tmp_path / "registry.json"
    entry = {
        "model_id": AUDIO_MODEL,
        "tiers": tiers or ["AUDIO"],
        "verified_at": "2026-11-01" if verified else None,
    }
    path.write_text(json.dumps({"registry_version": "test", "models": [entry]}))
    return path


def test_default_is_closed_and_not_verified(make_settings: SettingsFactory) -> None:
    decision = AudioCapabilityGate.from_settings(make_settings()).evaluate()
    assert not decision.enabled
    assert decision.verification == "NOT VERIFIED"
    assert "KAREN_FEATURE_AUDIO_ENABLED is false" in decision.reasons


def test_flag_alone_is_not_enough(make_settings: SettingsFactory) -> None:
    decision = AudioCapabilityGate.from_settings(make_settings(karen_feature_audio_enabled=True)).evaluate()
    assert not decision.enabled
    assert decision.reasons == ("KAREN_MODEL_AUDIO is not set",)


def test_unverified_registry_entry_is_refused(make_settings: SettingsFactory, tmp_path: Path) -> None:
    settings = make_settings(
        karen_feature_audio_enabled=True,
        karen_model_audio=AUDIO_MODEL,
        karen_model_registry_path=registry(tmp_path, verified=False),
    )
    decision = AudioCapabilityGate.from_settings(settings).evaluate()
    assert not decision.enabled
    assert decision.verification == "NOT VERIFIED"
    assert decision.reasons == ("registry entry has verified_at=null",)


def test_entry_without_audio_tier_is_refused(make_settings: SettingsFactory, tmp_path: Path) -> None:
    gate = AudioCapabilityGate(True, AUDIO_MODEL, registry(tmp_path, verified=True, tiers=["BALANCED"]))
    assert gate.evaluate().reasons == ("registry entry does not list the AUDIO tier",)


def test_mock_registry_has_no_audio_model(make_settings: SettingsFactory) -> None:
    shared = REPO_ROOT / "packages/ai-model-contracts/fixtures/model-registry.example.json"
    gate = AudioCapabilityGate(True, AUDIO_MODEL, shared)
    assert gate.evaluate().reasons == ("KAREN_MODEL_AUDIO is not in the model registry",)


def test_missing_registry_file(tmp_path: Path) -> None:
    gate = AudioCapabilityGate(True, AUDIO_MODEL, tmp_path / "missing.json")
    assert gate.evaluate().reasons == ("model registry is missing or invalid",)


def test_all_conditions_met_opens_gate(make_settings: SettingsFactory, tmp_path: Path) -> None:
    settings = make_settings(
        karen_feature_audio_enabled=True,
        karen_model_audio=AUDIO_MODEL,
        karen_model_registry_path=registry(tmp_path, verified=True),
    )
    decision = AudioCapabilityGate.from_settings(settings).evaluate()
    assert decision.enabled
    assert decision.verification == "VERIFIED"
    assert decision.reasons == ()


def test_verified_but_flag_off_stays_closed(tmp_path: Path) -> None:
    decision = AudioCapabilityGate(False, AUDIO_MODEL, registry(tmp_path, verified=True)).evaluate()
    assert not decision.enabled
    assert decision.verification == "VERIFIED"
