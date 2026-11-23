"""Voice selection: response language x saved accent/gender preference -> a catalog voice.

Pure and deterministic, so it is fully unit-testable. Rules (ADR-0026):

- Hindi (Devanagari) is always spoken with an Indian Hindi voice, whatever the accent preference.
- Hinglish (romanised Hindi) uses the catalog's ``hinglish_voice_language`` voice with an Indian
  accent (an American or British voice would mangle Hindi words).
- English uses the saved accent (Indian, American or British).
- A saved preferred voice (``preferences.voice_id``) wins when it is usable AND speaks the
  reply's voice language (a Hindi reply never uses an English-only voice, and vice versa).
- Fallback order, first match wins: exact (language, accent, gender) -> any gender -> any accent
  of the language -> Indian English -> any usable voice. Each step down is reported so callers
  can show "your preferred voice is unavailable" without failing the request.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

from karen_ai.contracts import SpeechLanguage, VoicePreferences
from karen_ai.speech.catalog import Accent, Voice, VoiceLanguage

FallbackLevel = Literal["preferred", "exact", "any_gender", "any_accent", "default_voice", "any_voice"]


class NoVoiceAvailableError(LookupError):
    """The catalog has no usable voice at all."""


@dataclass(frozen=True)
class VoiceChoice:
    voice: Voice
    spoken_language: SpeechLanguage
    fallback: FallbackLevel


def voice_language_for(language: SpeechLanguage, *, hinglish_voice_language: VoiceLanguage) -> VoiceLanguage:
    if language == "hi":
        return "hi"
    if language == "hi-Latn":
        return hinglish_voice_language
    return "en"


def target_accent(language: SpeechLanguage, preferred: Accent) -> Accent:
    """Hindi and Hinglish always use Indian voices; English follows the user's preference."""
    return "indian" if language in ("hi", "hi-Latn") else preferred


def select_voice(
    language: SpeechLanguage,
    preferences: VoicePreferences,
    voices: Sequence[Voice],
    *,
    hinglish_voice_language: VoiceLanguage,
) -> VoiceChoice:
    if not voices:
        raise NoVoiceAvailableError("no usable voice in the catalog")
    voice_language = voice_language_for(language, hinglish_voice_language=hinglish_voice_language)
    if preferences.voice_id is not None:
        for voice in voices:
            if voice.voice_id == preferences.voice_id and voice.language == voice_language:
                return VoiceChoice(voice=voice, spoken_language=language, fallback="preferred")
    accent = target_accent(language, preferences.accent)
    gender = None if preferences.gender == "any" else preferences.gender

    def first(
        level: FallbackLevel, *, lang: VoiceLanguage | None, acc: Accent | None, gen: bool
    ) -> VoiceChoice | None:
        for voice in voices:
            if lang is not None and voice.language != lang:
                continue
            if acc is not None and voice.accent != acc:
                continue
            if gen and gender is not None and voice.gender != gender:
                continue
            return VoiceChoice(voice=voice, spoken_language=language, fallback=level)
        return None

    steps: list[tuple[FallbackLevel, VoiceLanguage | None, Accent | None, bool]] = [
        ("exact", voice_language, accent, True),
        ("any_gender", voice_language, accent, False),
        ("any_accent", voice_language, None, False),
        ("default_voice", "en", "indian", False),
        ("any_voice", None, None, False),
    ]
    if gender is None:  # no gender preference: "exact" already ignores gender
        steps = [s for s in steps if s[0] != "any_gender"]
    for level, lang, acc, gen in steps:
        choice = first(level, lang=lang, acc=acc, gen=gen)
        if choice is not None:
            return choice
    raise NoVoiceAvailableError("no usable voice in the catalog")  # pragma: no cover - any_voice matches
