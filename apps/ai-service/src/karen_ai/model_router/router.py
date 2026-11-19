"""Task-kind -> tier mapping and registry capability checks.

Callers state *intent* (``task_kind``), never a model ID. The router never calls a model.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Final

from karen_ai.contracts import TEXT_GENERATION_TIERS, ModelCapability, RouteTier, TaskKind
from karen_ai.core.errors import KarenAIError
from karen_ai.core.settings import Settings
from karen_ai.model_router.registry import ModelRegistry

TASK_KIND_TIERS: Final[Mapping[TaskKind, RouteTier]] = {
    "DETERMINISTIC": "NO_MODEL",
    "INTENT_CLASSIFICATION": "ECONOMY",
    "EXTRACTION": "ECONOMY",
    "SHORT_REWRITE": "ECONOMY",
    "CHAT": "BALANCED",
    "SUMMARY": "BALANCED",
    "BASIC_PLANNING": "BALANCED",
    "COMPLEX_PLANNING": "REASONING",
    "COMPARISON": "REASONING",
}

# Only tiers listed here may use a gateway-side fallback model.
_FALLBACK_TIERS: Final[frozenset[RouteTier]] = frozenset({"BALANCED"})


@dataclass(frozen=True)
class RouteRequirements:
    stream: bool
    input_tokens: int
    max_output_tokens: int


@dataclass(frozen=True)
class RouteDecision:
    tier: RouteTier
    primary: ModelCapability | None  # None only for NO_MODEL
    fallbacks: tuple[ModelCapability, ...] = ()

    @property
    def candidates(self) -> tuple[ModelCapability, ...]:
        return ((self.primary,) if self.primary else ()) + self.fallbacks


def _satisfies(model: ModelCapability, req: RouteRequirements) -> str | None:
    """Return the unmet requirement, or ``None`` when the model can serve the request."""
    if req.stream and not model.supports_streaming:
        return "streaming"
    if req.max_output_tokens > model.max_output_tokens:
        return "max_output_tokens"
    if req.input_tokens + req.max_output_tokens > model.max_context_tokens:
        return "context window"
    return None


def _equivalent(primary: ModelCapability, candidate: ModelCapability, tier: RouteTier) -> bool:
    """A fallback must not silently drop a capability the primary offers (architecture §2.5)."""
    return (
        tier in candidate.tiers
        and candidate.supports_streaming >= primary.supports_streaming
        and candidate.supports_tools >= primary.supports_tools
        and candidate.supports_json_schema >= primary.supports_json_schema
        and candidate.supports_vision >= primary.supports_vision
    )


class ModelRouter:
    def __init__(
        self,
        *,
        registry: ModelRegistry,
        tier_models: Mapping[RouteTier, str | None],
        enabled_tiers: frozenset[RouteTier],
        balanced_fallback: str | None = None,
    ) -> None:
        self._registry = registry
        self._tier_models = dict(tier_models)
        self._enabled = enabled_tiers
        self._balanced_fallback = balanced_fallback

    @classmethod
    def from_settings(cls, settings: Settings) -> ModelRouter:
        return cls(
            registry=settings.registry,
            tier_models=settings.tier_models,
            enabled_tiers=settings.enabled_tiers,
            balanced_fallback=settings.karen_model_balanced_fallback,
        )

    @staticmethod
    def select_tier(task_kind: TaskKind, explicit_tier: RouteTier | None = None) -> RouteTier:
        return explicit_tier or TASK_KIND_TIERS[task_kind]

    def model_for(self, tier: RouteTier) -> ModelCapability:
        """The registry entry serving ``tier``; raises if the tier cannot serve text completions."""
        if tier not in self._enabled:
            raise KarenAIError("TIER_DISABLED", f"Route tier {tier} is disabled by feature flag.")
        if tier not in TEXT_GENERATION_TIERS:
            raise KarenAIError(
                "CAPABILITY_UNAVAILABLE", f"Route tier {tier} is not served by the text completion API."
            )
        model_id = self._tier_models.get(tier)
        model = self._registry.get(model_id) if model_id else None
        if model is None or tier not in model.tiers:
            raise KarenAIError("CAPABILITY_UNAVAILABLE", f"No registry model is configured for tier {tier}.")
        return model

    def route(self, tier: RouteTier, requirements: RouteRequirements) -> RouteDecision:
        if tier == "NO_MODEL":
            return RouteDecision(tier="NO_MODEL", primary=None)
        primary = self.model_for(tier)
        unmet = _satisfies(primary, requirements)
        if unmet is not None:
            raise KarenAIError(
                "CAPABILITY_UNAVAILABLE", f"Model for tier {tier} does not support the request ({unmet})."
            )
        return RouteDecision(
            tier=tier, primary=primary, fallbacks=self._fallbacks(tier, primary, requirements)
        )

    def _fallbacks(
        self, tier: RouteTier, primary: ModelCapability, requirements: RouteRequirements
    ) -> tuple[ModelCapability, ...]:
        if tier not in _FALLBACK_TIERS or not self._balanced_fallback:
            return ()
        candidate = self._registry.get(self._balanced_fallback)
        if (
            candidate is None
            or candidate.model_id == primary.model_id
            or not _equivalent(primary, candidate, tier)
            or _satisfies(candidate, requirements) is not None
        ):
            return ()
        return (candidate,)
