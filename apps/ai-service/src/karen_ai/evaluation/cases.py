"""Golden case schema and loader (JSON or YAML files in ``evals/golden-cases``)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from karen_ai.contracts import ChatMessage, MemoryContextItem, MemoryWireStatus, RouteTier, TaskKind
from karen_ai.policies.capabilities import ProviderAction


class _Closed(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class CaseRequest(_Closed):
    task_kind: TaskKind
    messages: list[ChatMessage] = Field(min_length=1)
    # Phase 03 (contract v5): memory sent as DATA with the request.
    memory_status: MemoryWireStatus | None = None
    memory_context: list[MemoryContextItem] | None = None


class AttemptedTool(_Closed):
    name: str
    arguments: dict[str, Any]


class CaseContext(_Closed):
    provider_capabilities: list[str] | None = None
    requested_action: ProviderAction | None = None
    attempted_tool: AttemptedTool | None = None


class Expectations(_Closed):
    # Deterministic (routing/policy level): graded in every mode.
    route_tier: RouteTier | None = None
    no_model_call: bool | None = None
    no_tool_execution: bool | None = None
    action_supported: bool | None = None
    # Output quality: requires a real model; NOT EVALUATED against the mock gateway.
    intent: str | None = None
    slots: dict[str, Any] | None = None
    behaviour: str | None = None
    # Phase 02: language/script of the reply (graded by karen_ai.evaluation.language when live).
    reply_language: Literal["en", "hi", "hi-Latn"] | None = None
    # Phase 03 (arch §9.3, §13.5): every memory reaches the model only as one JSON-quoted line inside
    # the single delimited DATA block of the system prompt — never as a message or free text.
    memory_contained: bool | None = None


class GoldenCase(_Closed):
    id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{2,80}$")
    description: str
    language: Literal["en", "hi", "hi-Latn", "mixed"]
    tags: list[str] = []
    synthetic: bool
    request: CaseRequest
    context: CaseContext = CaseContext()
    expect: Expectations


class CaseLoadError(ValueError):
    pass


def _read(path: Path) -> Any:
    text = path.read_text(encoding="utf-8")
    return json.loads(text) if path.suffix == ".json" else yaml.safe_load(text)


def load_cases(directory: Path) -> list[GoldenCase]:
    files = sorted(p for p in directory.iterdir() if p.suffix in {".json", ".yaml", ".yml"})
    if not files:
        raise CaseLoadError(f"no golden cases (*.json, *.yaml) found in {directory}")
    cases: list[GoldenCase] = []
    for path in files:
        try:
            cases.append(GoldenCase.model_validate(_read(path)))
        except (ValidationError, ValueError, yaml.YAMLError) as exc:
            raise CaseLoadError(f"{path.name}: {exc}") from exc
    ids = [c.id for c in cases]
    if len(ids) != len(set(ids)):
        raise CaseLoadError("duplicate golden case ids")
    return cases
