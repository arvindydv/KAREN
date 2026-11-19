from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any, Final

import pytest

from karen_voice.settings import VoiceSettings

REPO_ROOT: Final = Path(__file__).resolve().parents[3]
SIGNATURE_VECTORS: Final = REPO_ROOT / "packages/test-fixtures/fixtures/internal-auth/signature-vectors.json"
VOICE_DATASET: Final = REPO_ROOT / "evals/datasets/voice/amount-slots.synthetic.json"
TEST_HMAC_SECRET: Final = "test-only-internal-hmac-secret-0123456789abcdef"

SettingsFactory = Callable[..., VoiceSettings]


@pytest.fixture(autouse=True)
def _isolated_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    for name in VoiceSettings.model_fields:
        monkeypatch.delenv(name.upper(), raising=False)
    monkeypatch.chdir(tmp_path)


@pytest.fixture
def make_settings() -> SettingsFactory:
    def factory(**overrides: Any) -> VoiceSettings:
        return VoiceSettings(_env_file=None, **{"app_env": "test", **overrides})

    return factory
