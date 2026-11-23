"""Generate the voice catalog from OpenRouter's public model catalog (free, no key, no inference).

    uv run karen-ai-voice-catalog \
        --stt creator/stt-model-a --stt creator/stt-model-b \
        --tts creator/tts-model-a --tts creator/tts-model-b \
        --write config/voice-catalog.live.json

Speech models are listed in order of preference. Voices are taken from each TTS model's
``supported_voices`` and kept only when their ID starts with a locale tag KAREN supports
(``en-IN``, ``en-US``, ``en-GB``, ``hi-IN``); accent comes from that tag. Gender is left ``null``
(never guessed from a name). Every entry is written with ``verified_at: null``: a paid probe and a
listening check must pass before live mode will use it.
"""

from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import json
import re
import sys
from pathlib import Path
from typing import Any, Final

import httpx2

from karen_ai.contracts import MODEL_ID_PATTERN
from karen_ai.speech.catalog import Accent, SpeechModel, Voice, VoiceCatalog, VoiceLanguage

DEFAULT_BASE_URL: Final = "https://openrouter.ai/api/v1"
LOCALE_VOICES: Final[dict[str, tuple[VoiceLanguage, Accent]]] = {
    "en-IN": ("en", "indian"),
    "en-US": ("en", "american"),
    "en-GB": ("en", "british"),
    "hi-IN": ("hi", "indian"),
}
_LOCALE_PREFIX: Final = re.compile(r"^([a-z]{2}-[A-Z]{2})-")


def voices_for(model_id: str, supported_voices: list[str]) -> list[Voice]:
    voices: list[Voice] = []
    for voice_id in supported_voices:
        match = _LOCALE_PREFIX.match(voice_id)
        mapped = LOCALE_VOICES.get(match.group(1)) if match else None
        if mapped is None:
            continue
        language, accent = mapped
        voices.append(Voice(voice_id=voice_id, model_id=model_id, language=language, accent=accent))
    return voices


def _pricing_note(entry: dict[str, Any], today: str) -> str:
    pricing = entry.get("pricing") or {}
    raw = {k: pricing[k] for k in ("prompt", "completion", "request") if k in pricing}
    return (
        f"From the OpenRouter catalog on {today}; zdr_endpoint=True; catalog pricing {raw} "
        "(billing unit not documented for speech). NOT VERIFIED: no paid probe or listening check yet."
    )


def build_catalog(
    *,
    stt: list[str],
    tts: list[str],
    speech_entries: dict[str, dict[str, Any]],
    transcription_entries: dict[str, dict[str, Any]],
    today: str,
) -> VoiceCatalog:
    for slug in stt:
        if slug not in transcription_entries:
            raise SystemExit(f"{slug} is not a ZDR transcription model in the live catalog.")
    for slug in tts:
        if slug not in speech_entries:
            raise SystemExit(f"{slug} is not a ZDR speech model in the live catalog.")
    voices = [v for slug in tts for v in voices_for(slug, speech_entries[slug].get("supported_voices") or [])]
    languages = {v.language for v in voices}
    if not {"en", "hi"} <= languages:
        raise SystemExit("the selected TTS models do not offer both English and Hindi voices.")
    return VoiceCatalog(
        catalog_version=f"{today}.openrouter",
        stt_models=[
            SpeechModel(model_id=s, verified_at=None, notes=_pricing_note(transcription_entries[s], today))
            for s in stt
        ],
        tts_models=[
            SpeechModel(model_id=s, verified_at=None, notes=_pricing_note(speech_entries[s], today))
            for s in tts
        ],
        voices=voices,
        hinglish_voice_language="en",
    )


async def _fetch(
    base: str, modality: str, transport: httpx2.AsyncBaseTransport | None
) -> dict[str, dict[str, Any]]:
    async with httpx2.AsyncClient(base_url=base, timeout=httpx2.Timeout(30.0), transport=transport) as public:
        response = await public.get("/models", params={"output_modalities": modality, "zdr": "true"})
        data = response.raise_for_status().json()["data"]
    return {m["id"]: m for m in data}


def _slug(value: str) -> str:
    if not re.fullmatch(MODEL_ID_PATTERN, value.strip()):
        raise argparse.ArgumentTypeError(f"not a creator/model slug: {value}")
    return value.strip()


def catalog_json(catalog: VoiceCatalog) -> str:
    data = catalog.model_dump(mode="json")
    for voice in data["voices"]:
        for key in ("gender", "verified_at"):
            if voice.get(key) is None:
                voice.pop(key, None)
    return json.dumps(data, indent=2, ensure_ascii=False) + "\n"


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="karen-ai-voice-catalog", description=__doc__.splitlines()[0])
    parser.add_argument("--stt", type=_slug, action="append", required=True)
    parser.add_argument("--tts", type=_slug, action="append", required=True)
    parser.add_argument("--write", type=Path, required=True)
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    args = parser.parse_args(argv)

    async def fetch_all() -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
        return await _fetch(args.base_url, "speech", None), await _fetch(args.base_url, "transcription", None)

    speech, transcription = asyncio.run(fetch_all())
    today = dt.datetime.now(dt.UTC).date().isoformat()
    catalog = build_catalog(
        stt=args.stt, tts=args.tts, speech_entries=speech, transcription_entries=transcription, today=today
    )
    args.write.write_text(catalog_json(catalog))
    counts = {lang: sum(v.language == lang for v in catalog.voices) for lang in ("en", "hi")}
    sys.stderr.write(f"wrote {args.write}: {len(catalog.voices)} voices {counts}, all verified_at=null\n")


if __name__ == "__main__":  # pragma: no cover
    main()
