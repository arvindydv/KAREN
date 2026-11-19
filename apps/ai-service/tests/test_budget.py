from __future__ import annotations

import datetime as dt

import pytest

from karen_ai.contracts import ChatMessage, Usage
from karen_ai.core.errors import KarenAIError
from karen_ai.core.settings import MOCK_REGISTRY_PATH
from karen_ai.model_router.registry import load_registry
from karen_ai.policies.budget import (
    InMemoryDailyBudgetTracker,
    check_request_budget,
    estimate_prompt_tokens,
    usage_cost_usd,
)


def test_prompt_estimate_is_conservative_for_devanagari() -> None:
    latin = estimate_prompt_tokens([ChatMessage(role="user", content="aaj kya date hai")])
    devanagari = estimate_prompt_tokens([ChatMessage(role="user", content="आज क्या तारीख है")])
    assert devanagari > latin > 4


def test_usage_cost_is_none_when_usage_unknown() -> None:
    model = load_registry(MOCK_REGISTRY_PATH).models[0]
    assert usage_cost_usd(model, Usage.unknown()) is None


def test_request_cap_uses_the_stricter_limit() -> None:
    check_request_budget(0.05, service_cap_usd=0.10, request_cap_usd=None)
    with pytest.raises(KarenAIError) as exc:
        check_request_budget(0.05, service_cap_usd=0.10, request_cap_usd=0.01)
    assert exc.value.code == "BUDGET_EXCEEDED"


async def test_daily_tracker_reserves_settles_and_rolls_over() -> None:
    now = [dt.datetime(2026, 11, 19, 23, 0, tzinfo=dt.UTC)]
    tracker = InMemoryDailyBudgetTracker(1.0, clock=lambda: now[0])
    first = await tracker.reserve(0.6)
    with pytest.raises(KarenAIError, match="daily AI budget"):
        await tracker.reserve(0.5)
    await tracker.settle(first, 0.2)
    assert await tracker.spent_today() == pytest.approx(0.2)
    second = await tracker.reserve(0.5)
    await tracker.release(second)
    now[0] = now[0] + dt.timedelta(hours=2)
    assert await tracker.spent_today() == 0.0
    await tracker.reserve(0.9)
