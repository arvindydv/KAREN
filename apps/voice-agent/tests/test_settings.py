from __future__ import annotations

import pytest
from pydantic import ValidationError

from tests.conftest import SettingsFactory


def test_defaults_need_no_credentials(make_settings: SettingsFactory) -> None:
    settings = make_settings()
    assert settings.voice_agent_health_port == 8200
    assert settings.ai_service_url == "http://localhost:8100"
    assert not settings.karen_feature_audio_enabled
    assert not settings.livekit_configured
    assert settings.missing_livekit_settings == ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"]


def test_livekit_configured(make_settings: SettingsFactory) -> None:
    settings = make_settings(
        livekit_url="wss://livekit.test.invalid",
        livekit_api_key="test-key",
        livekit_api_secret="test-only-secret",
    )
    assert settings.livekit_configured
    assert "test-only-secret" not in repr(settings)


def test_livekit_url_must_be_websocket(make_settings: SettingsFactory) -> None:
    with pytest.raises(ValidationError, match="livekit_url"):
        make_settings(livekit_url="https://livekit.test.invalid")


@pytest.mark.parametrize("app_env", ["dev", "staging", "production"])
def test_hmac_secret_required_outside_local(make_settings: SettingsFactory, app_env: str) -> None:
    with pytest.raises(ValidationError, match="INTERNAL_SERVICE_HMAC_SECRET"):
        make_settings(app_env=app_env)


def test_bad_app_env(make_settings: SettingsFactory) -> None:
    with pytest.raises(ValidationError, match="app_env"):
        make_settings(app_env="prod")


def test_container_image_requires_explicit_app_env(monkeypatch: pytest.MonkeyPatch) -> None:
    from karen_voice.settings import VoiceSettings

    monkeypatch.delenv("APP_ENV", raising=False)
    monkeypatch.setenv("KAREN_DEPLOYED_ARTIFACT", "true")
    with pytest.raises(ValidationError, match="APP_ENV must be set explicitly"):
        VoiceSettings(_env_file=None)
    monkeypatch.setenv("APP_ENV", "local")
    assert VoiceSettings(_env_file=None).app_env == "local"
