"""Deepgram speech probe (manual, opt-in, cost-capped). Run by an operator, never by tests or CI:

    uv run karen-ai-speech-probe --confirm-paid-calls --samples-dir /tmp/karen-voice-samples
    # listen to every sample, then:
    uv run karen-ai-speech-probe --confirm-paid-calls --mark-verified --voices-listened

What it does (through KAREN's own ``DeepgramSpeechClient``, so KAREN's mapping is what is tested):
1. TTS: one short synthetic sentence per catalog voice (English voices an English sentence, Hindi
   voices a Hindi one); audio is written to ``--samples-dir`` for the listening check.
2. Batch STT: each catalog STT batch model transcribes one Hindi and one English TTS sample (a
   round trip: the transcript should resemble the sentence; lengths and languages are reported).
3. Live STT: each live model streams one short Ogg/Opus English sample (fetched from Aura TTS
   with ``encoding=opus``; Flux rejects MP3 and an empty stream) in ~250 ms chunks and must return
   transcript events without an error.

Without ``--confirm-paid-calls`` it only prints the plan and the worst-case cost. The worst case
is computed from catalog prices first and refused above ``--max-run-cost-usd``. The report never
contains the API key, and transcript text is shown only as a match ratio.

``--mark-verified`` writes ``verified_at`` (today) into the catalog for models whose checks passed;
voices are marked only with ``--voices-listened`` (an operator confirms the listening check:
correct language, accent, gender and acceptable Hindi/Hinglish pronunciation).
"""

from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import difflib
import json
import sys
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any, Final

import httpx2
from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

from karen_ai.core.settings import SERVICE_ROOT, DeepgramRegion
from karen_ai.gateway.base import GatewayError
from karen_ai.speech.base import LiveConfig, SynthesisInput, TranscriptionInput
from karen_ai.speech.catalog import VoiceCatalog, load_catalog
from karen_ai.speech.deepgram import REGION_HOSTS, DeepgramSpeechClient

DEFAULT_CATALOG: Final = SERVICE_ROOT / "config" / "voice-catalog.deepgram.json"
SAMPLE_TEXT: Final = {
    "en": "Hello, I am KAREN. Your meeting is tomorrow at ten thirty.",
    "hi": "नमस्ते, मैं करेन हूँ। आपकी मीटिंग कल साढ़े दस बजे है।",
}
# Upper bound on one sample's audio length for STT cost (short sentences are ~4 s).
_SAMPLE_SECONDS: Final = 10.0
_LIVE_CHUNK_BYTES: Final = 2000  # ~250 ms of 32-64 kbit/s Opus, like the browser's chunks
_LIVE_DRAIN_SECONDS: Final = 10.0
OpusSampler = Callable[[str], Awaitable[bytes | None]]


class ProbeSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    deepgram_api_key: SecretStr | None = None
    deepgram_region: DeepgramRegion = "global"


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    parser.add_argument("--confirm-paid-calls", action="store_true")
    parser.add_argument("--max-run-cost-usd", type=float, default=0.25)
    parser.add_argument("--samples-dir", type=Path, default=None)
    parser.add_argument("--mark-verified", action="store_true")
    parser.add_argument("--voices-listened", action="store_true")
    return parser.parse_args(argv)


def worst_case_cost(catalog: VoiceCatalog) -> float:
    total = 0.0
    for voice in catalog.voices:
        model = catalog.tts_model(voice.model_id)
        total += (model.cost_usd(len(SAMPLE_TEXT[voice.language])) if model else None) or 0.0
    for model in catalog.stt_models:
        if "batch" in model.modes:
            total += 2 * (model.cost_usd(_SAMPLE_SECONDS / 60) or 0.0)
        if "live" in model.modes:
            total += model.cost_usd(_SAMPLE_SECONDS / 60) or 0.0
            aura = next((v for v in catalog.voices if "aura" in v.model_id and v.language == "en"), None)
            aura_model = catalog.tts_model(aura.model_id) if aura else None
            total += (aura_model.cost_usd(len(SAMPLE_TEXT["en"])) if aura_model else None) or 0.0
    return round(total, 4)


