from __future__ import annotations

import json
from collections.abc import AsyncIterator

import pytest

from karen_voice.evaluation.slots import parse_amount_inr, score_amount, score_dataset
from karen_voice.mocks import (
    EchoConversationBridge,
    EnergyTurnDetector,
    ScriptedSpeechToText,
    SilentTextToSpeech,
)
from karen_voice.pipeline import AudioFrame
from tests.conftest import VOICE_DATASET


@pytest.mark.parametrize(
    ("text", "amount"),
    [
        ("pandrah sau", 1500),
        ("pandrah hazaar", 15000),
        ("mujhe pandrah sau rupaye de do", 1500),  # trailing "do" is the verb, not 2
        ("₹1,500", 1500),
        ("Rs 15,000 bhejo", 15000),
        ("1,50,000 ka loan", 150000),
        ("dedh hazaar", 1500),
        ("dhai sau", 250),
        ("saade teen hazaar", 3500),
        ("sava do sau", 225),
        ("paune do sau", 175),
        ("ek lakh pachaas hazaar", 150000),
        ("teen hazaar paanch sau", 3500),
        ("पंद्रह सौ रुपये", 1500),
        ("पंद्रह हज़ार", 15000),
        ("fifteen hundred", 1500),
    ],
)
def test_parse_amount(text: str, amount: int) -> None:
    assert parse_amount_inr(text) == amount


@pytest.mark.parametrize(
    "text", ["mere saath chalo", "kuch nahi", "15000 aur 1500", "pandrah sau ya pandrah hazaar"]
)
def test_ambiguous_or_absent_amounts_are_none(text: str) -> None:
    assert parse_amount_inr(text) is None


def test_magnitude_errors_are_flagged() -> None:
    assert score_amount("a", 1500, "pandrah hazaar").order_of_magnitude_error
    assert not score_amount("b", 1500, "sau rupaye").order_of_magnitude_error
    assert score_amount("c", 1500, "pandrah sau").exact


def test_voice_dataset_report_matches_expected_summary() -> None:
    data = json.loads(VOICE_DATASET.read_text())
    assert data["synthetic"] is True
    report = score_dataset((c["id"], c["expected_amount_inr"], c["hypothesis"]) for c in data["cases"])
    expected = data["expected_summary"]
    assert len(report.scores) == expected["total"]
    assert sum(s.exact for s in report.scores) == expected["exact"]
    assert list(report.magnitude_errors) == expected["magnitude_errors"]
    references = score_dataset((c["id"], c["expected_amount_inr"], c["reference"]) for c in data["cases"])
    assert references.accuracy == 1.0  # labels are self-consistent


async def _frames(count: int) -> AsyncIterator[AudioFrame]:
    for _ in range(count):
        yield AudioFrame(pcm16=b"\x01\x00" * 1600, sample_rate_hz=16_000)  # 100 ms


async def test_mock_pipeline_components() -> None:
    stt = ScriptedSpeechToText(["pandrah sau", "haan"])
    transcripts = [t async for t in stt.transcribe(_frames(3))]
    assert [(t.text, t.start_ms, t.end_ms) for t in transcripts] == [
        ("pandrah sau", 0, 100),
        ("haan", 100, 200),
    ]
    detector = EnergyTurnDetector(end_of_turn_silence_ms=700)
    assert detector.user_started_speaking(AudioFrame(pcm16=b"\x01\x00", sample_rate_hz=16_000))
    assert detector.is_end_of_turn(transcripts[0], silence_ms=800)
    assert not detector.is_end_of_turn(transcripts[0], silence_ms=100)
    audio = [f async for f in SilentTextToSpeech().synthesize("ok", language="hi-Latn")]
    assert len(audio) == 2
    reply = await EchoConversationBridge().reply(transcripts[0], session_id="s", user_ref="u")
    assert reply == "[mock] heard 2 word(s)"
