from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import pytest
from pydantic import BaseModel

from karen_ai.tools.registry import (
    ToolExecutionForbiddenError,
    ToolInputError,
    ToolRegistrationError,
    ToolRegistry,
    ToolSpec,
)


class BookInput(BaseModel):
    offer_id: str
    max_amount_inr: int


class SearchInput(BaseModel):
    query: str


async def _search(args: BaseModel) -> Mapping[str, Any]:
    assert isinstance(args, SearchInput)
    return {"results": [], "query_len": len(args.query)}


async def _book(_: BaseModel) -> Mapping[str, Any]:  # pragma: no cover - must never be registered
    return {"booked": True}


BOOK = ToolSpec(name="book_hotel", input_schema=BookInput, risk_category="financial", side_effecting=True)
SEARCH = ToolSpec(
    name="search_hotels", input_schema=SearchInput, risk_category="read_only", side_effecting=False
)


def test_side_effecting_tool_without_backend_approval_is_refused() -> None:
    with pytest.raises(ToolRegistrationError, match="requires_backend_approval"):
        ToolRegistry().register(BOOK)


def test_side_effecting_tool_cannot_have_a_handler() -> None:
    spec = ToolSpec(**{**BOOK.__dict__, "requires_backend_approval": True})
    with pytest.raises(ToolRegistrationError, match="action plane"):
        ToolRegistry().register(spec, handler=_book)


async def test_side_effecting_tool_is_proposal_only() -> None:
    registry = ToolRegistry()
    registry.register(ToolSpec(**{**BOOK.__dict__, "requires_backend_approval": True}))
    proposal = registry.propose("book_hotel", {"offer_id": "off_1", "max_amount_inr": 1500})
    assert proposal.requires_backend_approval
    assert proposal.arguments == {"offer_id": "off_1", "max_amount_inr": 1500}
    with pytest.raises(ToolExecutionForbiddenError):
        await registry.execute_read_only("book_hotel", {"offer_id": "off_1", "max_amount_inr": 1500})


async def test_read_only_tool_executes_with_validated_input() -> None:
    registry = ToolRegistry()
    registry.register(SEARCH, handler=_search)
    assert await registry.execute_read_only("search_hotels", {"query": "Pune"}) == {
        "results": [],
        "query_len": 4,
    }
    with pytest.raises(ToolInputError):
        await registry.execute_read_only("search_hotels", {"query": 1, "extra": True})
    with pytest.raises(ToolInputError, match="unknown tool"):
        registry.propose("delete_everything", {})


def test_registration_rules() -> None:
    registry = ToolRegistry()
    with pytest.raises(ToolRegistrationError, match="needs a handler"):
        registry.register(SEARCH)
    registry.register(SEARCH, handler=_search)
    with pytest.raises(ToolRegistrationError, match="already registered"):
        registry.register(SEARCH, handler=_search)
    with pytest.raises(ToolRegistrationError, match="invalid tool name"):
        registry.register(
            ToolSpec(name="Bad Name", input_schema=SearchInput, risk_category="x_y", side_effecting=False)
        )
    assert registry.names == ("search_hotels",)
