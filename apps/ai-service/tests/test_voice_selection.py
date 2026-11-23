"""Voice selection, language detection and speech text preparation (pure logic, no network)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from karen_ai.contracts import SpeechLanguage, VoiceAccent, VoiceGender, VoicePreferences
from karen_ai.core.language import detect_language
from karen_ai.core.settings import MOCK_VOICE_CATALOG_PATH, SERVICE_ROOT
from karen_ai.speech.catalog import CatalogError, Voice, load_catalog
from karen_ai.speech.service import transcript_language
from karen_ai.speech.text import sentence_chunks, speakable, truncate_for_speech
from karen_ai.speech.voices import NoVoiceAvailableError, select_voice

MOCK = load_catalog(MOCK_VOICE_CATALOG_PATH)
LIVE_CATALOG_PATH = SERVICE_ROOT / "config" / "voice-catalog.live.json"


def prefs(
    accent: VoiceAccent = "indian", gender: VoiceGender = "any", speed: float = 1.0
) -> VoicePreferences:
    return VoicePreferences(accent=accent, gender=gender, speed=speed)


def choose(
    language: SpeechLanguage, preferences: VoicePreferences, voices: list[Voice] | None = None
) -> Voice:
    return select_voice(
        language,
        preferences,
        voices if voices is not None else MOCK.voices,
        hinglish_voice_language=MOCK.hinglish_voice_language,
    ).voice


# ------------------------------------------------------------------------------ language detection


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Remind me to call mom at 7.", "en"),
        ("कल सुबह सात बजे याद दिलाना।", "hi"),
        ("Kal subah 7 baje mujhe yaad dila dena, theek hai?", "hi-Latn"),
        ("12345 !!!", None),
    ],
)
def test_detect_language(text: str, expected: SpeechLanguage | None) -> None:
    assert detect_language(text) == expected


@pytest.mark.parametrize(
    ("text", "provider", "expected"),
    [
        ("कल सुबह याद दिलाना", "hi", "hi"),
        ("Kal subah yaad dilana please", "hi", "hi-Latn"),  # Latin script + provider says Hindi
        ("Kal subah yaad dila dena, theek hai", "en", "hi-Latn"),  # markers win over a provider "en"
        ("Book a cab to the airport", "en", "en"),
        ("Book a cab to the airport", None, "en"),
    ],
)
def test_transcript_language_combines_script_and_provider(
    text: str, provider: str | None, expected: SpeechLanguage
) -> None:
    assert transcript_language(text, provider) == expected


# ------------------------------------------------------------------------------ voice selection


@pytest.mark.parametrize(
    ("accent", "expected"),
    [("indian", "mock-en-IN-female"), ("american", "mock-en-US"), ("british", "mock-en-GB")],
)
def test_english_follows_the_saved_accent(accent: VoiceAccent, expected: str) -> None:
    assert choose("en", prefs(accent)).voice_id == expected


@pytest.mark.parametrize("accent", ["indian", "american", "british"])
def test_hindi_always_uses_an_indian_hindi_voice(accent: VoiceAccent) -> None:
    voice = choose("hi", prefs(accent))
    assert (voice.language, voice.accent) == ("hi", "indian")


@pytest.mark.parametrize("accent", ["indian", "american", "british"])
def test_hinglish_uses_the_code_switching_voice_with_an_indian_accent(accent: VoiceAccent) -> None:
    voice = choose("hi-Latn", prefs(accent))
    assert (voice.language, voice.accent) == (MOCK.hinglish_voice_language, "indian")


def test_gender_preference_is_honoured_when_known() -> None:
    assert choose("hi", prefs(gender="male")).voice_id == "mock-hi-IN-male"
    assert choose("en", prefs("indian", gender="male")).voice_id == "mock-en-IN-male"


def test_gender_falls_back_when_no_voice_matches() -> None:
    choice = select_voice("en", prefs("american", gender="female"), MOCK.voices, hinglish_voice_language="en")
    assert choice.voice.voice_id == "mock-en-US"  # its gender is unknown: any-gender fallback
    assert choice.fallback == "any_gender"


def test_missing_accent_falls_back_to_another_accent_of_the_language() -> None:
    english_without_british = [v for v in MOCK.voices if v.accent != "british"]
    choice = select_voice("en", prefs("british"), english_without_british, hinglish_voice_language="en")
    assert choice.voice.language == "en"
    assert choice.fallback == "any_accent"


def test_missing_hindi_voice_falls_back_to_indian_english() -> None:
    no_hindi = [v for v in MOCK.voices if v.language != "hi"]
    choice = select_voice("hi", prefs(), no_hindi, hinglish_voice_language="en")
    assert (choice.voice.language, choice.voice.accent, choice.fallback) == ("en", "indian", "default_voice")


def test_empty_catalog_raises() -> None:
    with pytest.raises(NoVoiceAvailableError):
        select_voice("en", prefs(), [], hinglish_voice_language="en")


def test_live_catalog_covers_every_language_and_accent() -> None:
    """The committed catalog (from the live listing) offers every combination users can pick."""
    catalog = load_catalog(LIVE_CATALOG_PATH)
    combos = {(v.language, v.accent) for v in catalog.voices}
    assert {("en", "indian"), ("en", "american"), ("en", "british"), ("hi", "indian")} <= combos
    assert all(v.gender is None for v in catalog.voices)  # never guessed from names
    assert all(m.verified_at is None for m in [*catalog.stt_models, *catalog.tts_models])
    for language in ("en", "hi", "hi-Latn"):
        for accent in ("indian", "american", "british"):
            choice = select_voice(language, prefs(accent), catalog.voices, hinglish_voice_language="en")
            assert choice.fallback == "exact"


def test_catalog_rejects_voices_of_unknown_models(tmp_path: Path) -> None:
    data = json.loads(MOCK_VOICE_CATALOG_PATH.read_text())
    data["voices"][0]["model_id"] = "test-creator/not-listed"
    path = tmp_path / "catalog.json"
    path.write_text(json.dumps(data))
    with pytest.raises(CatalogError, match="invalid"):
        load_catalog(path)


# ------------------------------------------------------------------------------ text for speech


def test_speakable_drops_table_rules_but_keeps_hyphenated_words() -> None:
    assert speakable("| Item | Cost |\n|---|---:|\n| Stay | ₹8,000 |") == "Item Cost Stay ₹8,000"
    assert speakable("A well-known 3-day plan.") == "A well-known 3-day plan."


def test_speakable_strips_markdown_but_keeps_link_labels() -> None:
    assert (
        speakable("**Kal** 7 baje — [Swiggy](https://example.invalid) se `order`.")
        == "Kal 7 baje — Swiggy se order."
    )


def test_sentence_chunks_split_latin_and_devanagari_sentences() -> None:
    assert sentence_chunks("Pehla vaakya. Doosra! कल मिलते हैं। Thanks?") == [
        "Pehla vaakya.",
        "Doosra!",
        "कल मिलते हैं।",
        "Thanks?",
    ]


def test_long_sentences_are_split_at_word_boundaries() -> None:
    chunks = sentence_chunks(" ".join(["shabd"] * 200), target=50)
    assert all(len(c) <= 50 for c in chunks)
    assert " ".join(chunks) == " ".join(["shabd"] * 200)


def test_truncation_prefers_a_sentence_end() -> None:
    text = "First sentence is here. Second sentence is longer than the limit allows."
    cut, truncated = truncate_for_speech(text, 40)
    assert (cut, truncated) == ("First sentence is here.", True)
    assert truncate_for_speech("short", 40) == ("short", False)
