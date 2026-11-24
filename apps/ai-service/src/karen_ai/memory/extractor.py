"""Memory candidate extraction (Phase 03 M5a; ADR-0036 §7.2).

The extractor only PROPOSES candidates from ONE user message. It never decides what is stored:
the API re-validates every candidate deterministically (V1-V12) — verbatim substrings, character
policy, SECRET / minors / SENSITIVE rules, the tier-1 clause rule. Model output is untrusted.

Phase 03 ships ONLY the deterministic mock extractor (D1). Live (paid) extraction needs owner
approval APP-1 plus gateway JSON-schema support (Q1, M-13); until then
``KAREN_FEATURE_MEMORY_EXTRACTION_LIVE=true`` refuses startup (settings, tested).
The ``MemoryExtractor`` protocol is the extension point.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Final, Protocol

from karen_ai.contracts import MemoryCandidate, MemoryKind, MemorySubject

EXTRACT_PROMPT_VERSION: Final = "memory_extract.v1"


@dataclass(frozen=True)
class ExtractionResult:
    candidates: tuple[MemoryCandidate, ...]
    is_mock: bool
    requested_model: str | None
    served_model: str | None
    estimated_cost_usd: float


class MemoryExtractor(Protocol):
    async def extract(self, message_text: str, *, max_candidates: int) -> ExtractionResult: ...


# ── deterministic mock ──────────────────────────────────────────────────────────────────────

# Clause boundaries: sentence ends (incl. Devanagari danda), newlines, ';' and connectors.
_CLAUSE_SPLIT: Final = re.compile(
    r"[.!?।॥;\n]+|\s+(?:and also|also|but|aur|lekin|par|और|लेकिन|पर)\s+", re.IGNORECASE
)
# Explicit remember-requests (EN / Hinglish / Hindi). "remind me" is deliberately NOT a trigger.
_TRIGGER: Final = re.compile(
    r"(don'?t forget( that)?|please remember( that)?|remember( that)?|note that|keep in mind( that)?"
    r"|yaad rakh(?:na|o|iye|ega)?|dhyan rakh(?:na|o)?|याद रख(?:ना|ो|िए|ें)?|ध्यान रख(?:ना|ो)?)",
    re.IGNORECASE,
)
_NOT_A_STATEMENT: Final = re.compile(r"\?\s*$|^\s*(do you|kya|क्या|remind me|yaad dila|याद दिला)", re.I)
_SELF_MARKER: Final = re.compile(
    r"\b(i|i'm|im|i am|my|mine|main|mai|mera|meri|mere|mujhe)\b|मैं|मेरा|मेरी|मेरे|मुझे", re.IGNORECASE
)
_RELATION: Final = re.compile(
    r"\bmy (mother|mom|father|dad|sister|brother|wife|husband|friend|boss|colleague"
    r"|grandmother|grandfather)\b"
    r"|\bmeri (maa|mummy|behen|didi|biwi|dost)\b|\bmere (papa|bhai|pati|dost)\b",
    re.IGNORECASE,
)

_SLOT_RULES: Final[tuple[tuple[re.Pattern[str], MemoryKind, str], ...]] = (
    (
        re.compile(r"\b(vegetarian|vegan|non[- ]?veg|eggetarian)\b|शाकाहारी|मांसाहारी", re.I),
        "preference",
        "diet",
    ),
    (
        re.compile(
            r"\b(i live in|i stay in|my home is in|main .* mein rehta|main .* mein rehti)\b"
            r"|रहता हूँ|रहती हूँ|मेरा घर",
            re.I,
        ),
        "fact",
        "home_city",
    ),
    (re.compile(r"\b(wake up|uthta|uthti)\b|उठता|उठती", re.I), "fact", "wake_time"),
    (re.compile(r"\b(window|aisle) seat", re.I), "preference", "seat_preference"),
    (
        re.compile(
            r"\b(i work as|i'm an?|i am an?) "
            r"(engineer|doctor|teacher|designer|developer|lawyer|accountant)\b",
            re.I,
        ),
        "fact",
        "occupation",
    ),
    (
        re.compile(r"\b(this week|this weekend|right now|currently|is hafte|abhi)\b|इस हफ़्ते", re.I),
        "context",
        "current_trip",
    ),
    (
        re.compile(r"\b(i (?:hate|dislike|don't like|do not like))\b|pasand nahi", re.I),
        "preference",
        "cuisine_dislike",
    ),
    (re.compile(r"\b(i (?:like|love|prefer|enjoy))\b|pasand hai|पसंद है", re.I), "preference", "other"),
)


def _clauses(message: str) -> list[str]:
    return [c.strip(" ,:-") for c in _CLAUSE_SPLIT.split(message) if c and c.strip(" ,:-")]


def _classify(text: str) -> tuple[MemoryKind, str]:
    for pattern, kind, slot in _SLOT_RULES:
        if pattern.search(text):
            return kind, slot
    return "fact", "other"


class MockMemoryExtractor:
    """Deterministic rule-based extractor for the mock gateway. Always ``sensitivity: 'none'``
    (so mock evaluation measures the API's deterministic layer alone, M-08) and ``is_mock``."""

    async def extract(self, message_text: str, *, max_candidates: int) -> ExtractionResult:
        out: list[MemoryCandidate] = []
        for clause in _clauses(message_text):
            if len(out) >= max_candidates:
                break
            if _NOT_A_STATEMENT.search(clause):
                continue
            trigger = _TRIGGER.search(clause)
            value = clause
            if trigger:
                # Strip the trigger phrase from either end so the value stays a verbatim substring.
                if trigger.start() == 0:
                    value = clause[trigger.end() :].strip(" ,:-")
                elif trigger.end() == len(clause.rstrip(" ,:-")):
                    value = clause[: trigger.start()].strip(" ,:-")
            relation = _RELATION.search(value)
            subject: MemorySubject = "third_party" if relation else "self"
            if not trigger and not relation and not _SELF_MARKER.search(value):
                continue
            if not value or value not in clause or len(value) > 280 or len(clause) > 280:
                continue
            kind, slot = _classify(value)
            if subject == "third_party":
                slot = "contact_fact"
                kind = "fact" if kind not in ("fact", "preference", "event") else kind
            fields: dict[str, object] = {
                "kind": kind,
                "slot": slot,
                "subject": subject,
                "source_span": clause,
                "value_text": value,
                "explicit_request": trigger is not None,
                "sensitivity": "none",
            }
            if relation:
                fields["subject_label"] = next(g for g in relation.groups() if g)
            if trigger:
                fields["trigger_text"] = trigger.group(0)[:40]
            out.append(MemoryCandidate.model_validate(fields))
        return ExtractionResult(
            candidates=tuple(out),
            is_mock=True,
            requested_model=None,
            served_model=None,
            estimated_cost_usd=0.0,
        )
