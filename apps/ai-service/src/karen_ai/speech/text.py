"""Text preparation for speech: sentence chunking and safe truncation.

Synthesising sentence by sentence lets the first audio play while later sentences are still being
generated (response streaming), and lets an interruption stop synthesis early (nothing further is
billed). Markdown symbols are stripped so voices do not read "asterisk asterisk".
"""

from __future__ import annotations

import re
from typing import Final

# Sentence ends: Latin punctuation and the Devanagari danda / double danda.
_SENTENCE_END: Final = re.compile(r"(?<=[.!?।॥])\s+")
_MARKDOWN: Final = re.compile(r"[*_`#>|~]+|\[([^\]]*)\]\([^)]*\)|(?<!\w)[-:]{3,}(?!\w)")
_SPACES: Final = re.compile(r"\s+")
_SPACE_BEFORE_PUNCT: Final = re.compile(r"\s+([.,!?;:।])")
# Very long "sentences" (lists without punctuation) are split near this many characters.
CHUNK_TARGET_CHARS: Final = 280


def speakable(text: str) -> str:
    """Plain text for a voice: markdown links keep their label, symbols are dropped."""
    plain = _MARKDOWN.sub(lambda m: m.group(1) or "", text)
    return _SPACE_BEFORE_PUNCT.sub(r"\1", _SPACES.sub(" ", plain)).strip()


def truncate_for_speech(text: str, max_chars: int) -> tuple[str, bool]:
    """Cut at the last sentence end (or word boundary) within ``max_chars``."""
    if len(text) <= max_chars:
        return text, False
    window = text[:max_chars]
    ends = [m.end() for m in re.finditer(r"[.!?।॥](\s|$)", window)]
    if ends and ends[-1] >= max_chars // 2:
        return window[: ends[-1]].strip(), True
    cut = window.rfind(" ")
    return (window[:cut] if cut > 0 else window).strip(), True


def sentence_chunks(text: str, *, target: int = CHUNK_TARGET_CHARS) -> list[str]:
    """Sentences, with over-long ones split at word boundaries near ``target`` characters."""
    chunks: list[str] = []
    for raw in _SENTENCE_END.split(text):
        rest = raw.strip()
        while len(rest) > target:
            cut = rest.rfind(" ", 0, target)
            cut = cut if cut > 0 else target
            chunks.append(rest[:cut].strip())
            rest = rest[cut:].strip()
        if rest:
            chunks.append(rest)
    return chunks
