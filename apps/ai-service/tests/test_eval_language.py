"""Reply-language detector used by Phase 02 chat evals."""

from __future__ import annotations

import pytest

from karen_ai.evaluation.language import detect_reply_language


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("नमस्ते! बारिश में सीलन से बचने के लिए खिड़कियाँ खुली रखें।", "hi"),
        ("Haan bilkul, aap subah jaldi uthkar thoda walk kar sakte hain aur paani piyo.", "hi-Latn"),
        ("Sure — here are three tips to prepare for your interview tomorrow.", "en"),
        ("Aapka budget ₹50,000 hai toh Goa ka trip theek rahega.", "hi-Latn"),
        ("", None),
        ("12345 !!!", None),
    ],
)
def test_detect_reply_language(text: str, expected: str | None) -> None:
    assert detect_reply_language(text) == expected
