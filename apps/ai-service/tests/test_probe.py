"""SP-1 probe helpers. Pure logic + a fake catalog transport: the probe's real calls are manual."""

from __future__ import annotations

import argparse
import json
from typing import Any

import httpx2
import pytest
from pydantic import SecretStr

from karen_ai.contracts import RouteTier
from karen_ai.core.settings import TaskRoute
from karen_ai.gateway.probe import (
    PROBE_MAX_TOKENS,
    ProbeReport,
    ProbeSettings,
    build_registry,
    catalog_blockers,
    catalog_summary,
    parse_args,
    registry_json,
    run_probe,
    suggested_env,
    worst_case_cost,
)

SLUG = "test-creator/test-model"
CATALOG_ENTRY: dict[str, Any] = {
    "id": SLUG,
    "canonical_slug": f"{SLUG}-20261101",
    "name": "Test Model",
    "context_length": 1_000_000,
    "architecture": {"input_modalities": ["text", "image"], "output_modalities": ["text"]},
    "pricing": {
        "prompt": "0.0000001",
        "completion": "0.0000005",
        "overrides": [{"min_prompt_tokens": 100_000, "prompt": "0.0000005", "completion": "0.0000025"}],
    },
    "top_provider": {"context_length": 1_000_000, "max_completion_tokens": 8_000, "is_moderated": True},
    "supported_parameters": ["max_tokens", "tools", "structured_outputs"],
    "endpoints": ["/api/v1/chat/completions"],
    "reasoning": {"mandatory": False},
    "expiration_date": None,
}


def summary(**changes: Any) -> dict[str, Any]:
    return catalog_summary({**CATALOG_ENTRY, **changes}, zdr_available=True)


def test_catalog_prices_are_converted_per_million_and_premium_band_detected() -> None:
    result = summary()
    assert result["input_usd_per_million_tokens"] == pytest.approx(0.1)
    assert result["output_usd_per_million_tokens"] == pytest.approx(0.5)
    assert result["premium_pricing_from_prompt_tokens"] == 100_000
    assert result["max_completion_tokens"] == 8_000
    assert result["chat_completions"] is True


def test_negative_router_price_sentinel_is_not_a_price() -> None:
    result = summary(pricing={"prompt": "-1", "completion": "-1"})
    assert result["input_usd_per_million_tokens"] is None
    assert worst_case_cost(result, calls=1) is None


def test_worst_case_cost_bounds_every_call() -> None:
    cost = worst_case_cost(summary(), calls=4)
    assert cost is not None
    assert cost == pytest.approx(4 * (200 * 0.1 + PROBE_MAX_TOKENS * 0.5) / 1_000_000)


def test_unparseable_price_is_refused() -> None:
    assert worst_case_cost(summary(pricing={"prompt": "n/a", "completion": "0.000001"}), calls=1) is None


def test_catalog_blockers() -> None:
    assert catalog_blockers(summary(), require_zdr=True) == []
    no_zdr = catalog_summary(CATALOG_ENTRY, zdr_available=False)
    assert catalog_blockers(no_zdr, require_zdr=True) == [
        "no zero-data-retention endpoint (OPENROUTER_ZDR=true)"
    ]
    assert catalog_blockers(no_zdr, require_zdr=False) == []
    per_request = summary(pricing={**CATALOG_ENTRY["pricing"], "request": "0.01"})
    assert "per-request fee" in catalog_blockers(per_request, require_zdr=True)[0]
    assert catalog_blockers(summary(endpoints=["/api/v1/responses"]), require_zdr=True) == [
        "no Chat Completions endpoint"
    ]


def _report(passed: bool, *, probed: bool = True) -> ProbeReport:
    result: dict[str, Any] = {"catalog": summary(), "blockers": [], "passed": passed}
    if probed:
        result["raw_complete"] = {"ok": passed}
        result["raw_stream"] = {"ok": passed, "ttft_ms": 321}
    report = ProbeReport(probed_at="2026-11-21T10:00:00+00:00", base_url="https://gateway.test.invalid")
    report.models[SLUG] = result
    return report


