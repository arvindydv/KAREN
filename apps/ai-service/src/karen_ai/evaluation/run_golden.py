"""Run golden cases against the MOCK gateway and print a report.

Usage: ``python -m karen_ai.evaluation.run_golden <cases-dir> [--json]``

Mock runs exercise the real router, policy and budget code paths. They say nothing about model
accuracy: output-quality expectations are reported as NOT_EVALUATED.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from collections import Counter
from dataclasses import asdict
from pathlib import Path
from typing import Any, Final

from karen_ai.api.app import build_completion_service
from karen_ai.contracts import CONTRACT_VERSION, CompletionRequest
from karen_ai.core.errors import KarenAIError
from karen_ai.core.settings import MOCK_REGISTRY_PATH, Settings
from karen_ai.evaluation.cases import CaseLoadError, GoldenCase, load_cases
from karen_ai.evaluation.graders import CaseRun, GradeResult, grade_case
from karen_ai.gateway.mock import MockGatewayClient
from karen_ai.observability.invocations import InMemoryInvocationSink

MOCK_DISCLAIMER: Final = (
    "MOCK GATEWAY RUN: these results validate routing, policy and tool-boundary wiring only. "
    "They say NOTHING about model accuracy, language quality or safety behaviour."
)


def _mock_settings() -> Settings:
    return Settings(
        _env_file=None,
        app_env="test",
        karen_ai_gateway_mode="mock",
        karen_model_registry_path=MOCK_REGISTRY_PATH,
    )


async def run_case(case: GoldenCase) -> tuple[GoldenCase, list[GradeResult]]:
    gateway = MockGatewayClient()
    service = build_completion_service(_mock_settings(), gateway=gateway, sink=InMemoryInvocationSink())
    payload: dict[str, Any] = {
        "contract_version": CONTRACT_VERSION,
        "request_id": f"eval-{case.id}"[:128],
        "task_kind": case.request.task_kind,
        "messages": [m.model_dump(exclude_none=True) for m in case.request.messages],
        "user_ref": "eval-harness-user",
        "prompt_version": "eval.v0",
    }
    # Optional keys are omitted (never null) when a case has no memory.
    if case.request.memory_status is not None:
        payload["memory_status"] = case.request.memory_status
    if case.request.memory_context is not None:
        payload["memory_context"] = [m.model_dump(exclude_none=True) for m in case.request.memory_context]
    request = CompletionRequest.model_validate(payload)
    try:
        response = await service.complete(request)
    except KarenAIError as exc:
        return case, [GradeResult("completion", "FAIL", f"{exc.code}: {exc.message}")]
    return case, await grade_case(
        case,
        CaseRun(
            response=response,
            gateway_calls=len(gateway.calls),
            is_mock=True,
            sent_messages=gateway.calls[0].messages if gateway.calls else (),
        ),
    )


async def run_all(cases: list[GoldenCase]) -> list[tuple[GoldenCase, list[GradeResult]]]:
    return [await run_case(case) for case in cases]


def render_text(results: list[tuple[GoldenCase, list[GradeResult]]]) -> str:
    lines = [MOCK_DISCLAIMER, ""]
    totals: Counter[str] = Counter()
    for case, grades in results:
        lines.append(f"{case.id}  [{case.language}]  {case.description}")
        for grade in grades:
            totals[grade.verdict] += 1
            lines.append(f"    {grade.verdict:<14} {grade.expectation}: {grade.detail}")
    lines += [
        "",
        f"cases={len(results)}  PASS={totals['PASS']}  FAIL={totals['FAIL']}  "
        f"NOT_EVALUATED={totals['NOT_EVALUATED']}",
        MOCK_DISCLAIMER,
    ]
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="run_golden", description=__doc__)
    parser.add_argument("cases_dir", type=Path)
    parser.add_argument("--json", action="store_true", help="emit a JSON report")
    args = parser.parse_args(argv)
    try:
        cases = load_cases(args.cases_dir)
    except (CaseLoadError, OSError) as exc:
        print(f"run_golden: {exc}", file=sys.stderr)
        return 2
    results = asyncio.run(run_all(cases))
    if args.json:
        report = {
            "mode": "mock",
            "disclaimer": MOCK_DISCLAIMER,
            "cases": [{"id": c.id, "grades": [asdict(g) for g in gs]} for c, gs in results],
        }
        print(json.dumps(report, indent=2))
    else:
        print(render_text(results))
    failed = any(g.verdict == "FAIL" for _, gs in results for g in gs)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
