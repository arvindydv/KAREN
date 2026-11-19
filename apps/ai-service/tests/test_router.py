from __future__ import annotations

from pathlib import Path

import pytest

from karen_ai.contracts import TASK_KINDS, RouteTier, TaskKind
from karen_ai.core.errors import KarenAIError
from karen_ai.model_router.registry import load_registry
from karen_ai.model_router.router import TASK_KIND_TIERS, ModelRouter, RouteRequirements
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
}


def test_every_task_kind_is_mapped() -> None:
    assert set(TASK_KIND_TIERS) == set(TASK_KINDS)


@pytest.mark.parametrize(("task_kind", "tier"), sorted(EXPECTED_TIERS.items()))
def test_task_kind_tier_selection(
    make_settings: SettingsFactory, task_kind: TaskKind, tier: RouteTier
) -> None:
    router = ModelRouter.from_settings(make_settings())
    assert router.select_tier(task_kind) == tier
    decision = router.route(tier, REQ)
    assert decision.tier == tier
    if tier == "NO_MODEL":
        assert decision.primary is None
    else:
        assert decision.primary is not None
        assert decision.primary.model_id == f"mock/{tier.lower()}"


def test_explicit_tier_overrides_task_kind(make_settings: SettingsFactory) -> None:
    router = ModelRouter.from_settings(make_settings())
    assert router.select_tier("CHAT", "REASONING") == "REASONING"


@pytest.mark.parametrize("tier", ["VISION", "EMBEDDING", "RERANKING", "AUDIO"])
def test_feature_tiers_disabled_by_default(make_settings: SettingsFactory, tier: RouteTier) -> None:
    router = ModelRouter.from_settings(make_settings())
    with pytest.raises(KarenAIError) as exc:
        router.route(tier, REQ)
    assert exc.value.code == "TIER_DISABLED"


def test_enabled_feature_tier_is_not_a_text_tier(make_settings: SettingsFactory) -> None:
    router = ModelRouter.from_settings(make_settings(karen_feature_vision_enabled=True))
    with pytest.raises(KarenAIError) as exc:
        router.route("VISION", REQ)
    assert exc.value.code == "CAPABILITY_UNAVAILABLE"


def test_stream_requires_streaming_capability(tmp_path: Path) -> None:
    registry = load_registry(
        write_registry(tmp_path / "r.json", changes={"mock/balanced": {"supports_streaming": False}})
    )
    router = ModelRouter(
        registry=registry,
        tier_models={"BALANCED": "mock/balanced"},
        enabled_tiers=frozenset({"NO_MODEL", "BALANCED"}),
    )
    router.route("BALANCED", REQ)
    with pytest.raises(KarenAIError) as exc:
        router.route("BALANCED", RouteRequirements(stream=True, input_tokens=10, max_output_tokens=10))
    assert exc.value.code == "CAPABILITY_UNAVAILABLE"


def test_context_window_is_enforced(make_settings: SettingsFactory) -> None:
    router = ModelRouter.from_settings(make_settings())
    with pytest.raises(KarenAIError, match="context window"):
        router.route("ECONOMY", RouteRequirements(stream=False, input_tokens=31_900, max_output_tokens=500))


def test_fallback_only_when_capabilities_are_equivalent(tmp_path: Path) -> None:
    # mock/reasoning offers everything mock/balanced does: eligible as BALANCED fallback.
    registry = load_registry(
        write_registry(tmp_path / "ok.json", changes={"mock/reasoning": {"tiers": ["REASONING", "BALANCED"]}})
    )
    router = ModelRouter(
        registry=registry,
        tier_models={"BALANCED": "mock/balanced"},
        enabled_tiers=frozenset({"BALANCED"}),
        balanced_fallback="mock/reasoning",
    )
    assert [m.model_id for m in router.route("BALANCED", REQ).fallbacks] == ["mock/reasoning"]

    # mock/economy lacks tool support (and the BALANCED tier): never a silent downgrade.
    router = ModelRouter(
        registry=registry,
        tier_models={"BALANCED": "mock/balanced"},
        enabled_tiers=frozenset({"BALANCED"}),
        balanced_fallback="mock/economy",
    )
    assert router.route("BALANCED", REQ).fallbacks == ()
