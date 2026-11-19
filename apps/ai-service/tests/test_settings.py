from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import ValidationError

from karen_ai.core.settings import MOCK_REGISTRY_PATH, Settings
from tests.conftest import (
    TEST_GATEWAY_KEY,
    TEST_HMAC_SECRET,
    UNUSED_REDIS_URL,
    SettingsFactory,
    write_registry,
)


def _live(make_settings: SettingsFactory, registry: Path, **overrides: object) -> Settings:
    values: dict[str, object] = {
        "karen_ai_gateway_mode": "live",
        "ai_gateway_api_key": TEST_GATEWAY_KEY,
        "karen_model_registry_path": registry,
        "karen_model_economy": "mock/economy",
        "karen_model_balanced": "mock/balanced",
        "karen_model_reasoning": "mock/reasoning",
    }
    values.update(overrides)
    return make_settings(**values)


def test_defaults_are_mock_with_mock_tier_models(make_settings: SettingsFactory) -> None:
    settings = make_settings()
    assert settings.karen_ai_gateway_mode == "mock"
    assert settings.ai_service_port == 8100
    assert settings.karen_ai_max_output_tokens == 1500
    assert settings.tier_models["ECONOMY"] == "mock/economy"
    assert settings.tier_models["BALANCED"] == "mock/balanced"
    assert settings.tier_models["REASONING"] == "mock/reasoning"
    assert settings.tier_models["VISION"] is None
    assert settings.enabled_tiers == {"NO_MODEL", "ECONOMY", "BALANCED", "REASONING"}
    assert not settings.signature_required


