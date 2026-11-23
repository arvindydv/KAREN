"""Task profiles, least-cost qualified selection, pins, fallbacks and budget-aware routing.

Registries here are mock copies with test-only prices/metadata; no real model IDs.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from karen_ai.contracts import TASK_KINDS, RouteTier, TaskKind
from karen_ai.core.errors import KarenAIError
from karen_ai.model_router.profiles import TASK_PROFILES, profile_for
from karen_ai.model_router.registry import ModelRegistry, load_registry
from karen_ai.model_router.router import (
    TASK_KIND_ROUTES,
    TASK_KIND_TIERS,
    ModelRouter,
    RouteRequirements,
)
from tests.conftest import SettingsFactory, write_registry

REQ = RouteRequirements(stream=False, input_tokens=100, max_output_tokens=500)

EXPECTED_TIERS: dict[TaskKind, RouteTier] = {
    "DETERMINISTIC": "NO_MODEL",
    "INTENT_CLASSIFICATION": "ECONOMY",
    "EXTRACTION": "ECONOMY",
    "SHORT_REWRITE": "ECONOMY",
    "CHAT": "BALANCED",
    "SUMMARY": "BALANCED",
    "BASIC_PLANNING": "BALANCED",
    "COMPLEX_PLANNING": "REASONING",
    "COMPARISON": "REASONING",
    "CODING": "REASONING",
    "DOCUMENT_ANALYSIS": "BALANCED",
    "RESEARCH": "REASONING",
    "DECISION_SUPPORT": "REASONING",
    "IMAGE_UNDERSTANDING": "VISION",
}

ALL_TIERS: frozenset[RouteTier] = frozenset({"NO_MODEL", "ECONOMY", "BALANCED", "REASONING", "VISION"})


def model(model_id: str, tiers: list[str], **overrides: Any) -> dict[str, Any]:
    """A test-only registry entry (fake slug, made-up price/metadata)."""
    entry: dict[str, Any] = {
        "model_id": model_id,
        "tiers": tiers,
        "supports_streaming": True,
        "supports_tools": True,
        "supports_json_schema": True,
        "supports_vision": False,
        "max_context_tokens": 100_000,
        "max_output_tokens": 8_000,
        "input_usd_per_million_tokens": 1.0,
        "output_usd_per_million_tokens": 1.0,
        "verified_at": "2026-11-01",
        "quality_index": 50,
        "latency_p50_ms": 1000,
    }
    entry.update(overrides)
    # Optional metadata is omitted (never null) when unknown, as the contract requires.
    optional = ("quality_index", "latency_p50_ms")
    return {k: v for k, v in entry.items() if not (k in optional and v is None)}


def registry_of(tmp_path: Path, *entries: dict[str, Any]) -> ModelRegistry:
    path = tmp_path / "registry.json"
    path.write_text(json.dumps({"registry_version": "test", "models": list(entries)}))
    return load_registry(path)


def router_of(registry: ModelRegistry, **kwargs: Any) -> ModelRouter:
    defaults: dict[str, Any] = {"registry": registry, "tier_models": {}, "enabled_tiers": ALL_TIERS}
    defaults.update(kwargs)
    return ModelRouter(**defaults)


# ---------------------------------------------------------------------------------- profiles


def test_every_task_kind_has_a_profile_and_tier() -> None:
    assert set(TASK_PROFILES) == set(TASK_KINDS)
    assert dict(TASK_KIND_TIERS) == EXPECTED_TIERS


def test_task_routes_are_pin_slots_for_coding_and_documents() -> None:
    assert TASK_KIND_ROUTES == {
        "CODING": "CODING",
        "DOCUMENT_ANALYSIS": "DOCUMENT_ANALYSIS",
        "SUMMARY": "DOCUMENT_ANALYSIS",
    }


def test_profiles_raise_the_quality_bar_for_reasoning_work() -> None:
    chat, research = TASK_PROFILES["CHAT"], TASK_PROFILES["RESEARCH"]
    assert chat.min_quality_index is not None
    assert research.min_quality_index is not None
    assert research.min_quality_index > chat.min_quality_index
    assert TASK_PROFILES["EXTRACTION"].needs_json_schema
    assert TASK_PROFILES["IMAGE_UNDERSTANDING"].needs_vision


def test_explicit_tier_override_uses_a_neutral_profile() -> None:
    neutral = profile_for("CHAT", "REASONING")
    assert neutral.tier == "REASONING"
    assert neutral.min_quality_index is None
    assert profile_for("CHAT", "BALANCED") is TASK_PROFILES["CHAT"]


@pytest.mark.parametrize(("task_kind", "tier"), sorted(EXPECTED_TIERS.items()))
def test_mock_settings_route_every_task_kind(
    make_settings: SettingsFactory, task_kind: TaskKind, tier: RouteTier
) -> None:
    router = ModelRouter.from_settings(make_settings(karen_feature_vision_enabled=True))
    assert router.select_tier(task_kind) == tier
    decision = router.route(tier, REQ, task_kind=task_kind)
    assert decision.tier == tier
    if tier == "NO_MODEL":
        assert decision.primary is None
    else:
        assert decision.primary is not None
        assert decision.primary.model_id == f"mock/{tier.lower()}"
        assert decision.selection == "auto"


def test_explicit_tier_overrides_task_kind(make_settings: SettingsFactory) -> None:
    router = ModelRouter.from_settings(make_settings())
    assert router.select_tier("CHAT", "REASONING") == "REASONING"


# ------------------------------------------------------------------------- least-cost selection


def test_cheapest_qualified_model_wins_and_next_become_fallbacks(tmp_path: Path) -> None:
    registry = registry_of(
        tmp_path,
        model("test-creator/pricey", ["BALANCED"], output_usd_per_million_tokens=10.0),
        model("test-creator/cheap", ["BALANCED"], output_usd_per_million_tokens=0.5),
        model("test-creator/mid", ["BALANCED"], output_usd_per_million_tokens=2.0),
    )
    decision = router_of(registry).route("BALANCED", REQ, task_kind="CHAT")
    assert [m.model_id for m in decision.candidates] == [
        "test-creator/cheap",
        "test-creator/mid",
        "test-creator/pricey",
    ]
    assert decision.selection == "auto"


def test_quality_floor_excludes_cheaper_but_weaker_models(tmp_path: Path) -> None:
    registry = registry_of(
        tmp_path,
        model("test-creator/weak", ["REASONING"], output_usd_per_million_tokens=0.1, quality_index=20),
        model("test-creator/unknown", ["REASONING"], output_usd_per_million_tokens=0.2, quality_index=None),
        model("test-creator/strong", ["REASONING"], output_usd_per_million_tokens=5.0, quality_index=60),
    )
    router = router_of(registry)
    decision = router.route("REASONING", REQ, task_kind="RESEARCH")
    assert decision.primary is not None
    assert decision.primary.model_id == "test-creator/strong"
    # Without a task profile (explicit tier) there is no floor: the cheapest wins.
    neutral = router.route("REASONING", REQ)
    assert neutral.primary is not None
    assert neutral.primary.model_id == "test-creator/weak"


def test_latency_ceiling_excludes_slow_models_but_allows_unknown(tmp_path: Path) -> None:
    registry = registry_of(
        tmp_path,
        model("test-creator/slow", ["BALANCED"], output_usd_per_million_tokens=0.1, latency_p50_ms=9000),
        model(
            "test-creator/unmeasured", ["BALANCED"], output_usd_per_million_tokens=0.2, latency_p50_ms=None
        ),
    )
    decision = router_of(registry).route("BALANCED", REQ, task_kind="CHAT")
    assert decision.primary is not None
    assert decision.primary.model_id == "test-creator/unmeasured"


def test_equal_cost_prefers_lower_latency_then_quality(tmp_path: Path) -> None:
    registry = registry_of(
        tmp_path,
        model("test-creator/a", ["BALANCED"], latency_p50_ms=1500, quality_index=60),
        model("test-creator/b", ["BALANCED"], latency_p50_ms=900, quality_index=40),
        model("test-creator/c", ["BALANCED"], latency_p50_ms=900, quality_index=55),
    )
    decision = router_of(registry).route("BALANCED", REQ, task_kind="CHAT")
    assert [m.model_id for m in decision.candidates] == ["test-creator/c", "test-creator/b", "test-creator/a"]


def test_json_schema_requirement_for_extraction(tmp_path: Path) -> None:
    registry = registry_of(
        tmp_path,
        model(
            "test-creator/no-json", ["ECONOMY"], output_usd_per_million_tokens=0.1, supports_json_schema=False
        ),
        model("test-creator/json", ["ECONOMY"], output_usd_per_million_tokens=0.3),
    )
    decision = router_of(registry).route("ECONOMY", REQ, task_kind="EXTRACTION")
    assert decision.primary is not None
    assert decision.primary.model_id == "test-creator/json"


def test_unverified_models_are_skipped_in_live_mode(tmp_path: Path) -> None:
    registry = registry_of(
        tmp_path,
        model("test-creator/unverified", ["BALANCED"], output_usd_per_million_tokens=0.1, verified_at=None),
        model("test-creator/verified", ["BALANCED"], output_usd_per_million_tokens=1.0),
    )
    decision = router_of(registry, require_verified=True).route("BALANCED", REQ, task_kind="CHAT")
    assert [m.model_id for m in decision.candidates] == ["test-creator/verified"]


def test_context_window_filters_candidates(tmp_path: Path) -> None:
    registry = registry_of(
        tmp_path,
        model(
            "test-creator/small", ["BALANCED"], output_usd_per_million_tokens=0.1, max_context_tokens=4_000
        ),
        model(
            "test-creator/large", ["BALANCED"], output_usd_per_million_tokens=1.0, max_context_tokens=500_000
        ),
    )
    big = RouteRequirements(stream=False, input_tokens=50_000, max_output_tokens=500)
    decision = router_of(registry).route("BALANCED", big, task_kind="DOCUMENT_ANALYSIS")
    assert [m.model_id for m in decision.candidates] == ["test-creator/large"]


def test_nothing_fits_the_context_is_capability_unavailable(make_settings: SettingsFactory) -> None:
    router = ModelRouter.from_settings(make_settings())
    with pytest.raises(KarenAIError) as exc:
        router.route("ECONOMY", RouteRequirements(stream=False, input_tokens=31_900, max_output_tokens=500))
    assert exc.value.code == "CAPABILITY_UNAVAILABLE"


def test_max_output_is_clipped_to_the_chosen_model(tmp_path: Path) -> None:
    registry = registry_of(tmp_path, model("test-creator/short", ["BALANCED"], max_output_tokens=300))
    decision = router_of(registry).route("BALANCED", REQ, task_kind="CHAT")
    assert decision.max_output_tokens == 300


# ---------------------------------------------------------------------------- budget-aware


def test_budget_cap_skips_models_whose_worst_case_is_too_expensive(tmp_path: Path) -> None:
    registry = registry_of(
        tmp_path,
        model("test-creator/cheap-weak", ["REASONING"], output_usd_per_million_tokens=0.5, quality_index=30),
        model("test-creator/ok", ["REASONING"], output_usd_per_million_tokens=10.0, quality_index=50),
        model("test-creator/premium", ["REASONING"], output_usd_per_million_tokens=100.0, quality_index=70),
    )
    req = RouteRequirements(stream=False, input_tokens=100, max_output_tokens=1000, max_cost_usd=0.02)
    decision = router_of(registry).route("REASONING", req, task_kind="COMPLEX_PLANNING")
    # Floor 40 drops cheap-weak; premium's worst case (0.1 USD) exceeds the 0.02 cap.
    assert [m.model_id for m in decision.candidates] == ["test-creator/ok"]


def test_no_qualified_model_within_budget_is_budget_exceeded_before_any_call(tmp_path: Path) -> None:
    registry = registry_of(
        tmp_path, model("test-creator/premium", ["REASONING"], output_usd_per_million_tokens=100.0)
    )
    req = RouteRequirements(stream=False, input_tokens=100, max_output_tokens=1000, max_cost_usd=0.001)
    with pytest.raises(KarenAIError) as exc:
        router_of(registry).route("REASONING", req, task_kind="RESEARCH")
    assert exc.value.code == "BUDGET_EXCEEDED"


# ---------------------------------------------------------------------------------- vision


def test_image_input_requires_a_vision_model(tmp_path: Path) -> None:
    registry = registry_of(
        tmp_path,
        model("test-creator/text-only", ["BALANCED"], output_usd_per_million_tokens=0.1),
        model(
            "test-creator/sees",
            ["BALANCED", "VISION"],
            output_usd_per_million_tokens=1.0,
            supports_vision=True,
        ),
    )
    router = router_of(registry)
    with_image = RouteRequirements(stream=False, input_tokens=2_100, max_output_tokens=500, needs_vision=True)
    decision = router.route("BALANCED", with_image, task_kind="CHAT")
    assert [m.model_id for m in decision.candidates] == ["test-creator/sees"]
    vision = router.route("VISION", REQ, task_kind="IMAGE_UNDERSTANDING")
    assert vision.primary is not None
    assert vision.primary.model_id == "test-creator/sees"


@pytest.mark.parametrize("tier", ["VISION", "EMBEDDING", "RERANKING", "AUDIO"])
def test_feature_tiers_disabled_by_default(make_settings: SettingsFactory, tier: RouteTier) -> None:
    router = ModelRouter.from_settings(make_settings())
    with pytest.raises(KarenAIError) as exc:
        router.route(tier, REQ)
    assert exc.value.code == "TIER_DISABLED"


def test_enabled_non_text_feature_tier_is_not_served(make_settings: SettingsFactory) -> None:
    router = ModelRouter.from_settings(make_settings(karen_feature_embedding_enabled=True))
    with pytest.raises(KarenAIError) as exc:
        router.route("EMBEDDING", REQ)
    assert exc.value.code == "CAPABILITY_UNAVAILABLE"


def test_stream_requires_streaming_capability(tmp_path: Path) -> None:
    registry = load_registry(
        write_registry(tmp_path / "r.json", changes={"mock/balanced": {"supports_streaming": False}})
    )
    router = router_of(registry, enabled_tiers=frozenset({"NO_MODEL", "BALANCED"}))
    router.route("BALANCED", REQ)
    with pytest.raises(KarenAIError) as exc:
        router.route("BALANCED", RouteRequirements(stream=True, input_tokens=10, max_output_tokens=10))
    assert exc.value.code == "CAPABILITY_UNAVAILABLE"


# ------------------------------------------------------------------------- pins + fallbacks


def test_pin_overrides_auto_selection_and_skips_quality_floor(tmp_path: Path) -> None:
    registry = registry_of(
        tmp_path,
        model("test-creator/cheap", ["REASONING"], output_usd_per_million_tokens=0.1),
        model("test-creator/pinned", ["REASONING"], output_usd_per_million_tokens=9.0, quality_index=None),
    )
    decision = router_of(registry, tier_models={"REASONING": "test-creator/pinned"}).route(
        "REASONING", REQ, task_kind="RESEARCH"
    )
    assert decision.selection == "pinned"
    assert decision.primary is not None
    assert decision.primary.model_id == "test-creator/pinned"
    # No operator fallback configured: the cheapest qualified alternative backs it up.
    assert [m.model_id for m in decision.fallbacks] == ["test-creator/cheap"]


def test_pinned_model_missing_or_unverified_is_refused(tmp_path: Path) -> None:
    registry = registry_of(tmp_path, model("test-creator/unverified", ["BALANCED"], verified_at=None))
    for pin in ("test-creator/not-registered", "test-creator/unverified"):
        router = router_of(registry, tier_models={"BALANCED": pin}, require_verified=True)
        with pytest.raises(KarenAIError) as exc:
            router.route("BALANCED", REQ, task_kind="CHAT")
        assert exc.value.code == "CAPABILITY_UNAVAILABLE"


def test_operator_fallback_only_when_capabilities_are_equivalent(tmp_path: Path) -> None:
    registry = load_registry(
        write_registry(tmp_path / "ok.json", changes={"mock/reasoning": {"tiers": ["REASONING", "BALANCED"]}})
    )
    pinned = {"BALANCED": "mock/balanced"}
    router = router_of(registry, tier_models=pinned, tier_fallbacks={"BALANCED": "mock/reasoning"})
    assert [m.model_id for m in router.route("BALANCED", REQ).fallbacks] == ["mock/reasoning"]
    # mock/economy lacks tool support (and the BALANCED tier): never a silent downgrade.
    router = router_of(registry, tier_models=pinned, tier_fallbacks={"BALANCED": "mock/economy"})
    assert router.route("BALANCED", REQ).fallbacks == ()


def test_auto_fallbacks_never_drop_a_primary_capability(tmp_path: Path) -> None:
    registry = registry_of(
        tmp_path,
        model("test-creator/primary", ["BALANCED"], output_usd_per_million_tokens=0.1),
        model("test-creator/no-tools", ["BALANCED"], output_usd_per_million_tokens=0.2, supports_tools=False),
        model("test-creator/ok-1", ["BALANCED"], output_usd_per_million_tokens=0.3),
        model("test-creator/ok-2", ["BALANCED"], output_usd_per_million_tokens=0.4),
        model("test-creator/ok-3", ["BALANCED"], output_usd_per_million_tokens=0.5),
    )
    decision = router_of(registry).route("BALANCED", REQ, task_kind="CHAT")
    assert [m.model_id for m in decision.fallbacks] == ["test-creator/ok-1", "test-creator/ok-2"]


def _specialist_router(tmp_path: Path, **kwargs: object) -> ModelRouter:
    registry = load_registry(
        write_registry(
            tmp_path / "r.json",
            changes={
                "mock/balanced": {"tiers": ["BALANCED", "REASONING"]},
                "mock/economy": {"tiers": ["ECONOMY", "REASONING"], "supports_tools": True},
            },
        )
    )
    defaults: dict[str, object] = {
        "tier_models": {"REASONING": "mock/reasoning"},
        "task_route_models": {"CODING": "mock/balanced"},
    }
    defaults.update(kwargs)
    return router_of(registry, **defaults)


def test_task_route_pin_selects_the_specialist_and_falls_back_to_the_tier(tmp_path: Path) -> None:
    router = _specialist_router(tmp_path, tier_fallbacks={"REASONING": "mock/economy"})
    assert router.task_route_for("CODING", "REASONING") == "CODING"
    decision = router.route("REASONING", REQ, task_kind="CODING")
    assert decision.task_route == "CODING"
    assert decision.selection == "pinned"
    assert [m.model_id for m in decision.candidates] == ["mock/balanced", "mock/reasoning", "mock/economy"]


def test_explicit_tier_that_differs_from_the_route_tier_ignores_the_specialist(tmp_path: Path) -> None:
    router = _specialist_router(tmp_path)
    assert router.task_route_for("CODING", "BALANCED") is None
    assert router.task_route_for("CHAT", "BALANCED") is None


def test_unpinned_task_route_falls_back_to_auto_selection(make_settings: SettingsFactory) -> None:
    router = ModelRouter.from_settings(make_settings())
    assert router.task_route_for("CODING", "REASONING") is None
    decision = router.route("REASONING", REQ, task_kind="CODING")
    assert decision.selection == "auto"
    assert decision.task_route is None


def test_task_route_specialist_missing_from_registry_is_refused(tmp_path: Path) -> None:
    router = _specialist_router(tmp_path, task_route_models={"CODING": "test-creator/not-registered"})
    with pytest.raises(KarenAIError) as exc:
        router.route("REASONING", REQ, task_kind="CODING")
    assert exc.value.code == "CAPABILITY_UNAVAILABLE"
