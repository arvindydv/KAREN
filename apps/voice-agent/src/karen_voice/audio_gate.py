"""AudioCapabilityGate: refuses every audio/speech-model path unless ALL of these hold:

1. ``KAREN_FEATURE_AUDIO_ENABLED=true``;
2. ``KAREN_MODEL_AUDIO`` names a model and ``KAREN_MODEL_REGISTRY_PATH`` points at a registry;
3. that registry entry lists the ``AUDIO`` tier and has a non-null ``verified_at``.

By default the gate is closed and reports ``NOT VERIFIED`` (architecture §2.8: gateway audio and
the LiveKit transport combination have not been validated).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, ValidationError

from karen_voice.settings import VoiceSettings

Verification = Literal["VERIFIED", "NOT VERIFIED"]


class _RegistryEntry(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True)

    model_id: str
    tiers: list[str]
    verified_at: str | None


class _Registry(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True)

    models: list[_RegistryEntry]


@dataclass(frozen=True)
class AudioGateDecision:
    enabled: bool
    verification: Verification
    reasons: tuple[str, ...]


@dataclass(frozen=True)
class AudioCapabilityGate:
    feature_enabled: bool
    audio_model: str | None
    registry_path: Path | None

    @classmethod
    def from_settings(cls, settings: VoiceSettings) -> AudioCapabilityGate:
        return cls(
            feature_enabled=settings.karen_feature_audio_enabled,
            audio_model=settings.karen_model_audio,
            registry_path=settings.karen_model_registry_path,
        )

    def _registry_entry(self, reasons: list[str]) -> _RegistryEntry | None:
        if self.registry_path is None:
            reasons.append("KAREN_MODEL_REGISTRY_PATH is not set")
            return None
        try:
            registry = _Registry.model_validate(json.loads(self.registry_path.read_text(encoding="utf-8")))
        except (OSError, ValueError, ValidationError):
            reasons.append("model registry is missing or invalid")
            return None
        entry = next((m for m in registry.models if m.model_id == self.audio_model), None)
        if entry is None:
            reasons.append("KAREN_MODEL_AUDIO is not in the model registry")
        return entry

    def evaluate(self) -> AudioGateDecision:
        reasons: list[str] = []
        if not self.feature_enabled:
            reasons.append("KAREN_FEATURE_AUDIO_ENABLED is false")
        entry: _RegistryEntry | None = None
        if self.audio_model is None:
            reasons.append("KAREN_MODEL_AUDIO is not set")
        else:
            entry = self._registry_entry(reasons)
        if entry is not None:
            if "AUDIO" not in entry.tiers:
                reasons.append("registry entry does not list the AUDIO tier")
            if entry.verified_at is None:
                reasons.append("registry entry has verified_at=null")
        verified = entry is not None and "AUDIO" in entry.tiers and entry.verified_at is not None
        return AudioGateDecision(
            enabled=not reasons,
            verification="VERIFIED" if verified else "NOT VERIFIED",
            reasons=tuple(reasons),
        )