def similarity(expected: str, heard: str) -> float:
    def norm(text: str) -> str:
        return "".join(ch for ch in text.lower() if ch.isalnum())

    return round(difflib.SequenceMatcher(None, norm(expected), norm(heard)).ratio(), 2)


async def run(
    args: argparse.Namespace,
    catalog: VoiceCatalog,
    client: DeepgramSpeechClient,
    opus_sample: OpusSampler | None = None,
) -> dict[str, Any]:
    report: dict[str, Any] = {"voices": {}, "stt": {}, "live": {}}
    samples: dict[str, bytes] = {}
    for voice in catalog.voices:
        text = SAMPLE_TEXT[voice.language]
        try:
            audio = b"".join(
                [
                    chunk
                    async for chunk in client.synthesize(
                        SynthesisInput(
                            request_id=f"probe-{voice.voice_id}",
                            text=text,
                            model=voice.model_id,
                            voice_id=voice.voice_id,
                            speed=1.0,
                        )
                    )
                ]
            )
        except GatewayError as exc:
            report["voices"][voice.voice_id] = {"ok": False, "error": exc.code, "status": exc.status_code}
            continue
        samples.setdefault(voice.language, audio)
        report["voices"][voice.voice_id] = {"ok": True, "bytes": len(audio)}
        if args.samples_dir is not None:
            args.samples_dir.mkdir(parents=True, exist_ok=True)
            (args.samples_dir / f"{voice.voice_id}.mp3").write_bytes(audio)
    for model in catalog.stt_models:
        if "batch" not in model.modes:
            continue
        results: dict[str, dict[str, Any]] = {}
        for language, audio in samples.items():
            try:
                out = await client.transcribe(
                    TranscriptionInput(
                        request_id=f"probe-stt-{language}",
                        audio=audio,
                        audio_format="mp3",
                        language_hint=None,
                        models=(model.model_id,),
                    )
                )
            except GatewayError as exc:
                results[language] = {"ok": False, "error": exc.code, "status": exc.status_code}
                continue
            results[language] = {
                "ok": bool(out.text),
                "match": similarity(SAMPLE_TEXT[language], out.text),
                "language": out.language,
                "duration_seconds": out.duration_seconds,
            }
        report["stt"][model.model_id] = results
    aura = next((v for v in catalog.voices if "aura" in v.model_id and v.language == "en"), None)
    for model in catalog.stt_models:
        if "live" not in model.modes:
            continue
        opus = await opus_sample(aura.voice_id) if opus_sample is not None and aura is not None else None
        if not opus:
            report["live"][model.model_id] = {"ok": False, "error": "NO_OPUS_SAMPLE"}
            continue
        report["live"][model.model_id] = await _live_check(client, model.model_id, opus)
    return report


async def _live_check(client: DeepgramSpeechClient, model_id: str, opus: bytes) -> dict[str, Any]:
    try:
        stream = await client.connect(
            LiveConfig(
                request_id="probe-live", model=model_id, language_hints=("en", "hi"), audio_format="ogg"
            )
        )
    except GatewayError as exc:
        return {"ok": False, "error": exc.code, "status": exc.status_code}
    kinds: list[str] = []
    heard = ""

    async def collect() -> None:
        nonlocal heard
        async for event in stream.events():
            kinds.append(event.kind)
            if event.text:
                heard = event.text

    reader = asyncio.create_task(collect())
    try:
        for start in range(0, len(opus), _LIVE_CHUNK_BYTES):
            await stream.send_audio(opus[start : start + _LIVE_CHUNK_BYTES])
            await asyncio.sleep(0.25)
        await asyncio.sleep(2.0)
        await stream.finish()
        await asyncio.wait_for(reader, _LIVE_DRAIN_SECONDS)
    except (GatewayError, TimeoutError) as exc:
        await stream.abort()
        reader.cancel()
        return {"ok": False, "error": getattr(exc, "code", "TIMEOUT"), "events": sorted(set(kinds))}
    ok = "error" not in kinds and bool(heard)
    return {"ok": ok, "events": sorted(set(kinds)), "match": similarity(SAMPLE_TEXT["en"], heard)}