def test_registry_marks_only_passed_models_verified_and_caps_context_below_premium_band() -> None:
    assign = [("ECONOMY", SLUG), ("BALANCED", SLUG)]
    verified = build_registry(_report(True), assign)  # type: ignore[arg-type]
    entry = verified.models[0]
    assert entry.verified_at == "2026-11-21"
    assert entry.tiers == ["ECONOMY", "BALANCED"]
    assert (entry.supports_tools, entry.supports_json_schema, entry.supports_vision) == (True, True, True)
    assert entry.max_context_tokens == 100_000  # flat registry price stays exact
    assert entry.max_output_tokens == 8_000
    assert "TTFT 321 ms" in (entry.notes or "")
    assert "higher price band" in (entry.notes or "")

    failed = build_registry(_report(False), assign)  # type: ignore[arg-type]
    assert failed.models[0].verified_at is None
    assert "did not pass" in (failed.models[0].notes or "")

    dry = build_registry(_report(False, probed=False), assign)  # type: ignore[arg-type]
    assert "no paid SP-1 probe run yet" in (dry.models[0].notes or "")


def test_cli_accepts_text_and_vision_tiers_only() -> None:
    args = parse_args(["--assign", "BALANCED=test-creator/test-model", "--assign", "VISION=test-creator/v"])
    assert args.assign == [("BALANCED", SLUG), ("VISION", "test-creator/v")]
    assert not args.confirm_paid_calls
    for bad in ("EMBEDDING=test-creator/x", "BALANCED=not a slug", "BALANCED"):
        with pytest.raises(SystemExit):
            parse_args(["--assign", bad])


async def test_paid_run_without_key_stops_before_any_network_call() -> None:
    args = argparse.Namespace(
        assign=[("BALANCED", SLUG)], fallback=None, confirm_paid_calls=True, max_run_cost_usd=0.05
    )
    with pytest.raises(SystemExit, match="nothing was called"):
        await run_probe(args, ProbeSettings(_env_file=None))


ENDPOINTS: dict[str, Any] = {
    "data": {
        "endpoints": [
            {"uptime_last_30m": 100, "latency_last_30m": {"p50": 800}, "throughput_last_30m": {"p50": 90}},
            {"uptime_last_30m": 99, "latency_last_30m": {"p50": 1200}, "throughput_last_30m": {"p50": 40}},
            # Unhealthy endpoints are ignored.
            {"uptime_last_30m": 60, "latency_last_30m": {"p50": 9000}, "throughput_last_30m": {"p50": 5}},
        ]
    }
}


def _catalog_transport(seen: list[httpx2.Request]) -> httpx2.MockTransport:
    def handler(request: httpx2.Request) -> httpx2.Response:
        seen.append(request)
        assert request.method == "GET"
        if request.url.path.endswith("/endpoints"):
            assert request.headers["authorization"].startswith("Bearer ")
            return httpx2.Response(200, json=ENDPOINTS)
        assert request.url.path == "/api/v1/models"
        return httpx2.Response(200, json={"data": [CATALOG_ENTRY]})

    return httpx2.MockTransport(handler)


async def test_dry_run_reads_only_the_public_catalog_without_a_key() -> None:
    seen: list[httpx2.Request] = []
    args = argparse.Namespace(
        assign=[("BALANCED", SLUG)], fallback=None, confirm_paid_calls=False, max_run_cost_usd=0.05
    )
    settings = ProbeSettings(_env_file=None, openrouter_base_url="https://catalog.test.invalid/api/v1")
    report = await run_probe(args, settings, transport=_catalog_transport(seen))
    assert "dry_run" in report.checks
    assert report.provider == {"data_collection": "deny", "zdr": True}
    assert report.models[SLUG]["blockers"] == []
    assert [r.url.params.get("zdr") for r in seen] == [None, "true"]
    assert all("authorization" not in r.headers for r in seen)  # public endpoint, no key sent


