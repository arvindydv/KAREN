from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from karen_ai.core.settings import MOCK_REGISTRY_PATH, SERVICE_ROOT, Settings
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
        "openrouter_api_key": TEST_GATEWAY_KEY,
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
    # No pins by default: the router picks the least expensive qualified registry model.
    assert all(pin is None for pin in settings.tier_models.values())
    assert settings.enabled_tiers == {"NO_MODEL", "ECONOMY", "BALANCED", "REASONING"}
    assert not settings.signature_required


def test_env_vars_are_read(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_ENV", "local")
    monkeypatch.setenv("KAREN_AI_MAX_RETRIES", "1")
    monkeypatch.setenv("OPENROUTER_API_KEY", "")  # empty means unset
    settings = Settings(_env_file=None)
    assert settings.karen_ai_max_retries == 1
    assert settings.openrouter_api_key is None


def test_openrouter_defaults(make_settings: SettingsFactory) -> None:
    settings = make_settings()
    assert settings.openrouter_base_url == "https://openrouter.ai/api/v1"
    assert settings.openrouter_data_collection == "deny"
    assert settings.openrouter_zdr is True
    assert settings.tier_fallbacks == {}
    assert settings.task_route_models == {}


def test_legacy_vercel_variables_are_not_read(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AI_GATEWAY_API_KEY", "legacy-vercel-key-not-real")
    monkeypatch.setenv("AI_GATEWAY_BASE_URL", "https://legacy.example.invalid/v1")
    settings = Settings(_env_file=None)
    assert settings.openrouter_api_key is None
    assert settings.openrouter_base_url == "https://openrouter.ai/api/v1"


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
    with pytest.raises(ValidationError, match="OPENROUTER_API_KEY is required"):
        _live(make_settings, registry, openrouter_api_key=None)


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


def test_live_mode_needs_a_pin_or_verified_candidate_per_tier(
    make_settings: SettingsFactory, tmp_path: Path
) -> None:
    registry = write_registry(
        tmp_path / "r.json", verified=True, changes={"mock/reasoning": {"verified_at": None}}
    )
    with pytest.raises(ValidationError, match="no verified registry model serves tier REASONING"):
        _live(make_settings, registry, karen_model_reasoning=None)


def test_live_mode_without_pins_routes_automatically(make_settings: SettingsFactory, tmp_path: Path) -> None:
    registry = write_registry(tmp_path / "r.json", verified=True)
    settings = _live(
        make_settings,
        registry,
        karen_model_economy=None,
        karen_model_balanced=None,
        karen_model_reasoning=None,
    )
    assert all(pin is None for pin in settings.tier_models.values())


def test_pin_must_list_its_tier(make_settings: SettingsFactory, tmp_path: Path) -> None:
    registry = write_registry(tmp_path / "r.json", verified=True)
    with pytest.raises(ValidationError, match="KAREN_MODEL_BALANCED=mock/economy must list tier BALANCED"):
        _live(make_settings, registry, karen_model_balanced="mock/economy")


def test_live_mode_enabled_feature_tier_needs_model(make_settings: SettingsFactory, tmp_path: Path) -> None:
    registry = write_registry(tmp_path / "r.json", verified=True)
    with pytest.raises(ValidationError, match="KAREN_MODEL_EMBEDDING must be set"):
        _live(make_settings, registry, karen_feature_embedding_enabled=True)


def test_live_vision_needs_a_verified_vision_candidate(
    make_settings: SettingsFactory, tmp_path: Path
) -> None:
    registry = write_registry(
        tmp_path / "r.json", verified=True, changes={"mock/vision": {"verified_at": None}}
    )
    with pytest.raises(ValidationError, match="no verified registry model serves tier VISION"):
        _live(make_settings, registry, karen_feature_vision_enabled=True)
    ok = write_registry(tmp_path / "ok.json", verified=True)
    assert "VISION" in _live(make_settings, ok, karen_feature_vision_enabled=True).enabled_tiers


def test_live_mode_valid_configuration(make_settings: SettingsFactory, tmp_path: Path) -> None:
    settings = _live(make_settings, write_registry(tmp_path / "r.json", verified=True))
    assert not settings.is_mock
    assert settings.tier_models["BALANCED"] == "mock/balanced"


def test_live_mode_requires_https(make_settings: SettingsFactory, tmp_path: Path) -> None:
    registry = write_registry(tmp_path / "r.json", verified=True)
    with pytest.raises(ValidationError, match="https"):
        _live(make_settings, registry, openrouter_base_url="http://openrouter.example.invalid/api/v1")


def test_production_live_refuses_provider_data_collection(
    make_settings: SettingsFactory, tmp_path: Path
) -> None:
    registry = write_registry(tmp_path / "r.json", verified=True)
    with pytest.raises(ValidationError, match="OPENROUTER_DATA_COLLECTION=allow is not allowed"):
        _live(
            make_settings,
            registry,
            app_env="production",
            internal_service_hmac_secret=TEST_HMAC_SECRET,
            redis_url=UNUSED_REDIS_URL,
            openrouter_data_collection="allow",
        )
    # Outside production it is an explicit operator choice, not a startup failure.
    assert (
        _live(make_settings, registry, openrouter_data_collection="allow").openrouter_data_collection
        == "allow"
    )


def test_bad_data_collection_value_fails(make_settings: SettingsFactory) -> None:
    with pytest.raises(ValidationError, match="openrouter_data_collection"):
        make_settings(openrouter_data_collection="maybe")


@pytest.mark.parametrize("name", ["economy", "balanced", "reasoning"])
def test_tier_fallback_must_exist_and_list_its_tier(make_settings: SettingsFactory, name: str) -> None:
    with pytest.raises(ValidationError, match="not present in the model registry"):
        make_settings(**{f"karen_model_{name}_fallback": "mock/not-registered"})
    other = "mock/reasoning" if name != "reasoning" else "mock/economy"
    with pytest.raises(ValidationError, match=f"must list tier {name.upper()}"):
        make_settings(**{f"karen_model_{name}_fallback": other})


def test_tier_fallbacks_are_exposed(make_settings: SettingsFactory, tmp_path: Path) -> None:
    registry = write_registry(
        tmp_path / "r.json", changes={"mock/reasoning": {"tiers": ["REASONING", "BALANCED"]}}
    )
    settings = make_settings(
        karen_model_registry_path=registry, karen_model_balanced_fallback="mock/reasoning"
    )
    assert settings.tier_fallbacks == {"BALANCED": "mock/reasoning"}


@pytest.mark.parametrize(
    ("setting", "tier"),
    [
        ("karen_model_coding", "REASONING"),
        ("karen_model_document_analysis", "BALANCED"),
        ("karen_model_voice", "BALANCED"),
    ],
)
def test_task_route_model_must_list_its_tier(make_settings: SettingsFactory, setting: str, tier: str) -> None:
    wrong = "mock/economy"
    with pytest.raises(ValidationError, match=f"must list tier {tier}"):
        make_settings(**{setting: wrong})
    with pytest.raises(ValidationError, match="not present in the model registry"):
        make_settings(**{setting: "mock/not-registered"})
    right = f"mock/{tier.lower()}"
    route = setting.removeprefix("karen_model_").upper()
    assert make_settings(**{setting: right}).task_route_models == {route: right}


def test_live_task_route_model_must_be_verified(make_settings: SettingsFactory, tmp_path: Path) -> None:
    path = write_registry(tmp_path / "r.json", verified=True)
    data = json.loads(path.read_text())
    specialist = {**data["models"][2], "model_id": "test-creator/coding-specialist", "verified_at": None}
    data["models"].append(specialist)
    path.write_text(json.dumps(data))
    with pytest.raises(
        ValidationError, match="KAREN_MODEL_CODING=test-creator/coding-specialist has verified_at=null"
    ):
        _live(make_settings, path, karen_model_coding="test-creator/coding-specialist")


def test_enabled_vision_model_must_support_images(make_settings: SettingsFactory, tmp_path: Path) -> None:
    registry = write_registry(
        tmp_path / "r.json", verified=True, changes={"mock/balanced": {"tiers": ["BALANCED", "VISION"]}}
    )
    with pytest.raises(ValidationError, match="does not support image input"):
        _live(make_settings, registry, karen_feature_vision_enabled=True, karen_model_vision="mock/balanced")
    vision_ok = write_registry(
        tmp_path / "v.json",
        verified=True,
        changes={"mock/balanced": {"tiers": ["BALANCED", "VISION"], "supports_vision": True}},
    )
    settings = _live(
        make_settings, vision_ok, karen_feature_vision_enabled=True, karen_model_vision="mock/balanced"
    )
    assert "VISION" in settings.enabled_tiers


def test_model_must_exist_in_registry(make_settings: SettingsFactory) -> None:
    with pytest.raises(ValidationError, match="not present in the model registry"):
        make_settings(karen_model_balanced="mock/not-registered")


def test_model_id_must_be_a_slug(make_settings: SettingsFactory) -> None:
    with pytest.raises(ValidationError, match="karen_model_balanced"):
        make_settings(karen_model_balanced="Not A Slug")


def test_missing_observability_never_fails(make_settings: SettingsFactory) -> None:
    settings = make_settings(
        langfuse_public_key="pk-test-only", sentry_dsn=None, otel_exporter_otlp_endpoint=None
    )
    assert settings.langfuse_secret_key is None


def test_secrets_are_not_rendered(make_settings: SettingsFactory) -> None:
    settings = make_settings(
        internal_service_hmac_secret=TEST_HMAC_SECRET, openrouter_api_key=TEST_GATEWAY_KEY
    )
    assert TEST_HMAC_SECRET not in repr(settings)
    assert TEST_GATEWAY_KEY not in repr(settings)
    assert TEST_GATEWAY_KEY not in settings.model_dump_json()


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


# ------------------------------------------------------------------------------------- voice


def test_voice_is_off_by_default_and_mock_catalog_loads(make_settings: SettingsFactory) -> None:
    settings = make_settings()
    assert not settings.karen_feature_voice_enabled
    assert settings.voice_catalog.catalog_version.endswith(".mock")


def test_live_voice_refuses_the_mock_catalog(make_settings: SettingsFactory, tmp_path: Path) -> None:
    registry = write_registry(tmp_path / "r.json", verified=True)
    with pytest.raises(ValidationError, match="points at the mock catalog"):
        _live(make_settings, registry, karen_feature_voice_enabled=True)


def test_live_voice_refuses_an_unverified_catalog(make_settings: SettingsFactory, tmp_path: Path) -> None:
    registry = write_registry(tmp_path / "r.json", verified=True)
    live_catalog = SERVICE_ROOT / "config" / "voice-catalog.live.json"
    with pytest.raises(ValidationError, match="speech-to-text model with verified_at"):
        _live(
            make_settings, registry, karen_feature_voice_enabled=True, karen_voice_catalog_path=live_catalog
        )


def test_live_voice_with_a_verified_catalog_starts(make_settings: SettingsFactory, tmp_path: Path) -> None:
    data = json.loads((SERVICE_ROOT / "config" / "voice-catalog.live.json").read_text())
    for model in [*data["stt_models"], *data["tts_models"], *data["voices"]]:
        model["verified_at"] = "2026-11-21"
    catalog = tmp_path / "voices.json"
    catalog.write_text(json.dumps(data))
    registry = write_registry(tmp_path / "r.json", verified=True)
    settings = _live(
        make_settings, registry, karen_feature_voice_enabled=True, karen_voice_catalog_path=catalog
    )
    assert settings.karen_feature_voice_enabled


def test_voice_catalog_path_must_exist(make_settings: SettingsFactory, tmp_path: Path) -> None:
    with pytest.raises(ValidationError, match="KAREN_VOICE_CATALOG_PATH"):
        make_settings(karen_voice_catalog_path=tmp_path / "missing.json")
