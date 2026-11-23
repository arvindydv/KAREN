"""Service settings (pydantic-settings). Invalid configuration fails at startup, never later.

Model IDs are never hardcoded. Text tiers are routed automatically to the least expensive
qualified registry model (ADR-0026); ``KAREN_MODEL_<TIER>`` optionally pins one. In ``live`` mode
every enabled text tier needs a pinned or candidate registry entry whose capabilities and prices
were verified (``verified_at``); feature tiers (EMBEDDING/RERANKING/AUDIO) still need a pin.

The live gateway is OpenRouter (ADR-0025). ``OPENROUTER_API_KEY`` is read only here, held as a
``SecretStr`` and never logged, returned or exposed to clients. Speech providers are chosen
independently for STT and TTS (ADR-0027); ``DEEPGRAM_API_KEY`` follows the same rules.
"""

from __future__ import annotations

from pathlib import Path
from typing import Annotated, Final, Literal
from urllib.parse import quote

from pydantic import Field, PrivateAttr, SecretStr, StringConstraints, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from karen_ai.contracts import (
    MAX_SPEECH_TEXT_CHARS,
    MODEL_ID_PATTERN,
    TEXT_GENERATION_TIERS,
    ModelCapability,
    RouteTier,
)
from karen_ai.model_router.registry import ModelRegistry, RegistryError, load_registry
from karen_ai.speech.catalog import CatalogError, SpeechMode, SpeechProvider, VoiceCatalog, load_catalog

AppEnv = Literal["local", "test", "dev", "staging", "production"]
GatewayMode = Literal["mock", "live"]
BudgetStore = Literal["memory", "redis"]
DataCollection = Literal["allow", "deny"]
# Workloads that may run on a dedicated model while keeping their tier's budget class (ADR-0025).
TaskRoute = Literal["CODING", "DOCUMENT_ANALYSIS", "VOICE"]
# VOICE (ADR-0031): spoken conversation turns, where time to first word matters most.
TASK_ROUTE_TIERS: Final[dict[TaskRoute, RouteTier]] = {
    "CODING": "REASONING",
    "DOCUMENT_ANALYSIS": "BALANCED",
    "VOICE": "BALANCED",
}

SERVICE_ROOT: Final = Path(__file__).resolve().parents[3]
MOCK_REGISTRY_PATH: Final = SERVICE_ROOT / "config" / "model-registry.mock.json"
MOCK_VOICE_CATALOG_PATH: Final = SERVICE_ROOT / "config" / "voice-catalog.mock.json"
DeepgramRegion = Literal["global", "in", "eu", "au"]

# Always-on text tiers; VISION is a text tier too but behind KAREN_FEATURE_VISION_ENABLED.
BASE_TEXT_TIERS: Final[frozenset[RouteTier]] = frozenset({"ECONOMY", "BALANCED", "REASONING"})
FEATURE_TIERS: Final[tuple[RouteTier, ...]] = ("VISION", "EMBEDDING", "RERANKING", "AUDIO")
SIGNATURE_REQUIRED_ENVS: Final[frozenset[AppEnv]] = frozenset({"dev", "staging", "production"})
MIN_HMAC_SECRET_LENGTH: Final = 32

