"""Reply language detection for chat evals: the runtime detector (``karen_ai.core.language``)."""

from __future__ import annotations

from karen_ai.core.language import Language as ReplyLanguage
from karen_ai.core.language import detect_language as detect_reply_language

__all__ = ["ReplyLanguage", "detect_reply_language"]
