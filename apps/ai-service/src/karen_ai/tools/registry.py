"""Typed tool registry with a hard read-only/side-effect split (architecture §0, §10).

- Read-only tools may register an in-process handler and be executed here.
- Side-effecting tools must declare ``requires_backend_approval=True`` and can never carry a
  handler: the registry only validates their input and returns a ``ToolProposal`` for the
  action plane, which re-validates, obtains approval and executes.
"""

from __future__ import annotations

import re
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from typing import Any, Final

from pydantic import BaseModel, ConfigDict, ValidationError

_TOOL_NAME: Final = re.compile(r"^[a-z][a-z0-9_]{2,63}$")
_RISK_CATEGORY: Final = re.compile(r"^[a-z][a-z0-9_]{2,63}$")

ReadOnlyHandler = Callable[[BaseModel], Awaitable[Mapping[str, Any]]]


class ToolRegistrationError(ValueError):
    pass


class ToolExecutionForbiddenError(PermissionError):
    pass


class ToolInputError(ValueError):
    pass


@dataclass(frozen=True)
class ToolSpec:
    name: str
    input_schema: type[BaseModel]
    risk_category: str
    side_effecting: bool
    requires_backend_approval: bool = False
    description: str = ""


class ToolProposal(BaseModel):
    """What the agent hands to the action plane. Not an authorisation."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    tool_name: str
    arguments: dict[str, Any]
    risk_category: str
    requires_backend_approval: bool


class ToolRegistry:
    def __init__(self) -> None:
        self._specs: dict[str, ToolSpec] = {}
        self._handlers: dict[str, ReadOnlyHandler] = {}

    def register(self, spec: ToolSpec, handler: ReadOnlyHandler | None = None) -> None:
        if _TOOL_NAME.fullmatch(spec.name) is None:
            raise ToolRegistrationError(f"invalid tool name {spec.name!r}")
        if _RISK_CATEGORY.fullmatch(spec.risk_category) is None:
            raise ToolRegistrationError(f"invalid risk category {spec.risk_category!r}")
        if spec.name in self._specs:
            raise ToolRegistrationError(f"tool {spec.name!r} already registered")
        if spec.side_effecting and not spec.requires_backend_approval:
            raise ToolRegistrationError(
                f"side-effecting tool {spec.name!r} must set requires_backend_approval=True"
            )
        if spec.side_effecting and handler is not None:
            raise ToolRegistrationError(
                f"side-effecting tool {spec.name!r} cannot have an in-process handler; "
                "the action plane executes it"
            )
        if not spec.side_effecting and handler is None:
            raise ToolRegistrationError(f"read-only tool {spec.name!r} needs a handler")
        self._specs[spec.name] = spec
        if handler is not None:
            self._handlers[spec.name] = handler

    def get(self, name: str) -> ToolSpec | None:
        return self._specs.get(name)

    @property
    def names(self) -> tuple[str, ...]:
        return tuple(sorted(self._specs))

    def _validated(self, name: str, arguments: Mapping[str, Any]) -> tuple[ToolSpec, BaseModel]:
        spec = self._specs.get(name)
        if spec is None:
            raise ToolInputError(f"unknown tool {name!r}")
        try:
            return spec, spec.input_schema.model_validate(dict(arguments))
        except ValidationError as exc:
            raise ToolInputError(f"invalid arguments for tool {name!r}") from exc

    def propose(self, name: str, arguments: Mapping[str, Any]) -> ToolProposal:
        spec, parsed = self._validated(name, arguments)
        return ToolProposal(
            tool_name=spec.name,
            arguments=parsed.model_dump(mode="json"),
            risk_category=spec.risk_category,
            requires_backend_approval=spec.requires_backend_approval,
        )

    async def execute_read_only(self, name: str, arguments: Mapping[str, Any]) -> Mapping[str, Any]:
        spec, parsed = self._validated(name, arguments)
        if spec.side_effecting:
            raise ToolExecutionForbiddenError(
                f"tool {name!r} is side-effecting; submit a ToolProposal to the action plane"
            )
        return await self._handlers[name](parsed)