ModelIdSetting = Annotated[str, StringConstraints(pattern=MODEL_ID_PATTERN)] | None


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_ignore_empty=True,
        extra="ignore",
        frozen=True,
    )

    app_env: AppEnv = "local"
    ai_service_port: Annotated[int, Field(ge=1, le=65535)] = 8100
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"

    openrouter_base_url: Annotated[str, StringConstraints(pattern=r"^https?://\S+$")] = (
        "https://openrouter.ai/api/v1"
    )
    openrouter_api_key: SecretStr | None = None
    # Provider routing policy sent with every request: only endpoints that do not collect
    # prompts (deny) and, by default, only zero-data-retention endpoints (architecture §9).
    openrouter_data_collection: DataCollection = "deny"
    openrouter_zdr: bool = True
    karen_ai_gateway_mode: GatewayMode = "mock"

    karen_model_economy: ModelIdSetting = None
    karen_model_economy_fallback: ModelIdSetting = None
    karen_model_balanced: ModelIdSetting = None
    karen_model_balanced_fallback: ModelIdSetting = None
    karen_model_reasoning: ModelIdSetting = None
    karen_model_reasoning_fallback: ModelIdSetting = None
    # Optional task-specific models; unset = the tier's model serves the task.
    karen_model_coding: ModelIdSetting = None
    karen_model_document_analysis: ModelIdSetting = None
    # Spoken turns (reply_style=spoken): a low-latency model; unset = the BALANCED selection.
    karen_model_voice: ModelIdSetting = None
    karen_model_vision: ModelIdSetting = None
    karen_model_embedding: ModelIdSetting = None
    karen_model_reranking: ModelIdSetting = None
    karen_model_audio: ModelIdSetting = None
    karen_model_registry_path: Path = MOCK_REGISTRY_PATH

    karen_ai_max_output_tokens: Annotated[int, Field(gt=0, le=32_000)] = 1500
    karen_ai_request_timeout_seconds: Annotated[float, Field(gt=0, le=300)] = 20.0
    karen_ai_max_retries: Annotated[int, Field(ge=0, le=5)] = 2
    karen_ai_max_request_cost_usd: Annotated[float, Field(gt=0)] = 0.10
    karen_ai_daily_budget_usd: Annotated[float, Field(gt=0)] = 100.0
    karen_ai_allow_direct_provider_fallback: bool = False

    karen_feature_vision_enabled: bool = False
    # Voice: speech-to-text and text-to-speech (ADR-0026). Off by default; mock providers in mock mode.
    karen_feature_voice_enabled: bool = False
    karen_voice_catalog_path: Path = MOCK_VOICE_CATALOG_PATH
    # Operator-set per-request reservations (speech billing units are not documented upstream).
    karen_voice_stt_reserve_usd: Annotated[float, Field(gt=0, le=1)] = 0.01
    karen_voice_tts_reserve_usd: Annotated[float, Field(gt=0, le=1)] = 0.02
    karen_voice_max_speech_chars: Annotated[int, Field(ge=100, le=MAX_SPEECH_TEXT_CHARS)] = 2000
    karen_voice_timeout_seconds: Annotated[float, Field(gt=0, le=120)] = 30.0
    # Speech providers, independently replaceable (ADR-0027). Unset = "mock" in mock gateway
    # mode, "openrouter" in live mode (the ADR-0026 behaviour).
    karen_voice_stt_provider: SpeechProvider | None = None
    karen_voice_tts_provider: SpeechProvider | None = None
    # Live (streaming) voice conversations: partial transcripts + turn detection (ADR-0027).
    karen_feature_voice_live_enabled: bool = False
    karen_voice_live_max_seconds: Annotated[int, Field(ge=30, le=1800)] = 300
    karen_voice_live_idle_seconds: Annotated[int, Field(ge=5, le=120)] = 20

    # Deepgram (speech only; backend-only secret, never logged or returned).
    deepgram_api_key: SecretStr | None = None
    # global = api.deepgram.com; in = api.in.deepgram.com (served and kept in India).
    deepgram_region: DeepgramRegion = "global"
    # Opt out of Deepgram's Model Improvement Program (audio not used for training).
    deepgram_mip_opt_out: bool = True
    # Optional pins (catalog IDs, e.g. "deepgram/<model>"); unset = first verified catalog entry.
    deepgram_stt_model: ModelIdSetting = None
    deepgram_stt_live_model: ModelIdSetting = None
    deepgram_tts_model: ModelIdSetting = None
    # Flux end-of-turn tuning (Deepgram defaults 0.7 / 5000 ms).
    # Turn-taking (ADR-0031/0032): measured live 2026-11-22 — Deepgram's defaults (0.7 / 5000 ms)
    # ended a turn ~1.0 s after speech; 0.5 / 1000 ms ends it ~0.7 s after (owner target: answer
    # ~1.5 s after the user stops). A long thinking pause may end a turn early.
    deepgram_eot_threshold: Annotated[float, Field(ge=0.5, le=0.9)] = 0.5
    deepgram_eot_timeout_ms: Annotated[int, Field(ge=500, le=10_000)] = 1000
    karen_feature_embedding_enabled: bool = False
    karen_feature_reranking_enabled: bool = False
    karen_feature_audio_enabled: bool = False

    internal_service_hmac_secret: SecretStr | None = None
    # Rotation (docs/security/internal-service-auth.md): verifier also accepts this key while
    # callers move to the new INTERNAL_SERVICE_HMAC_SECRET. Unset outside a rotation window.
    internal_service_hmac_secret_previous: SecretStr | None = None

    # Shared coordination store (ADR-0013): daily AI budget + internal-auth replay cache.
    # Either REDIS_URL (local) or the ECS-style parts injected by Terraform.
    redis_url: SecretStr | None = None
    redis_host: str | None = None
    redis_port: Annotated[int, Field(ge=1, le=65535)] = 6379
    redis_tls: bool = False
    redis_auth_token: SecretStr | None = None
    # Defaults to "redis" when deployed (dev/staging/production), "memory" in local/test.
    karen_ai_budget_store: BudgetStore | None = None

    # Baked into container images: APP_ENV must then be set explicitly (no "local" default).
    karen_deployed_artifact: bool = False
    log_pseudonymization_key: SecretStr | None = None

    otel_exporter_otlp_endpoint: str | None = None
    otel_service_name: str = "karen-ai-service"
    sentry_dsn: SecretStr | None = None
    langfuse_public_key: str | None = None
    langfuse_secret_key: SecretStr | None = None
    langfuse_host: str | None = None

    _registry: ModelRegistry | None = PrivateAttr(default=None)
    _voice_catalog: VoiceCatalog | None = PrivateAttr(default=None)

    # ----------------------------------------------------------------------------- derived

    @property
    def is_mock(self) -> bool:
        return self.karen_ai_gateway_mode == "mock"

    @property
    def signature_required(self) -> bool:
        return self.app_env in SIGNATURE_REQUIRED_ENVS or self.internal_service_hmac_secret is not None

    @property
    def is_deployed(self) -> bool:
        return self.app_env in SIGNATURE_REQUIRED_ENVS

    @property
    def budget_store(self) -> BudgetStore:
        if self.karen_ai_budget_store is not None:
            return self.karen_ai_budget_store
        return "redis" if self.is_deployed else "memory"

    @property
    def redis_connection_url(self) -> str | None:
        """Effective Redis URL (contains the auth token: never log it)."""
        if self.redis_url is not None:
            return self.redis_url.get_secret_value()
        if self.redis_host is None:
            return None
        scheme = "rediss" if self.redis_tls else "redis"
        token = self.redis_auth_token.get_secret_value() if self.redis_auth_token else None
        auth = f":{quote(token, safe='')}@" if token else ""
        return f"{scheme}://{auth}{self.redis_host}:{self.redis_port}"

    @property
    def internal_hmac_secrets(self) -> tuple[str, ...]:
        """Accepted verification keys: current first, then the previous one during rotation."""
        keys = [self.internal_service_hmac_secret, self.internal_service_hmac_secret_previous]
        return tuple(k.get_secret_value() for k in keys if k is not None)

    @property
    def registry(self) -> ModelRegistry:
        if self._registry is None:  # pragma: no cover - set by the validator
            raise RuntimeError("settings were not validated")
        return self._registry

    @property
    def stt_provider(self) -> SpeechProvider:
        default: SpeechProvider = "mock" if self.is_mock else "openrouter"
        return self.karen_voice_stt_provider or default

    @property
    def tts_provider(self) -> SpeechProvider:
        default: SpeechProvider = "mock" if self.is_mock else "openrouter"
        return self.karen_voice_tts_provider or default

    def stt_models(self, mode: SpeechMode) -> tuple[str, ...]:
        """Catalog STT models the configured provider may use, preferred first (pin wins)."""
        provider = self.stt_provider
        models = self.voice_catalog.usable_stt(
            require_verified=provider != "mock", provider=provider, mode=mode
        )
        pin = self.deepgram_stt_live_model if mode == "live" else self.deepgram_stt_model
        if provider == "deepgram" and pin is not None:
            return tuple(m for m in models if m == pin)
        return models

    def tts_voice_models(self) -> frozenset[str] | None:
        """TTS model restriction from the pin (``None`` = every catalog model of the provider)."""
        if self.tts_provider == "deepgram" and self.deepgram_tts_model is not None:
            return frozenset({self.deepgram_tts_model})
        return None

    @property
    def voice_catalog(self) -> VoiceCatalog:
        if self._voice_catalog is None:  # pragma: no cover - set by the validator
            raise RuntimeError("settings were not validated")
        return self._voice_catalog

    @property
    def enabled_tiers(self) -> frozenset[RouteTier]:
        flags: dict[RouteTier, bool] = {
            "VISION": self.karen_feature_vision_enabled,
            "EMBEDDING": self.karen_feature_embedding_enabled,
            "RERANKING": self.karen_feature_reranking_enabled,
            "AUDIO": self.karen_feature_audio_enabled,
        }
        enabled: set[RouteTier] = {"NO_MODEL", *BASE_TEXT_TIERS}
        enabled.update(tier for tier, on in flags.items() if on)
        return frozenset(enabled)

    @property
    def tier_models(self) -> dict[RouteTier, str | None]:
        """Operator pins per tier (``None`` = the router chooses automatically)."""
        configured: dict[RouteTier, str | None] = {
            "ECONOMY": self.karen_model_economy,
            "BALANCED": self.karen_model_balanced,
            "REASONING": self.karen_model_reasoning,
            "VISION": self.karen_model_vision,
            "EMBEDDING": self.karen_model_embedding,
            "RERANKING": self.karen_model_reranking,
            "AUDIO": self.karen_model_audio,
        }
        return configured

    @property
    def tier_fallbacks(self) -> dict[RouteTier, str]:
        """Gateway-side fallback model per text tier (only where configured)."""
        configured: dict[RouteTier, str | None] = {
            "ECONOMY": self.karen_model_economy_fallback,
            "BALANCED": self.karen_model_balanced_fallback,
            "REASONING": self.karen_model_reasoning_fallback,
        }
        return {tier: model for tier, model in configured.items() if model}

    @property
    def task_route_models(self) -> dict[TaskRoute, str]:
        """Task-specific models (only where configured); they run on ``TASK_ROUTE_TIERS``."""
        configured: dict[TaskRoute, str | None] = {
            "CODING": self.karen_model_coding,
            "DOCUMENT_ANALYSIS": self.karen_model_document_analysis,
            "VOICE": self.karen_model_voice,
        }
        return {route: model for route, model in configured.items() if model}

    # -------------------------------------------------------------------------- validation

    @model_validator(mode="after")
    def _validate(self) -> Settings:
        if self.karen_ai_allow_direct_provider_fallback:
            raise ValueError(
                "KAREN_AI_ALLOW_DIRECT_PROVIDER_FALLBACK=true is refused: no direct-provider "
                "path is implemented or approved (architecture §2.1). Set it to false."
            )
        if self.karen_deployed_artifact and "app_env" not in self.model_fields_set:
            raise ValueError(
                "APP_ENV must be set explicitly in container images (KAREN_DEPLOYED_ARTIFACT=true)"
            )
        self._validate_internal_auth()
        self._validate_coordination_store()
        if self.app_env == "production" and self.is_mock:
            raise ValueError("KAREN_AI_GATEWAY_MODE=mock is not allowed when APP_ENV=production")
        try:
            self._registry = load_registry(self.karen_model_registry_path)
        except RegistryError as exc:
            raise ValueError(f"KAREN_MODEL_REGISTRY_PATH: {exc}") from exc
        if not self.is_mock:
            self._validate_live_gateway()
        self._validate_tier_models()
        self._validate_voice()
        return self

    def _validate_voice(self) -> None:
        try:
            self._voice_catalog = load_catalog(self.karen_voice_catalog_path)
        except CatalogError as exc:
            raise ValueError(f"KAREN_VOICE_CATALOG_PATH: {exc}") from exc
        providers = {self.stt_provider, self.tts_provider}
        if self.app_env == "production" and "mock" in providers:
            raise ValueError("mock speech providers are not allowed when APP_ENV=production")
        if "deepgram" in providers and self.deepgram_api_key is None and self.karen_feature_voice_enabled:
            raise ValueError("DEEPGRAM_API_KEY is required when a speech provider is deepgram")
        if "openrouter" in providers and self.openrouter_api_key is None and self.karen_feature_voice_enabled:
            raise ValueError("OPENROUTER_API_KEY is required when a speech provider is openrouter")
        self._validate_deepgram_pins()
        if not self.karen_feature_voice_enabled or providers == {"mock"}:
            return
        if self.karen_voice_catalog_path.resolve() == MOCK_VOICE_CATALOG_PATH.resolve():
            raise ValueError(
                "KAREN_VOICE_CATALOG_PATH points at the mock catalog; live voice needs a verified one"
            )
        if self.stt_provider != "mock" and not self.stt_models("batch"):
            raise ValueError(
                "live voice needs at least one speech-to-text model with verified_at in the catalog "
                f"for provider {self.stt_provider}"
            )
        if (
            self.karen_feature_voice_live_enabled
            and self.stt_provider != "mock"
            and not self.stt_models("live")
        ):
            raise ValueError(
                "KAREN_FEATURE_VOICE_LIVE_ENABLED needs a verified live speech-to-text model in the catalog"
            )
        if self.tts_provider != "mock":
            restrict = self.tts_voice_models()
            voices = [
                v
                for v in self.voice_catalog.usable_voices(require_verified=True, provider=self.tts_provider)
                if restrict is None or v.model_id in restrict
            ]
            if not {"en", "hi"} <= {v.language for v in voices}:
                raise ValueError("live voice needs verified English and Hindi voices in the voice catalog")

    def _validate_deepgram_pins(self) -> None:
        catalog = self.voice_catalog
        pins: list[tuple[str, str | None, Literal["stt", "tts"], SpeechMode]] = [
            ("DEEPGRAM_STT_MODEL", self.deepgram_stt_model, "stt", "batch"),
            ("DEEPGRAM_STT_LIVE_MODEL", self.deepgram_stt_live_model, "stt", "live"),
            ("DEEPGRAM_TTS_MODEL", self.deepgram_tts_model, "tts", "batch"),
        ]
        for env_name, pin, kind, mode in pins:
            if pin is None:
                continue
            entry = catalog.stt_model(pin) if kind == "stt" else catalog.tts_model(pin)
            if entry is None or entry.provider != "deepgram":
                raise ValueError(f"{env_name}={pin} is not a deepgram model in the voice catalog")
            if mode not in entry.modes:
                raise ValueError(f"{env_name}={pin} does not support {mode} mode in the voice catalog")

    def _validate_internal_auth(self) -> None:
        secret = self.internal_service_hmac_secret
        if secret is None:
            if self.internal_service_hmac_secret_previous is not None:
                raise ValueError(
                    "INTERNAL_SERVICE_HMAC_SECRET_PREVIOUS requires INTERNAL_SERVICE_HMAC_SECRET"
                )
            if self.app_env in SIGNATURE_REQUIRED_ENVS:
                raise ValueError(f"INTERNAL_SERVICE_HMAC_SECRET is required when APP_ENV={self.app_env}")
            return
        for name, value in (
            ("INTERNAL_SERVICE_HMAC_SECRET", secret),
            ("INTERNAL_SERVICE_HMAC_SECRET_PREVIOUS", self.internal_service_hmac_secret_previous),
        ):
            if value is not None and len(value.get_secret_value()) < MIN_HMAC_SECRET_LENGTH:
                raise ValueError(f"{name} must be at least {MIN_HMAC_SECRET_LENGTH} characters")

    def _validate_coordination_store(self) -> None:
        if self.redis_url is not None and not self.redis_url.get_secret_value().startswith(
            ("redis://", "rediss://")
        ):
            raise ValueError("REDIS_URL must be a redis:// or rediss:// URL")
        if self.is_deployed and self.budget_store != "redis":
            raise ValueError(
                f"KAREN_AI_BUDGET_STORE=memory is not allowed when APP_ENV={self.app_env}: the daily "
                "AI budget must be enforced atomically across replicas (ADR-0013)"
            )
        if self.budget_store == "redis" and self.redis_connection_url is None:
            raise ValueError("REDIS_URL or REDIS_HOST is required for the shared AI budget store")

    def _validate_live_gateway(self) -> None:
        if self.openrouter_api_key is None:
            raise ValueError("OPENROUTER_API_KEY is required when KAREN_AI_GATEWAY_MODE=live")
        if not self.openrouter_base_url.startswith("https://"):
            raise ValueError("OPENROUTER_BASE_URL must use https when KAREN_AI_GATEWAY_MODE=live")
        if self.app_env == "production" and self.openrouter_data_collection != "deny":
            raise ValueError(
                "OPENROUTER_DATA_COLLECTION=allow is not allowed when APP_ENV=production: user "
                "prompts must not reach providers that store or train on them (architecture §9)"
            )
        if self.karen_model_registry_path.resolve() == MOCK_REGISTRY_PATH.resolve():
            raise ValueError(
                "KAREN_MODEL_REGISTRY_PATH points at the mock registry; live mode needs a registry "
                "verified against the live gateway catalog"
            )

    def _validate_tier_models(self) -> None:
        pins = self.tier_models
        for tier in sorted(self.enabled_tiers - {"NO_MODEL"}):
            env_name, pin = f"KAREN_MODEL_{tier}", pins[tier]
            if pin is not None:
                entry = self._checked_entry(env_name, pin)
                if tier not in entry.tiers:
                    raise ValueError(f"{env_name}={pin} must list tier {tier} in the model registry")
                if tier == "VISION" and not entry.supports_vision:
                    raise ValueError(f"{env_name}={pin} does not support image input in the registry")
                continue
            if tier not in TEXT_GENERATION_TIERS:
                if self.is_mock:
                    continue  # mock mode serves no feature tiers; requests get CAPABILITY_UNAVAILABLE
                raise ValueError(f"{env_name} must be set for an enabled tier in live mode")
            if not self._has_candidate(tier):
                raise ValueError(
                    f"no {'verified ' if not self.is_mock else ''}registry model serves tier {tier}: "
                    f"set {env_name} or add a candidate to the registry"
                )
        # (env name, model id, tier the entry must list)
        optional: list[tuple[str, str, RouteTier]] = [
            *((f"KAREN_MODEL_{tier}_FALLBACK", model, tier) for tier, model in self.tier_fallbacks.items()),
            *(
                (f"KAREN_MODEL_{route}", model, TASK_ROUTE_TIERS[route])
                for route, model in self.task_route_models.items()
            ),
        ]
        for env_name, model_id, tier in optional:
            entry = self._checked_entry(env_name, model_id)
            if tier not in entry.tiers:
                raise ValueError(f"{env_name}={model_id} must list tier {tier} in the model registry")

    def _has_candidate(self, tier: RouteTier) -> bool:
        return any(
            tier in m.tiers
            and (self.is_mock or m.verified_at is not None)
            and (tier != "VISION" or m.supports_vision)
            for m in self.registry.models
        )

    def _checked_entry(self, env_name: str, model_id: str) -> ModelCapability:
        entry = self.registry.get(model_id)
        if entry is None:
            raise ValueError(f"{env_name}={model_id} is not present in the model registry")
        if not self.is_mock and entry.verified_at is None:
            raise ValueError(
                f"{env_name}={model_id} has verified_at=null in the registry; live mode "
                "requires capabilities and prices verified against the live gateway catalog"
            )
        return entry
