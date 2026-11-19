"""Spoken-amount slot extraction and scoring (₹1,500 vs ₹15,000 matters more than WER).

``parse_amount_inr`` is a deterministic parser for amounts in digits, English, romanised Hindi
(Hinglish) and common Devanagari number words. It is an *evaluation* tool for scoring STT output
against labelled amounts; it is not a production NLU component, and an ambiguous parse must never
gate a payment (the app always shows the exact amount for confirmation).
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass
from fractions import Fraction
from typing import Final

# fmt: off
_UNITS: Final[dict[str, int]] = {
    # romanised Hindi
    "ek": 1, "do": 2, "teen": 3, "tin": 3, "char": 4, "chaar": 4, "paanch": 5, "panch": 5,
    "chhe": 6, "chhah": 6, "che": 6, "saat": 7, "aath": 8, "aat": 8, "nau": 9, "das": 10,
    "gyarah": 11, "barah": 12, "baarah": 12, "terah": 13, "chaudah": 14, "pandrah": 15,
    "solah": 16, "satrah": 17, "atharah": 18, "athaarah": 18, "unnis": 19, "bees": 20, "pachees": 25,
    "pachchees": 25, "tees": 30, "chalis": 40, "chaalis": 40, "pachas": 50, "pachaas": 50,
    "saath": 60, "pachattar": 75, "sattar": 70, "assi": 80, "nabbe": 90,
    # English
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8,
    "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "fifteen": 15, "twenty": 20, "fifty": 50,
    # Devanagari
    "एक": 1, "दो": 2, "तीन": 3, "चार": 4, "पांच": 5, "पाँच": 5, "छह": 6, "सात": 7, "आठ": 8,
    "नौ": 9, "दस": 10, "पंद्रह": 15, "पन्द्रह": 15, "बीस": 20, "पच्चीस": 25, "पचास": 50,
}
_FRACTIONS: Final[dict[str, Fraction]] = {
    "dedh": Fraction(3, 2), "derh": Fraction(3, 2), "डेढ़": Fraction(3, 2),
    "dhai": Fraction(5, 2), "dhaai": Fraction(5, 2), "ढाई": Fraction(5, 2),
}
# Prefix modifiers applied to the following unit-scaled number: saade 3 hazaar = 3,500.
_MODIFIERS: Final[dict[str, Fraction]] = {
    "saade": Fraction(1, 2), "sadhe": Fraction(1, 2), "साढ़े": Fraction(1, 2),
    "sava": Fraction(1, 4), "sawa": Fraction(1, 4), "सवा": Fraction(1, 4),
    "paune": Fraction(-1, 4), "पौने": Fraction(-1, 4),
}
# fmt: on
_HUNDRED: Final = frozenset({"sau", "hundred", "सौ"})
# Words that are also common non-numeric Hindi words ("de do" = give, "mere saath" = with me).
# A run consisting only of one of these is not treated as a number.
_AMBIGUOUS_ALONE: Final = frozenset({"do", "दो", "saath", "das", "che", "tin", "aat"})
# fmt: off
_SCALES: Final[dict[str, int]] = {
    "hazaar": 1_000, "hazar": 1_000, "hajar": 1_000, "thousand": 1_000,
    "हज़ार": 1_000, "हजार": 1_000,
    "lakh": 100_000, "lac": 100_000, "laakh": 100_000, "लाख": 100_000,
    "crore": 10_000_000, "karod": 10_000_000, "करोड़": 10_000_000,
}
# fmt: on
_DIGITS: Final = re.compile(r"(?:₹|rs\.?|inr)?\s*(\d{1,3}(?:,\d{2,3})+|\d+)(?:\.\d+)?", re.IGNORECASE)
_TOKEN: Final = re.compile(r"[^\s,.!?।]+")


def _is_number_word(token: str) -> bool:
    return (
        token in _UNITS or token in _FRACTIONS or token in _MODIFIERS or token in _HUNDRED or token in _SCALES
    )


def _number_runs(tokens: Iterable[str]) -> list[list[str]]:
    runs: list[list[str]] = []
    current: list[str] = []
    for raw in tokens:
        token = raw.lower()
        if _is_number_word(token):
            current.append(token)
        elif current:
            runs.append(current)
            current = []
    if current:
        runs.append(current)
    return [run for run in runs if not (len(run) == 1 and run[0] in _AMBIGUOUS_ALONE)]


def _parse_run(run: Iterable[str]) -> int | None:
    total = Fraction(0)
    current = Fraction(0)
    modifier: Fraction | None = None
    for token in run:
        if token in _MODIFIERS:
            modifier = _MODIFIERS[token]
        elif token in _FRACTIONS:
            current += _FRACTIONS[token]
        elif token in _UNITS:
            current += _UNITS[token]
        elif token in _HUNDRED or token in _SCALES:
            scale = 100 if token in _HUNDRED else _SCALES[token]
            base = (current if current else Fraction(1)) if modifier is None else current + modifier
            if token in _HUNDRED:
                current = base * scale
            else:
                total += base * scale
                current = Fraction(0)
            modifier = None
    value = total + current
    return int(value) if value > 0 and value.denominator == 1 else None


def parse_amount_inr(text: str) -> int | None:
    """Return the amount in whole rupees, or ``None`` when no unambiguous amount is present."""
    digit_matches = _DIGITS.findall(text)
    if len(digit_matches) == 1:
        return int(digit_matches[0].replace(",", ""))
    if len(digit_matches) > 1:
        return None  # several numbers: ambiguous for a single amount slot
    runs = _number_runs(_TOKEN.findall(text))
    return _parse_run(runs[0]) if len(runs) == 1 else None  # several spoken numbers: ambiguous


@dataclass(frozen=True)
class SlotScore:
    case_id: str
    expected_inr: int
    parsed_inr: int | None
    exact: bool
    order_of_magnitude_error: bool


@dataclass(frozen=True)
class SlotReport:
    scores: tuple[SlotScore, ...]

    @property
    def accuracy(self) -> float:
        return sum(s.exact for s in self.scores) / len(self.scores) if self.scores else 0.0

    @property
    def magnitude_errors(self) -> tuple[str, ...]:
        return tuple(s.case_id for s in self.scores if s.order_of_magnitude_error)


def _is_magnitude_error(expected: int, parsed: int | None) -> bool:
    if parsed is None or parsed == expected or parsed <= 0 or expected <= 0:
        return False
    big, small = max(parsed, expected), min(parsed, expected)
    ratio = big / small
    return big % small == 0 and ratio >= 10 and str(int(ratio)).strip("0") == "1"


def score_amount(case_id: str, expected_inr: int, hypothesis: str) -> SlotScore:
    parsed = parse_amount_inr(hypothesis)
    return SlotScore(
        case_id=case_id,
        expected_inr=expected_inr,
        parsed_inr=parsed,
        exact=parsed == expected_inr,
        order_of_magnitude_error=_is_magnitude_error(expected_inr, parsed),
    )


def score_dataset(cases: Iterable[tuple[str, int, str]]) -> SlotReport:
    return SlotReport(scores=tuple(score_amount(cid, expected, hyp) for cid, expected, hyp in cases))