async def fetch_opus_sample(
    api_key: SecretStr, region: DeepgramRegion, voice_id: str, text: str = SAMPLE_TEXT["en"]
) -> bytes | None:
    """One Ogg/Opus TTS clip (``/v1/speak?encoding=opus``): the probe's live input."""
    url = f"https://{REGION_HOSTS[region]}/v1/speak"
    async with httpx2.AsyncClient(timeout=30) as http:
        response = await http.post(
            url,
            params={"model": voice_id, "encoding": "opus", "mip_opt_out": "true"},
            json={"text": text},
            headers={"Authorization": f"Token {api_key.get_secret_value()}"},
        )
    if response.is_error:
        sys.stderr.write(f"opus sample failed: HTTP {response.status_code}\n")
        return None
    return response.content


def mark_verified(path: Path, report: dict[str, Any], *, voices_listened: bool) -> int:
    data = json.loads(path.read_text(encoding="utf-8"))
    today = dt.date.today().isoformat()
    marked = 0
    for model in data["stt_models"]:
        stt = report["stt"].get(model["model_id"])
        live = report["live"].get(model["model_id"])
        ok_batch = stt is not None and stt and all(r.get("ok") for r in stt.values())
        if ok_batch or (live is not None and live.get("ok")):
            model["verified_at"], marked = today, marked + 1
    passed_voices = {vid for vid, r in report["voices"].items() if r.get("ok")}
    for model in data["tts_models"]:
        if any(v["model_id"] == model["model_id"] and v["voice_id"] in passed_voices for v in data["voices"]):
            model["verified_at"], marked = today, marked + 1
    if voices_listened:
        for voice in data["voices"]:
            if voice["voice_id"] in passed_voices:
                voice["verified_at"], marked = today, marked + 1
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return marked


def main(argv: list[str] | None = None) -> None:
    args = parse_args(argv)
    catalog = load_catalog(args.catalog)
    worst = worst_case_cost(catalog)
    plan = {
        "voices": len(catalog.voices),
        "stt_models": [m.model_id for m in catalog.stt_models],
        "worst_case_cost_usd": worst,
        "max_run_cost_usd": args.max_run_cost_usd,
    }
    if not args.confirm_paid_calls:
        sys.stdout.write(json.dumps({"plan_only": plan}, indent=2) + "\nNo paid call was made.\n")
        return
    if worst > args.max_run_cost_usd:
        sys.exit(f"refused: worst-case cost {worst} USD exceeds --max-run-cost-usd {args.max_run_cost_usd}")
    settings = ProbeSettings()
    if settings.deepgram_api_key is None:
        sys.exit("DEEPGRAM_API_KEY is not set (put it in apps/ai-service/.env)")
    api_key = settings.deepgram_api_key
    client = DeepgramSpeechClient(
        api_key=settings.deepgram_api_key,
        region=settings.deepgram_region,
        timeout_seconds=30,
        max_retries=1,
    )

    async def go() -> dict[str, Any]:
        try:

            async def sampler(voice_id: str) -> bytes | None:
                return await fetch_opus_sample(api_key, settings.deepgram_region, voice_id)

            return await run(args, catalog, client, sampler)
        finally:
            await client.aclose()

    report = asyncio.run(go())
    sys.stdout.write(json.dumps({"plan": plan, "report": report}, indent=2, ensure_ascii=False) + "\n")
    if args.mark_verified:
        count = mark_verified(args.catalog, report, voices_listened=args.voices_listened)
        sys.stderr.write(f"marked {count} catalog entries verified in {args.catalog}\n")


if __name__ == "__main__":  # pragma: no cover
    main()
