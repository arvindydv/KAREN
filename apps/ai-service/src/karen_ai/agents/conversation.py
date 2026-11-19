"""Minimal conversation graph: ``classify -> respond``.

Deterministic questions (today's date) are answered without any model call (NO_MODEL route).
Everything else is classified on the ECONOMY tier and answered on the BALANCED tier. The graph
proposes nothing and executes nothing: side effects belong to the action plane.
"""

from __future__ import annotations

import datetime as dt
import re
from collections.abc import Callable
from typing import Any, Final, TypedDict

from langgraph.graph import END, START, StateGraph

from karen_ai.contracts import CONTRACT_VERSION, ChatMessage, CompletionRequest, RouteTier, TaskKind
from karen_ai.model_router.service import CompletionService
from karen_ai.prompts.catalog import CHAT_RESPONDER, INTENT_CLASSIFIER, INTENT_LABELS, PromptTemplate

IST: Final = dt.timezone(dt.timedelta(hours=5, minutes=30), name="IST")

_DATE_QUESTION: Final = re.compile(
    r"(?i)\b("
    r"what(?:'s| is) (?:the )?(?:date|day) today"
    r"|today'?s date"
    r"|aaj (?:kya|kaun si|konsi) (?:date|tareekh|tarikh)"
    r")\b"
)


class ConversationState(TypedDict, total=False):
    request_id: str
    user_ref: str
    user_message: str
    intent: str
    route_tiers: list[RouteTier]
    reply: str
    is_mock: bool


def is_deterministic_date_question(text: str) -> bool:
    return _DATE_QUESTION.search(text) is not None


def build_conversation_graph(
    service: CompletionService, *, clock: Callable[[], dt.datetime] | None = None
) -> Any:
    """Compile the graph with the completion service injected (no globals)."""
    now = clock or (lambda: dt.datetime.now(dt.UTC))

    def _request(
        state: ConversationState, suffix: str, task_kind: TaskKind, prompt: PromptTemplate
    ) -> CompletionRequest:
        return CompletionRequest(
            contract_version=CONTRACT_VERSION,
            request_id=f"{state['request_id']}:{suffix}",
            task_kind=task_kind,
            messages=[
                ChatMessage(role="system", content=prompt.system),
                ChatMessage(role="user", content=state["user_message"]),
            ],
            user_ref=state["user_ref"],
            prompt_version=prompt.version,
        )

    async def classify(state: ConversationState) -> ConversationState:
        if is_deterministic_date_question(state["user_message"]):
            response = await service.complete(_request(state, "classify", "DETERMINISTIC", INTENT_CLASSIFIER))
            return {"intent": "date_question", "route_tiers": [response.route_tier]}
        response = await service.complete(
            _request(state, "classify", "INTENT_CLASSIFICATION", INTENT_CLASSIFIER)
        )
        label = response.output_text.strip().lower()
        return {
            "intent": label if label in INTENT_LABELS else "unknown",
            "route_tiers": [response.route_tier],
            "is_mock": response.is_mock,
        }

    async def respond(state: ConversationState) -> ConversationState:
        tiers = list(state.get("route_tiers", []))
        if state.get("intent") == "date_question":
            today = now().astimezone(IST)
            return {"reply": f"Today is {today:%A, %d %B %Y} (IST).", "route_tiers": tiers}
        response = await service.complete(_request(state, "respond", "CHAT", CHAT_RESPONDER))
        return {
            "reply": response.output_text,
            "route_tiers": [*tiers, response.route_tier],
            "is_mock": response.is_mock,
        }

    graph = StateGraph(ConversationState)
    graph.add_node("classify", classify)
    graph.add_node("respond", respond)
    graph.add_edge(START, "classify")
    graph.add_edge("classify", "respond")
    graph.add_edge("respond", END)
    return graph.compile()
