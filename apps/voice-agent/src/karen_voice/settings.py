"""Voice worker settings. LiveKit credentials are optional to *import* and test the worker, but
the CLI refuses to connect without them."""

from __future__ import annotations

from pathlib import Path
from typing import Annotated, Final, Literal

from pydantic import Field, SecretStr, StringConstraints, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

AppEnv = Literal["local", "test", "dev", "staging", "production"]
SIGNATURE_REQUIRED_ENVS: Final[frozenset[str]] = frozenset({"dev", "staging", "production"})
MIN_HMAC_SECRET_LENGTH: Final = 32


class VoiceSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", env_ignore_empty=True, extra="ignore", frozen=True
    )

    app_env: AppEnv = "local"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"

    livekit_url: Annotated[str, StringConstraints(pattern=r"^wss?://\S+$")] | None = None
    livekit_api_key: str | None = None
    livekit_api_secret: SecretStr | None = None
    voice_agent_health_port: Annotated[int, Field(ge=1, le=65535)] = 8200

    karen_feature_audio_enabled: bool = False
    karen_model_audio: str | None = None
    karen_model_registry_path: Path | None = None

    ai_service_url: Annotated[str, StringConstraints(pattern=r"^https?://\S+$")] = "http://localhost:8100"
    internal_service_hmac_secret: SecretStr | None = None

    otel_exporter_otlp_endpoint: str | None = None
    otel_service_name: str = "karen-voice-agent"
    sentry_dsn: SecretStr | None = None

    # Baked into container images: APP_ENV must then be set explicitly (no "local" default).
    karen_deployed_artifact: bool = False

    @property
    def livekit_configured(self) -> bool:
        return bool(self.livekit_url and self.livekit_api_key and self.livekit_api_secret)

    @property
    def missing_livekit_settings(self) -> list[str]:
        values = {
            "LIVEKIT_URL": self.livekit_url,
            "LIVEKIT_API_KEY": self.livekit_api_key,
            "LIVEKIT_API_SECRET": self.livekit_api_secret,
        }
        return [name for name, value in values.items() if not value]

    @model_validator(mode="after")
    def _validate(self) -> VoiceSettings:
        if self.karen_deployed_artifact and "app_env" not in self.model_fields_set:
            raise ValueError(
                "APP_ENV must be set explicitly in container images (KAREN_DEPLOYED_ARTIFACT=true)"
            )
        secret = self.internal_service_hmac_secret
        if secret is None and self.app_env in SIGNATURE_REQUIRED_ENVS:
            raise ValueError(f"INTERNAL_SERVICE_HMAC_SECRET is required when APP_ENV={self.app_env}")
        if secret is not None and len(secret.get_secret_value()) < MIN_HMAC_SECRET_LENGTH:
            raise ValueError(
                f"INTERNAL_SERVICE_HMAC_SECRET must be at least {MIN_HMAC_SECRET_LENGTH} characters"
            )
        return self