def test_env_vars_are_read(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_ENV", "local")
    monkeypatch.setenv("KAREN_AI_MAX_RETRIES", "1")
    monkeypatch.setenv("AI_GATEWAY_API_KEY", "")  # empty means unset
    settings = Settings(_env_file=None)
    assert settings.karen_ai_max_retries == 1
    assert settings.ai_gateway_api_key is None


def test_bad_app_env_fails(make_settings: SettingsFactory) -> None:
    with pytest.raises(ValidationError, match="app_env"):
        make_settings(app_env="prod")


def test_direct_provider_fallback_is_refused(make_settings: SettingsFactory) -> None:
    with pytest.raises(ValidationError, match="KAREN_AI_ALLOW_DIRECT_PROVIDER_FALLBACK"):
        make_settings(karen_ai_allow_direct_provider_fallback=True)


@pytest.mark.parametrize("app_env", ["dev", "staging", "production"])
def test_hmac_secret_required_outside_local(make_settings: SettingsFactory, app_env: str) -> None:
    with pytest.raises(ValidationError, match="INTERNAL_SERVICE_HMAC_SECRET is required"):
        make_settings(app_env=app_env)


def test_short_hmac_secret_fails(make_settings: SettingsFactory) -> None:
    with pytest.raises(ValidationError, match="at least 32"):
        make_settings(internal_service_hmac_secret="short")


def test_secret_in_local_enables_signatures(make_settings: SettingsFactory) -> None:
    assert make_settings(internal_service_hmac_secret=TEST_HMAC_SECRET).signature_required


def test_production_refuses_mock_gateway(make_settings: SettingsFactory) -> None:
    with pytest.raises(ValidationError, match="mock is not allowed"):
        make_settings(
            app_env="production", internal_service_hmac_secret=TEST_HMAC_SECRET, redis_url=UNUSED_REDIS_URL
        )


def test_live_mode_requires_api_key(make_settings: SettingsFactory, tmp_path: Path) -> None:
    registry = write_registry(tmp_path / "r.json", verified=True)
    with pytest.raises(ValidationError, match="AI_GATEWAY_API_KEY is required"):
        _live(make_settings, registry, ai_gateway_api_key=None)


def test_live_mode_refuses_mock_registry(make_settings: SettingsFactory) -> None:
    with pytest.raises(ValidationError, match="points at the mock registry"):
        _live(make_settings, MOCK_REGISTRY_PATH)


def test_live_mode_requires_registry_file(make_settings: SettingsFactory, tmp_path: Path) -> None:
    with pytest.raises(ValidationError, match="not readable"):
        _live(make_settings, tmp_path / "missing.json")


def test_live_mode_requires_verified_models(make_settings: SettingsFactory, tmp_path: Path) -> None:
    registry = write_registry(tmp_path / "r.json", verified=False)
    with pytest.raises(ValidationError, match="verified_at=null"):
        _live(make_settings, registry)


def test_live_mode_requires_explicit_tier_models(make_settings: SettingsFactory, tmp_path: Path) -> None:
    registry = write_registry(tmp_path / "r.json", verified=True)
    with pytest.raises(ValidationError, match="KAREN_MODEL_REASONING must be set"):
        _live(make_settings, registry, karen_model_reasoning=None)


def test_live_mode_enabled_feature_tier_needs_model(make_settings: SettingsFactory, tmp_path: Path) -> None:
    registry = write_registry(tmp_path / "r.json", verified=True)
    with pytest.raises(ValidationError, match="KAREN_MODEL_VISION must be set"):
        _live(make_settings, registry, karen_feature_vision_enabled=True)


def test_live_mode_valid_configuration(make_settings: SettingsFactory, tmp_path: Path) -> None:
    settings = _live(make_settings, write_registry(tmp_path / "r.json", verified=True))
    assert not settings.is_mock
    assert settings.tier_models["BALANCED"] == "mock/balanced"


def test_live_mode_requires_https(make_settings: SettingsFactory, tmp_path: Path) -> None:
    registry = write_registry(tmp_path / "r.json", verified=True)
    with pytest.raises(ValidationError, match="https"):
        _live(make_settings, registry, ai_gateway_base_url="http://ai-gateway.example.invalid/v1")


def test_model_must_exist_in_registry(make_settings: SettingsFactory) -> None:
    with pytest.raises(ValidationError, match="not present in the model registry"):
        make_settings(karen_model_balanced_fallback="mock/not-registered")


def test_model_id_must_be_a_slug(make_settings: SettingsFactory) -> None:
    with pytest.raises(ValidationError, match="karen_model_balanced"):
        make_settings(karen_model_balanced="Not A Slug")


def test_missing_observability_never_fails(make_settings: SettingsFactory) -> None:
    settings = make_settings(
        langfuse_public_key="pk-test-only", sentry_dsn=None, otel_exporter_otlp_endpoint=None
    )
    assert settings.langfuse_secret_key is None


def test_secrets_are_not_rendered(make_settings: SettingsFactory) -> None:
    settings = make_settings(internal_service_hmac_secret=TEST_HMAC_SECRET)
    assert TEST_HMAC_SECRET not in repr(settings)


@pytest.mark.parametrize("app_env", ["dev", "staging", "production"])
def test_deployed_envs_refuse_per_process_budget(make_settings: SettingsFactory, app_env: str) -> None:
    with pytest.raises(ValidationError, match="KAREN_AI_BUDGET_STORE=memory is not allowed"):
        make_settings(
            app_env=app_env,
            internal_service_hmac_secret=TEST_HMAC_SECRET,
            redis_url=UNUSED_REDIS_URL,
            karen_ai_budget_store="memory",
        )


def test_deployed_envs_require_redis_location(make_settings: SettingsFactory) -> None:
    with pytest.raises(ValidationError, match="REDIS_URL or REDIS_HOST is required"):
        make_settings(app_env="dev", internal_service_hmac_secret=TEST_HMAC_SECRET)


def test_redis_url_composed_from_ecs_parts(make_settings: SettingsFactory) -> None:
    settings = make_settings(
        app_env="dev",
        internal_service_hmac_secret=TEST_HMAC_SECRET,
        redis_host="cache.internal",
        redis_tls=True,
        redis_auth_token="test-only/token",
    )
    assert settings.budget_store == "redis"
    assert settings.redis_connection_url == "rediss://:test-only%2Ftoken@cache.internal:6379"
    assert "test-only/token" not in repr(settings)


def test_container_image_requires_explicit_app_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("KAREN_DEPLOYED_ARTIFACT", "true")
    with pytest.raises(ValidationError, match="APP_ENV must be set explicitly"):
        Settings(_env_file=None)
    monkeypatch.setenv("APP_ENV", "local")
    assert Settings(_env_file=None).app_env == "local"


def test_previous_hmac_secret_needs_current_and_length(make_settings: SettingsFactory) -> None:
    with pytest.raises(ValidationError, match="requires INTERNAL_SERVICE_HMAC_SECRET"):
        make_settings(internal_service_hmac_secret_previous="x" * 40)
    with pytest.raises(ValidationError, match="PREVIOUS must be at least 32"):
        make_settings(
            internal_service_hmac_secret=TEST_HMAC_SECRET, internal_service_hmac_secret_previous="short"
        )
