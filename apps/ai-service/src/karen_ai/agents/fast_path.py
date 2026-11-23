"""Deterministic NO_MODEL answers for questions code can answer exactly (date, day, time).

Cheaper and faster than any model, and never wrong about the clock. Matching is deliberately
narrow: a false negative just goes to the model; a false positive would answer the wrong question.
"""

from __future__ import annotations

import datetime as dt
import re
from typing import Final
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

DEFAULT_TIMEZONE: Final = "Asia/Kolkata"

_DATE_QUESTION: Final = re.compile(
    r"(?i)^\s*(?:"
    r"what(?:'s| is) (?:the )?(?:date|day)(?: today)?"
    r"|what (?:date|day) is (?:it )?today"
    r"|today'?s date"
    r"|aaj (?:kya|kaun ?si|konsi|kon si) (?:date|tareekh|tarikh|tithi)(?: hai)?"
    r"|aaj ki (?:date|tareekh|tarikh)(?: kya hai)?"
    r"|आज (?:क्या|कौन ?सी) (?:तारीख|तिथि|दिनांक)(?: है)?"
    r"|आज की (?:तारीख|दिनांक)(?: क्या है)?"
    r")\s*[?\uff1f।!.]*\s*$"
)
_TIME_QUESTION: Final = re.compile(
    r"(?i)^\s*(?:"
    r"what(?:'s| is) the time(?: now)?"
    r"|what time is it(?: now)?"
    r"|(?:abhi )?(?:kitne|kitna) baje(?: hain| hai)?"
    r"|(?:अभी )?कितने बजे(?: हैं| है)?"
    r"|time kya (?:hua|hai)"
    r")\s*[?\uff1f।!.]*\s*$"
)


def _zone(name: str | None) -> tuple[ZoneInfo, str]:
    try:
        return ZoneInfo(name or DEFAULT_TIMEZONE), name or DEFAULT_TIMEZONE
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo(DEFAULT_TIMEZONE), DEFAULT_TIMEZONE


def is_hindi_script(text: str) -> bool:
    return any("ऀ" <= ch <= "ॿ" for ch in text)


def deterministic_reply(text: str, *, timezone: str | None, now: dt.datetime) -> str | None:
    """Exact answer for a date/time question, or None when the model should answer."""
    zone, zone_name = _zone(timezone)
    local = now.astimezone(zone)
    if _DATE_QUESTION.match(text):
        if is_hindi_script(text):
            return f"आज {local:%d/%m/%Y} है ({zone_name})।"
        return f"Today is {local:%A, %d %B %Y} ({zone_name})."
    if _TIME_QUESTION.match(text):
        if is_hindi_script(text):
            return f"अभी {local:%H:%M} बजे हैं ({zone_name})।"
        return f"It's {local:%I:%M %p} on {local:%A, %d %B %Y} ({zone_name})."
    return None


def today_label(*, timezone: str | None, now: dt.datetime) -> tuple[str, str]:
    zone, zone_name = _zone(timezone)
    return f"{now.astimezone(zone):%A, %d %B %Y}", zone_name
