"""Task profiles: what each ``task_kind`` needs from a model (ADR-0026).

A profile states the tier (budget class and reporting), hard requirements (capabilities), a
quality floor and a latency ceiling. The router then picks the *least expensive* registry model
that satisfies the profile and fits the request's budget.

Quality floors use the registry's ``quality_index`` (the catalog's Artificial Analysis
intelligence index, 0-100). A model without a ``quality_index`` never satisfies a floor (unknown
quality is not assumed good); an operator can still pin it with ``KAREN_MODEL_*``.
Latency ceilings use ``latency_p50_ms`` (time to first token); unknown latency is allowed.

The numbers are engineering defaults, not measured product requirements: calibrate them with
golden evals in live mode (docs/gateway/openrouter.md) before relying on them.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Final

from karen_ai.contracts import TASK_KINDS, RouteTier, TaskKind
from karen_ai.core.settings import TaskRoute


@dataclass(frozen=True)
class TaskProfile:
    tier: RouteTier
    min_quality_index: float | None = None
    max_latency_p50_ms: float | None = None
    needs_json_schema: bool = False
    needs_vision: bool = False
    # Pin slot for a dedicated model on this tier (KAREN_MODEL_CODING / _DOCUMENT_ANALYSIS).
    task_route: TaskRoute | None = None


# Conversational turns should start speaking quickly (voice uses the same profiles).
_CONVERSATIONAL_TTFT_MS: Final = 4000.0
_INTERACTIVE_TTFT_MS: Final = 3000.0

TASK_PROFILES: Final[Mapping[TaskKind, TaskProfile]] = {
    "DETERMINISTIC": TaskProfile(tier="NO_MODEL"),
    # Extraction family: structured, short, cheap.
    "INTENT_CLASSIFICATION": TaskProfile(
        tier="ECONOMY", needs_json_schema=True, max_latency_p50_ms=_INTERACTIVE_TTFT_MS
    ),
    "EXTRACTION": TaskProfile(tier="ECONOMY", needs_json_schema=True),
    "SHORT_REWRITE": TaskProfile(tier="ECONOMY", max_latency_p50_ms=_INTERACTIVE_TTFT_MS),
    # General chat and light planning.
    "CHAT": TaskProfile(tier="BALANCED", min_quality_index=25, max_latency_p50_ms=_CONVERSATIONAL_TTFT_MS),
    "BASIC_PLANNING": TaskProfile(tier="BALANCED", min_quality_index=25),
    # Document analysis: long context matters more than latency.
    "SUMMARY": TaskProfile(tier="BALANCED", min_quality_index=25, task_route="DOCUMENT_ANALYSIS"),
    "DOCUMENT_ANALYSIS": TaskProfile(tier="BALANCED", min_quality_index=25, task_route="DOCUMENT_ANALYSIS"),
    # Deep reasoning, decisions, research, coding.
    "COMPLEX_PLANNING": TaskProfile(tier="REASONING", min_quality_index=40),
    "COMPARISON": TaskProfile(tier="REASONING", min_quality_index=40),
    "DECISION_SUPPORT": TaskProfile(tier="REASONING", min_quality_index=40),
    "RESEARCH": TaskProfile(tier="REASONING", min_quality_index=45),
    "CODING": TaskProfile(tier="REASONING", min_quality_index=40, task_route="CODING"),
    # Image understanding: any vision-capable model on the (feature-flagged) VISION tier.
    "IMAGE_UNDERSTANDING": TaskProfile(tier="VISION", needs_vision=True),
}

if set(TASK_PROFILES) != set(TASK_KINDS):  # pragma: no cover - import-time guard
    raise RuntimeError("every task kind needs a task profile")


def profile_for(task_kind: TaskKind | None, tier: RouteTier) -> TaskProfile:
    """The task's profile, or a neutral profile when the caller forced a different tier."""
    profile = TASK_PROFILES[task_kind] if task_kind is not None else None
    if profile is not None and profile.tier == tier:
        return profile
    return TaskProfile(tier=tier, needs_vision=tier == "VISION")