async def test_dry_run_with_a_key_still_sends_no_key_and_makes_no_paid_call() -> None:
    seen: list[httpx2.Request] = []
    args = argparse.Namespace(
        assign=[("BALANCED", SLUG)], fallback=None, confirm_paid_calls=False, max_run_cost_usd=0.05
    )
    settings = ProbeSettings(
        _env_file=None,
        openrouter_base_url="https://catalog.test.invalid/api/v1",
        openrouter_api_key=SecretStr("test-only-probe-key"),
    )
    report = await run_probe(args, settings, transport=_catalog_transport(seen))
    assert "dry_run" in report.checks
    # Only free metadata reads: the public catalog, plus endpoint stats (needs the key, no inference).
    assert {r.url.path for r in seen} == {"/api/v1/models", f"/api/v1/models/{SLUG}/endpoints"}
    assert not any("chat/completions" in r.url.path for r in seen)
    assert report.models[SLUG]["performance"] == {"latency_p50_ms": 1200.0, "throughput_p50_tps": 40.0}
    assert "test-only-probe-key" not in json.dumps(report.__dict__)


async def test_unknown_candidate_is_refused_before_paid_calls() -> None:
    args = argparse.Namespace(
        assign=[("BALANCED", "test-creator/not-in-catalog")],
        fallback=None,
        confirm_paid_calls=False,
        max_run_cost_usd=0.05,
    )
    settings = ProbeSettings(_env_file=None, openrouter_base_url="https://catalog.test.invalid/api/v1")
    with pytest.raises(SystemExit, match="not in the live OpenRouter catalog"):
        await run_probe(args, settings, transport=_catalog_transport([]))


def test_suggested_env_follows_assign_order_and_routes() -> None:
    a, b, c = "test-creator/a", "test-creator/b", "test-creator/c"
    assign: list[tuple[RouteTier, str]] = [
        ("BALANCED", a),
        ("BALANCED", b),
        ("REASONING", c),
        ("VISION", a),
        ("VISION", b),
    ]
    routes: list[tuple[TaskRoute, str]] = [("DOCUMENT_ANALYSIS", b), ("CODING", c)]
    result = suggested_env(assign, routes)
    assert result == {
        a: ["KAREN_MODEL_BALANCED", "KAREN_MODEL_VISION"],
        b: ["KAREN_MODEL_BALANCED_FALLBACK", "KAREN_MODEL_DOCUMENT_ANALYSIS"],
        c: ["KAREN_MODEL_REASONING", "KAREN_MODEL_CODING"],
    }


def test_route_must_be_assigned_to_its_tier() -> None:
    with pytest.raises(SystemExit, match="must also be assigned to REASONING"):
        suggested_env([("BALANCED", SLUG)], [("CODING", SLUG)])
    args = parse_args(["--assign", f"REASONING={SLUG}", "--route", f"CODING={SLUG}"])
    assert args.route == [("CODING", SLUG)]
    with pytest.raises(SystemExit):
        parse_args(["--assign", f"REASONING={SLUG}", "--route", f"VISION={SLUG}"])


def test_registry_notes_carry_env_suggestions() -> None:
    registry = build_registry(_report(False, probed=False), [("BALANCED", SLUG)])
    assert "Suggested env: KAREN_MODEL_BALANCED" in (registry.models[0].notes or "")


def test_quality_index_comes_from_catalog_benchmarks() -> None:
    entry = {**CATALOG_ENTRY, "benchmarks": {"artificial_analysis": {"intelligence_index": 42.5}}}
    assert summary(**entry)["quality_index"] == 42.5
    assert summary()["quality_index"] is None
    bad = {**CATALOG_ENTRY, "benchmarks": {"artificial_analysis": {"intelligence_index": 400}}}
    assert summary(**bad)["quality_index"] is None


def test_registry_json_omits_unknown_metadata_instead_of_null() -> None:
    report = _report(False, probed=False)
    report.models[SLUG]["performance"] = {"latency_p50_ms": 900.0, "throughput_p50_tps": None}
    text = registry_json(build_registry(report, [("BALANCED", SLUG)]))
    entry = json.loads(text)["models"][0]
    assert entry["latency_p50_ms"] == 900.0
    assert "throughput_p50_tps" not in entry
    assert "quality_index" not in entry
    assert entry["verified_at"] is None  # nullable-required keys stay present
