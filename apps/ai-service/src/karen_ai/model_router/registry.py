"""Model capability registry loading (architecture §2.3 compatibility note).

The registry is the only place model IDs, capabilities and prices live. Code never hardcodes a
model ID; tiers are mapped to IDs through ``KAREN_MODEL_*`` settings and checked here.
"""

from __future__ import annotations

from pathlib import Path

from pydantic import BaseModel, ConfigDict, ValidationError, model_validator

from karen_ai.contracts import ModelCapability


class RegistryError(ValueError):
    """The registry file is missing or invalid."""


class ModelRegistry(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)

    registry_version: str
    models: list[ModelCapability]

    @model_validator(mode="after")
    def _unique_ids(self) -> ModelRegistry:
        ids = [m.model_id for m in self.models]
        duplicates = sorted({i for i in ids if ids.count(i) > 1})
        if duplicates:
            raise ValueError(f"duplicate model_id entries: {', '.join(duplicates)}")
        return self

    def get(self, model_id: str) -> ModelCapability | None:
        return next((m for m in self.models if m.model_id == model_id), None)


def load_registry(path: Path) -> ModelRegistry:
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise RegistryError(f"model registry not readable at {path}: {exc.strerror}") from exc
    try:
        return ModelRegistry.model_validate_json(raw)
    except ValidationError as exc:
        raise RegistryError(f"model registry at {path} is invalid: {exc.error_count()} error(s)") from exc
