"""Task-aware, budget-aware model selection (ADR-0026). The router never calls a model.

Callers state *intent* (``task_kind``), never a model ID. For each request:

1. ``task_kind`` -> task profile (tier, required capabilities, quality floor, latency ceiling);
   an explicit ``route_tier`` replaces the tier and uses a neutral profile.
2. A pinned model (``KAREN_MODEL_CODING`` / ``_DOCUMENT_ANALYSIS`` for the task, else
   ``KAREN_MODEL_<TIER>``) wins: it is an operator override.
3. Otherwise the candidates are registry models that list the tier, have every required
   capability, meet the quality floor and latency ceiling, fit the context window, are verified
   (live mode), and whose worst-case cost for *this* request fits the budget cap. They are ranked
   by worst-case cost, then latency, then quality: the primary is the least expensive qualified
   model, and the next equivalent candidates become gateway fallbacks.

Nothing here touches the network; budget reservations still happen in the completion service.
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from dataclasses import dataclass, replace
from typing import Final, Literal

from karen_ai.contracts import TEXT_GENERATION_TIERS, ModelCapability, RouteTier, TaskKind
from karen_ai.core.errors import KarenAIError
from karen_ai.core.settings import TASK_ROUTE_TIERS, Settings, TaskRoute
from karen_ai.model_router.profiles import TASK_PROFILES, TaskProfile, profile_for
from karen_ai.model_router.registry import ModelRegistry
from karen_ai.policies.budget import cost_usd

# Gateway fallbacks after the primary (OpenRouter tries them in order).
MAX_FALLBACKS: Final = 2

Selection = Literal["pinned", "auto", "none"]

# Kept for callers that only need the tier mapping.
TASK_KIND_TIERS: Final[Mapping[TaskKind, RouteTier]] = {k: p.tier for k, p in TASK_PROFILES.items()}
TASK_KIND_ROUTES: Final[Mapping[TaskKind, TaskRoute]] = {
    k: p.task_route for k, p in TASK_PROFILES.items() if p.task_route is not None
}


@dataclass(frozen=True)
class RouteRequirements:
    stream: bool
    input_tokens: int
    max_output_tokens: int
    # Worst-case spend allowed for this request (min of service and caller caps); None = no cap.
    max_cost_usd: float | None = None
    needs_vision: bool = False


@dataclass(frozen=True)
class RouteDecision:
    tier: RouteTier
    primary: ModelCapability | None  # None only for NO_MODEL
    fallbacks: tuple[ModelCapability, ...] = ()
    task_route: TaskRoute | None = None  # set when a task-specific pin was used
    selection: Selection = "none"
    # Output budget actually requested (the caller's limit clipped to the primary's maximum).
    max_output_tokens: int = 0

    @property
    def candidates(self) -> tuple[ModelCapability, ...]:
        return ((self.primary,) if self.primary else ()) + self.fallbacks


def _satisfies(model: ModelCapability, req: RouteRequirements) -> str | None:
    """Return the unmet hard requirement, or ``None`` when the model can serve the request."""
    if req.stream and not model.supports_streaming:
        return "streaming"
    if req.needs_vision and not model.supports_vision:
        return "image input"
    if req.input_tokens + min(req.max_output_tokens, model.max_output_tokens) > model.max_context_tokens:
        return "context window"
    return None


def _meets_profile(model: ModelCapability, profile: TaskProfile) -> bool:
    if profile.needs_json_schema and not model.supports_json_schema:
        return False
    if profile.needs_vision and not model.supports_vision:
        return False
    if profile.min_quality_index is not None and (
        model.quality_index is None or model.quality_index < profile.min_quality_index
    ):
        return False
    return not (
        profile.max_latency_p50_ms is not None
        and model.latency_p50_ms is not None
        and model.latency_p50_ms > profile.max_latency_p50_ms
    )


def _equivalent(primary: ModelCapability, candidate: ModelCapability, tier: RouteTier) -> bool:
    """A fallback must not silently drop a capability the primary offers (architecture §2.5)."""
    return (
        tier in candidate.tiers
        and candidate.supports_streaming >= primary.supports_streaming
        and candidate.supports_tools >= primary.supports_tools
        and candidate.supports_json_schema >= primary.supports_json_schema
        and candidate.supports_vision >= primary.supports_vision
    )


def worst_case_for(model: ModelCapability, req: RouteRequirements) -> float:
    return cost_usd(model, req.input_tokens, min(req.max_output_tokens, model.max_output_tokens))


def _within_budget(model: ModelCapability, req: RouteRequirements) -> bool:
    return req.max_cost_usd is None or worst_case_for(model, req) <= req.max_cost_usd


def _rank_key(model: ModelCapability, req: RouteRequirements) -> tuple[float, float, float, str]:
    latency = model.latency_p50_ms if model.latency_p50_ms is not None else math.inf
    quality = model.quality_index if model.quality_index is not None else -1.0
    return (round(worst_case_for(model, req), 9), latency, -quality, model.model_id)


class ModelRouter:
    def __init__(
        self,
        *,
        registry: ModelRegistry,
        tier_models: Mapping[RouteTier, str | None],
        enabled_tiers: frozenset[RouteTier],
        tier_fallbacks: Mapping[RouteTier, str] | None = None,
        task_route_models: Mapping[TaskRoute, str] | None = None,
        require_verified: bool = False,
    ) -> None:
        self._registry = registry
        self._pins = dict(tier_models)
        self._enabled = enabled_tiers
        self._tier_fallbacks = dict(tier_fallbacks or {})
        self._task_route_models = dict(task_route_models or {})
        self._require_verified = require_verified

    @classmethod
    def from_settings(cls, settings: Settings) -> ModelRouter:
        return cls(
            registry=settings.registry,
            tier_models=settings.tier_models,
            enabled_tiers=settings.enabled_tiers,
            tier_fallbacks=settings.tier_fallbacks,
            task_route_models=settings.task_route_models,
            require_verified=not settings.is_mock,
        )

    @staticmethod
    def select_tier(task_kind: TaskKind, explicit_tier: RouteTier | None = None) -> RouteTier:
        return explicit_tier or TASK_PROFILES[task_kind].tier

    def task_route_for(self, task_kind: TaskKind, tier: RouteTier) -> TaskRoute | None:
        """The task route whose pin applies: configured, and the request runs on its tier."""
        route = TASK_PROFILES[task_kind].task_route
        if route is None or route not in self._task_route_models or TASK_ROUTE_TIERS[route] != tier:
            return None
        return route

    # ------------------------------------------------------------------------------ routing

    def route(
        self,
        tier: RouteTier,
        requirements: RouteRequirements,
        *,
        task_kind: TaskKind | None = None,
        task_route: TaskRoute | None = None,
    ) -> RouteDecision:
        """``task_route`` (e.g. VOICE for spoken turns) applies only when configured for this tier."""
        if tier == "NO_MODEL":
            return RouteDecision(tier="NO_MODEL", primary=None)
        self._check_tier(tier)
        profile = profile_for(task_kind, tier)
        req = replace(requirements, needs_vision=requirements.needs_vision or profile.needs_vision)
        if task_route is not None and (
            task_route not in self._task_route_models or TASK_ROUTE_TIERS[task_route] != tier
        ):
            task_route = None
        if task_route is None and task_kind is not None:
            task_route = self.task_route_for(task_kind, tier)
        pin = self._task_route_models[task_route] if task_route else self._pins.get(tier)
        if pin is not None:
            return self._route_pinned(tier, req, pin, task_route)
        return self._route_auto(tier, req, profile)

    def _check_tier(self, tier: RouteTier) -> None:
        if tier not in self._enabled:
            raise KarenAIError("TIER_DISABLED", f"Route tier {tier} is disabled by feature flag.")
        if tier not in TEXT_GENERATION_TIERS:
            raise KarenAIError(
                "CAPABILITY_UNAVAILABLE", f"Route tier {tier} is not served by the text completion API."
            )

    def _eligible(self, model: ModelCapability, tier: RouteTier) -> bool:
        return tier in model.tiers and (not self._require_verified or model.verified_at is not None)

    def _route_pinned(
        self, tier: RouteTier, req: RouteRequirements, pin: str, task_route: TaskRoute | None
    ) -> RouteDecision:
        primary = self._registry.get(pin)
        if primary is None or not self._eligible(primary, tier):
            label = f"task route {task_route}" if task_route else f"tier {tier}"
            raise KarenAIError("CAPABILITY_UNAVAILABLE", f"No registry model is configured for {label}.")
        unmet = _satisfies(primary, req)
        if unmet is not None:
            raise KarenAIError(
                "CAPABILITY_UNAVAILABLE", f"Model for tier {tier} does not support the request ({unmet})."
            )
        req = replace(req, max_output_tokens=min(req.max_output_tokens, primary.max_output_tokens))
        explicit = [self._pins.get(tier)] if task_route is not None else []
        explicit.append(self._tier_fallbacks.get(tier))
        chain = [m for m in (self._registry.get(i) for i in explicit if i) if m is not None]
        if not chain:  # no operator fallback: offer the cheapest qualified alternatives
            chain = self._ranked(tier, req, profile_for(None, tier))
        return RouteDecision(
            tier=tier,
            primary=primary,
            fallbacks=self._fallbacks(tier, primary, req, chain),
            task_route=task_route,
            selection="pinned",
            max_output_tokens=req.max_output_tokens,
        )

    def _ranked(self, tier: RouteTier, req: RouteRequirements, profile: TaskProfile) -> list[ModelCapability]:
        qualified = [
            m
            for m in self._registry.models
            if self._eligible(m, tier) and _meets_profile(m, profile) and _satisfies(m, req) is None
        ]
        return sorted((m for m in qualified if _within_budget(m, req)), key=lambda m: _rank_key(m, req))

    def _route_auto(self, tier: RouteTier, req: RouteRequirements, profile: TaskProfile) -> RouteDecision:
        ranked = self._ranked(tier, req, profile)
        if not ranked:
            unbudgeted = self._ranked(tier, replace(req, max_cost_usd=None), profile)
            if unbudgeted:
                raise KarenAIError(
                    "BUDGET_EXCEEDED",
                    f"No qualified model for tier {tier} fits the request budget.",
                )
            raise KarenAIError(
                "CAPABILITY_UNAVAILABLE", f"No registry model for tier {tier} meets the task requirements."
            )
        primary = ranked[0]
        req = replace(req, max_output_tokens=min(req.max_output_tokens, primary.max_output_tokens))
        return RouteDecision(
            tier=tier,
            primary=primary,
            fallbacks=self._fallbacks(tier, primary, req, ranked[1:]),
            selection="auto",
            max_output_tokens=req.max_output_tokens,
        )

    @staticmethod
    def _fallbacks(
        tier: RouteTier, primary: ModelCapability, req: RouteRequirements, chain: list[ModelCapability]
    ) -> tuple[ModelCapability, ...]:
        result: list[ModelCapability] = []
        for candidate in chain:
            if (
                candidate.model_id == primary.model_id
                or any(m.model_id == candidate.model_id for m in result)
                or not _equivalent(primary, candidate, tier)
                or _satisfies(candidate, req) is not None
                or not _within_budget(candidate, req)
            ):
                continue
            result.append(candidate)
            if len(result) == MAX_FALLBACKS:
                break
        return tuple(result)
