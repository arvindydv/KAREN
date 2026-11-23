"""Runtime language/script detection for English, Hindi and Hinglish (ADR-0026).

Deterministic and dependency-free: the Devanagari share decides Hindi; Latin-script text is
Hinglish when enough common Hindi function words appear. A heuristic with known limits (very short
text, names, code): it picks a TTS voice and a reply-language hint, never anything authoritative.
Calibrate thresholds against the SP-3 baseline before gating on it. New languages extend
``Language`` plus a detector rule; voice selection falls back gracefully for unknown ones.
"""

from __future__ import annotations

import re
from typing import Final, Literal

# English, Hindi (Devanagari) and Hinglish (romanised Hindi mixed with English).
Language = Literal["en", "hi", "hi-Latn"]
LANGUAGES: Final[tuple[Language, ...]] = ("en", "hi", "hi-Latn")

_HINGLISH_MARKERS: Final[frozenset[str]] = frozenset(
    [
        "hai",
        "hain",
        "ho",
        "ka",
        "ki",
        "ke",
        "ko",
        "se",
        "mein",
        "aur",
        "ya",
        "nahi",
        "nahin",
        "kya",
        "kyun",
        "kaise",
        "kab",
        "kahan",
        "aap",
        "tum",
        "hum",
        "mera",
        "meri",
        "mere",
        "apna",
        "apni",
        "karo",
        "karna",
        "kar",
        "kare",
        "raha",
        "rahi",
        "rahe",
        "tha",
        "thi",
        "hoga",
        "hogi",
        "chahiye",
        "sakte",
        "sakta",
        "sakti",
        "liye",
        "wala",
        "wali",
        "bhi",
        "toh",
        "agar",
        "lekin",
        "abhi",
        "kal",
        "aaj",
        "jaldi",
        "thoda",
        "bahut",
        "accha",
        "acha",
        "theek",
    ]
)
# Markers exclude words that are also common English ("me", "main", "the", "par").
_WORD: Final = re.compile(r"[A-Za-z]+")
_DEVANAGARI_WORD: Final = re.compile(r"[\u0900-\u097F]+")
# Hindi written in Devanagari often keeps English terms in Latin script ("मुझे authentication
# system समझाओ"): a third of the words in Devanagari makes it Hindi, not Hinglish (ADR-0027).
_MIN_DEVANAGARI_WORD_SHARE: Final = 0.34
_MIN_MARKERS: Final = 2
_MIN_MARKER_SHARE: Final = 0.12


def detect_language(text: str) -> Language | None:
    """Language/script of ``text``, or ``None`` when it has no letters."""
    letters = [ch for ch in text if ch.isalpha()]
    if not letters:
        return None
    devanagari = sum(1 for ch in letters if "ऀ" <= ch <= "ॿ")
    if devanagari / len(letters) >= 0.5:
        return "hi"
    words = [w.lower() for w in _WORD.findall(text)]
    devanagari_words = len(_DEVANAGARI_WORD.findall(text))
    if devanagari_words and devanagari_words / (devanagari_words + len(words)) >= _MIN_DEVANAGARI_WORD_SHARE:
        return "hi"
    if not words:
        return None
    markers = sum(1 for w in words if w in _HINGLISH_MARKERS)
    # Two markers minimum: one shared short word in an English sentence is not Hinglish.
    return "hi-Latn" if markers >= _MIN_MARKERS and markers / len(words) >= _MIN_MARKER_SHARE else "en"
