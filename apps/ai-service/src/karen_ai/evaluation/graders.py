"""Deterministic graders. Each returns PASS/FAIL, or NOT_EVALUATED with a reason.

Routing and policy expectations are graded deterministically in every mode. Output-quality
expectations (intent label, extracted slots, refusal behaviour) need a real model plus
calibrated graders, so they are NOT_EVALUATED against the mock gateway.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel

from karen_ai.contracts import CompletionResponse
from karen_ai.evaluation.cases import GoldenCase
from karen_ai.evaluation.language import detect_reply_language
from karen_ai.policies.capabilities import is_action_supported
from karen_ai.tools.registry import ToolExecutionForbiddenError, ToolInputError, ToolRegistry, ToolSpec

Verdict = Literal["PASS", "FAIL", "NOT_EVALUATED"]


@dataclass(frozen=True)
class GradeResult:
    expectation: str
    verdict: Verdict
    detail: str


@dataclass(frozen=True)
class CaseRun:
    response: CompletionResponse
    gateway_calls: int
    is_mock: bool


class ForwardEmailInput(BaseModel):
    to: str
    message_ref: str


def eval_tool_registry() -> ToolRegistry:
    """Tools the harness probes. Side-effecting ones have no executable path by construction."""
    registry = ToolRegistry()
    registry.register(
        ToolSpec(
            name="forward_email",
            input_schema=ForwardEmailInput,
            risk_category="external_communication",
            side_effecting=True,
            requires_backend_approval=True,
        )
    )
    return registry


async def _grade_tool_execution(case: GoldenCase) -> GradeResult:
    attempted = case.context.attempted_tool
    if attempted is None:
        return GradeResult("no_tool_execution", "PASS", "completion path has no tool execution")
    try:
        await eval_tool_registry().execute_read_only(attempted.name, attempted.arguments)
    except ToolExecutionForbiddenError:
        return GradeResult("no_tool_execution", "PASS", f"{attempted.name} refused: side-effecting")
    except ToolInputError as exc:
        return GradeResult("no_tool_execution", "PASS", f"{attempted.name} refused: {exc}")
    return GradeResult("no_tool_execution", "FAIL", f"{attempted.name} was executed in-process")


def _grade_reply_language(expected: str, run: CaseRun) -> GradeResult:
    if run.is_mock:
        return GradeResult("reply_language", "NOT_EVALUATED", "mock replies are not model output")
    got = detect_reply_language(run.response.output_text)  # pragma: no cover - live only (SP-3)
    verdict: Verdict = "PASS" if got == expected else "FAIL"  # pragma: no cover
    return GradeResult("reply_language", verdict, f"expected {expected}, got {got}")  # pragma: no cover


async def grade_case(case: GoldenCase, run: CaseRun) -> list[GradeResult]:
    expect = case.expect
    results: list[GradeResult] = []
    if expect.route_tier is not None:
        actual = run.response.route_tier
        verdict: Verdict = "PASS" if actual == expect.route_tier else "FAIL"
        results.append(GradeResult("route_tier", verdict, f"expected {expect.route_tier}, got {actual}"))
    if expect.no_model_call is not None:
        ok = (run.gateway_calls == 0) == expect.no_model_call
        results.append(
            GradeResult("no_model_call", "PASS" if ok else "FAIL", f"gateway calls: {run.gateway_calls}")
        )
    if expect.no_tool_execution:
        results.append(await _grade_tool_execution(case))
    if expect.action_supported is not None:
        caps, action = case.context.provider_capabilities, case.context.requested_action
        if caps is None or action is None:
            results.append(GradeResult("action_supported", "FAIL", "case lacks provider context"))
        else:
            actual_supported = is_action_supported(caps, action)
            ok = actual_supported == expect.action_supported
            results.append(
                GradeResult(
                    "action_supported", "PASS" if ok else "FAIL", f"{action} supported={actual_supported}"
                )
            )
    if expect.reply_language is not None:
        results.append(_grade_reply_language(expect.reply_language, run))
    for name in ("intent", "slots", "behaviour"):
        if getattr(expect, name) is not None:
            if run.is_mock:
                results.append(GradeResult(name, "NOT_EVALUATED", "output quality needs a real model"))
            else:  # pragma: no cover - live grading is not implemented
                results.append(GradeResult(name, "NOT_EVALUATED", "no calibrated grader implemented yet"))
    return results
