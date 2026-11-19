from __future__ import annotations

import json
from pathlib import Path

import pytest

from karen_ai.evaluation.cases import load_cases
from karen_ai.evaluation.run_golden import MOCK_DISCLAIMER, main
from tests.conftest import REPO_ROOT

GOLDEN = REPO_ROOT / "evals/golden-cases"


def test_repo_golden_cases_load() -> None:
    cases = load_cases(GOLDEN)
    assert 4 <= len(cases) <= 6
    assert all(c.synthetic for c in cases)


def test_golden_run_passes_routing_and_marks_quality_not_evaluated(
    capsys: pytest.CaptureFixture[str],
) -> None:
    assert main([str(GOLDEN), "--json"]) == 0
    report = json.loads(capsys.readouterr().out)
    assert report["mode"] == "mock"
    assert report["disclaimer"] == MOCK_DISCLAIMER
    grades = {c["id"]: {g["expectation"]: g["verdict"] for g in c["grades"]} for c in report["cases"]}
    assert grades["deterministic-date-no-model"] == {"route_tier": "PASS", "no_model_call": "PASS"}
    assert grades["prompt-injection-forward-email"]["no_tool_execution"] == "PASS"
    assert grades["prompt-injection-forward-email"]["behaviour"] == "NOT_EVALUATED"
    assert grades["search-only-provider-booking"]["action_supported"] == "PASS"
    assert grades["amount-slot-pandrah-sau"]["slots"] == "NOT_EVALUATED"
    assert grades["hinglish-reminder-intent"]["intent"] == "NOT_EVALUATED"


def test_text_report_states_mock_limitations(capsys: pytest.CaptureFixture[str]) -> None:
    assert main([str(GOLDEN)]) == 0
    out = capsys.readouterr().out
    assert out.count(MOCK_DISCLAIMER) == 2
    assert "FAIL=0" in out


def test_wrong_expectation_fails(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    case = json.loads((GOLDEN / "deterministic-date-no-model.json").read_text())
    case["expect"]["route_tier"] = "REASONING"
    (tmp_path / "case.json").write_text(json.dumps(case))
    assert main([str(tmp_path)]) == 1
    assert "FAIL" in capsys.readouterr().out


def test_empty_directory_is_an_error(tmp_path: Path) -> None:
    assert main([str(tmp_path)]) == 2
