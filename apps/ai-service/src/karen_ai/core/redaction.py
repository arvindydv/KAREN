"""Masking of secrets and personal data before anything reaches logs or telemetry.

This is defence in depth: the primary rule is that prompt/response content is never logged.
Patterns are deliberately aggressive; a false positive in a log line is acceptable.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any, Final

REDACTED: Final = "[REDACTED]"

# Matches on the key's *suffix* so metadata such as ``input_tokens`` or ``first_token_at`` survives.
_SENSITIVE_KEY: Final = re.compile(
    r"(?i)(authorization|api[_-]?key|(?:^|[_-])key|secret|password|passwd|token|cookie|signature|dsn"
    r"|credentials?"
    # Phase 03 memory content (ADR-0036 §12.2): masked whatever the nesting.
    r"|value_text|source_excerpt|source_span|trigger_text|memory_context|message_text|subject_label"
    r"|(?:^|[_-])text)$"
)

# Order matters: specific secret formats first, generic digit runs last.
_PATTERNS: Final[tuple[tuple[re.Pattern[str], str], ...]] = (
    (re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]+"), f"Bearer {REDACTED}"),
    (re.compile(r"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+"), "[REDACTED_JWT]"),
    (
        re.compile(r"(?i)\b(api[_-]?key|secret|token|password|passwd)(\s*[:=]\s*)(\"?)[^\s\",;]+"),
        rf"\1\2\3{REDACTED}",
    ),
    (re.compile(r"\b(?:sk|pk|rk|vck|key)[-_][A-Za-z0-9_-]{16,}\b"), "[REDACTED_KEY]"),
    (re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"), "[REDACTED_EMAIL]"),
    (re.compile(r"\+\d{1,3}[\s-]?\d(?:[\s-]?\d){7,13}\b"), "[REDACTED_PHONE]"),
    (re.compile(r"\b[6-9]\d{9}\b"), "[REDACTED_PHONE]"),
    (re.compile(r"\b\d{3}[\s-]\d{3}[\s-]\d{4}\b"), "[REDACTED_PHONE]"),
    (re.compile(r"\b\d(?:[\s-]?\d){8,}\b"), "[REDACTED_NUMBER]"),
)


def redact_text(text: str) -> str:
    for pattern, replacement in _PATTERNS:
        text = pattern.sub(replacement, text)
    return text


def redact_value(value: object) -> object:
    if isinstance(value, str):
        return redact_text(value)
    if isinstance(value, Mapping):
        return redact_mapping(value)
    if isinstance(value, list | tuple):
        return [redact_value(v) for v in value]
    return value


def redact_mapping(data: Mapping[Any, object]) -> dict[str, object]:
    """Recursively redact a mapping; values under sensitive-looking keys are masked entirely."""
    out: dict[str, object] = {}
    for key, value in data.items():
        name = str(key)
        sensitive = _SENSITIVE_KEY.search(name) is not None
        out[name] = REDACTED if sensitive and value is not None else redact_value(value)
    return out
