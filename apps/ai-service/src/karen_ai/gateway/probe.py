"""SP-1 live catalog probe for OpenRouter (manual, opt-in, budget-capped).

Run by an operator, never by automated tests or CI:

    uv run karen-ai-probe --assign ECONOMY=creator/model-a --assign BALANCED=creator/model-a \
        --assign BALANCED=creator/model-b --assign REASONING=creator/model-c \
        --assign REASONING=creator/model-d --route CODING=creator/model-d \
        --fallback creator/model-b --confirm-paid-calls \
        --write-registry config/model-registry.live.json

Per tier, the first ``--assign`` is the suggested primary (``KAREN_MODEL_<TIER>``) and the second
the suggested fallback (``KAREN_MODEL_<TIER>_FALLBACK``); ``--route`` suggests a task-specific
model (``KAREN_MODEL_CODING`` / ``KAREN_MODEL_DOCUMENT_ANALYSIS``). Suggestions are written into
each registry entry's ``notes`` ("Suggested env: ...") so the registry stays the only place
model IDs live.

Without ``--confirm-paid-calls`` only the public, unauthenticated model catalog is read (no key
needed, nothing is billed) and ``--write-registry`` records catalog facts with
``verified_at: null``, so live mode keeps refusing those entries.

What it checks per candidate model (docs/gateway/openrouter.md, "Enabling live traffic"):
- catalog entry (free, public ``GET /models``): prices, long-context premium thresholds, context
  and output limits, supported parameters, input modalities, ZDR endpoint availability;
- a non-streaming and a streaming completion through the real ``OpenRouterGatewayClient`` (so
  KAREN's own mapping is what gets verified), with the same provider data policy as production;
- the raw response shape: generation id location, usage fields, served model and provider.
Plus once per run: key limits (``GET /key``), invalid-key rejection (401), unknown-model rejection
and model fallback via the ``models`` array.

Only models that passed every live check get ``verified_at``.

Safety: prompts are synthetic and tiny, ``max_tokens`` is small, the worst-case spend of the whole
run is computed from catalog prices first and refused above ``--max-run-cost-usd``. The report
never contains the API key, the key label, prompts or model output text (lengths only).
"""

from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import json
import re
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Final, Literal

import httpx2
from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

from karen_ai.contracts import (
    MODEL_ID_PATTERN,
    TEXT_GENERATION_TIERS,
    ChatMessage,
    ModelCapability,
    RouteTier,
)
from karen_ai.core.settings import BASE_TEXT_TIERS, TASK_ROUTE_TIERS, TaskRoute
from karen_ai.gateway.base import GatewayDelta, GatewayError, GatewayRequest, GatewayStreamEnd
from karen_ai.gateway.openrouter import OpenRouterGatewayClient, ProviderPreferences
from karen_ai.model_router.registry import ModelRegistry

PROBE_MAX_TOKENS: Final = 64
# Upper bound for the synthetic prompt (a few dozen tokens) used for worst-case pricing.
PROBE_INPUT_TOKENS_BOUND: Final = 200
# Paid calls per candidate: raw complete, raw stream, client complete, client stream.
PAID_CALLS_PER_MODEL: Final = 4
UNKNOWN_MODEL_SLUG: Final = "karen-probe/model-that-does-not-exist"
CHAT_COMPLETIONS_ENDPOINT: Final = "/api/v1/chat/completions"
PROBE_TIERS: Final[frozenset[RouteTier]] = TEXT_GENERATION_TIERS
_MIN_ENDPOINT_UPTIME_PCT: Final = 95.0
PROBE_PROMPT: Final = (
    ChatMessage(role="system", content="You are a connectivity probe. Answer in at most five words."),
    ChatMessage(role="user", content="Reply with the word: ok"),
)


class ProbeSettings(BaseSettings):
    """Only what the probe needs; reads the same env/.env as the service, never logs the key."""

    model_config = SettingsConfigDict(env_file=".env", env_ignore_empty=True, extra="ignore", frozen=True)

    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    openrouter_api_key: SecretStr | None = None
    openrouter_data_collection: Literal["allow", "deny"] = "deny"
    openrouter_zdr: bool = True

    @property
    def provider(self) -> ProviderPreferences:
        return ProviderPreferences(data_collection=self.openrouter_data_collection, zdr=self.openrouter_zdr)


@dataclass
class ProbeReport:
    probed_at: str
    base_url: str
    provider: dict[str, Any] = field(default_factory=dict)
    models: dict[str, dict[str, Any]] = field(default_factory=dict)
    checks: dict[str, Any] = field(default_factory=dict)
    max_run_cost_usd: float = 0.0
    worst_case_run_cost_usd: float = 0.0


def _per_million(value: object) -> float | None:
    try:
        price = float(str(value))
    except ValueError:
        return None
    # Negative sentinels (e.g. "-1" for routers) mean "variable": never a usable price.
    return round(price * 1_000_000, 6) if price >= 0 else None


def catalog_summary(entry: dict[str, Any], *, zdr_available: bool) -> dict[str, Any]:
    pricing = entry.get("pricing") or {}
    top = entry.get("top_provider") or {}
    architecture = entry.get("architecture") or {}
    overrides = [o for o in pricing.get("overrides") or [] if isinstance(o, dict)]
    thresholds = [o["min_prompt_tokens"] for o in overrides if isinstance(o.get("min_prompt_tokens"), int)]
    return {
        "name": entry.get("name"),
        "canonical_slug": entry.get("canonical_slug"),
        "context_length": entry.get("context_length"),
        "max_completion_tokens": top.get("max_completion_tokens"),
        "is_moderated": top.get("is_moderated"),
        "input_usd_per_million_tokens": _per_million(pricing.get("prompt")),
        "output_usd_per_million_tokens": _per_million(pricing.get("completion")),
        "per_request_usd": float(pricing.get("request") or 0),
        # Above this prompt size a higher price band applies; the registry caps context below it.
        "premium_pricing_from_prompt_tokens": min(thresholds) if thresholds else None,
        "zdr_available": zdr_available,
        "chat_completions": CHAT_COMPLETIONS_ENDPOINT in (entry.get("endpoints") or []),
        "supported_parameters": entry.get("supported_parameters") or [],
        "input_modalities": architecture.get("input_modalities") or [],
        "reasoning_mandatory": bool((entry.get("reasoning") or {}).get("mandatory")),
        "expiration_date": entry.get("expiration_date"),
        # Artificial Analysis intelligence index as published in the catalog (None if absent).
        "quality_index": _quality_index(entry),
    }


def _quality_index(entry: dict[str, Any]) -> float | None:
    benchmarks = (entry.get("benchmarks") or {}).get("artificial_analysis") or {}
    value = benchmarks.get("intelligence_index") if isinstance(benchmarks, dict) else None
    if isinstance(value, bool) or not isinstance(value, int | float) or not 0 <= value <= 100:
        return None
    return float(value)


def endpoint_performance(endpoints: list[dict[str, Any]]) -> dict[str, float | None]:
    """Conservative p50 figures across healthy endpoints: the *slowest* TTFT and throughput.

    OpenRouter may route to any eligible endpoint, so routing should not count on the best one.
    """
    healthy = [e for e in endpoints if (e.get("uptime_last_30m") or 0) >= _MIN_ENDPOINT_UPTIME_PCT]
    latencies = [_p50(e.get("latency_last_30m")) for e in healthy]
    throughputs = [_p50(e.get("throughput_last_30m")) for e in healthy]
    known_latency = [v for v in latencies if v is not None]
    known_throughput = [v for v in throughputs if v is not None]
    return {
        "latency_p50_ms": max(known_latency) if known_latency else None,
        "throughput_p50_tps": min(known_throughput) if known_throughput else None,
    }


def _p50(stats: object) -> float | None:
    value = stats.get("p50") if isinstance(stats, dict) else None
    if isinstance(value, bool) or not isinstance(value, int | float) or value <= 0:
        return None
    return float(value)


def worst_case_cost(summary: dict[str, Any], calls: int) -> float | None:
    price_in: float | None = summary["input_usd_per_million_tokens"]
    price_out: float | None = summary["output_usd_per_million_tokens"]
    if price_in is None or price_out is None:
        return None
    per_call = (PROBE_INPUT_TOKENS_BOUND * price_in + PROBE_MAX_TOKENS * price_out) / 1_000_000
    per_request: float = summary["per_request_usd"]
    return (per_call + per_request) * calls


def catalog_blockers(summary: dict[str, Any], *, require_zdr: bool) -> list[str]:
    """Catalog facts that make a model unusable for KAREN, whatever a live call returns."""
    blockers: list[str] = []
    if not summary["chat_completions"]:
        blockers.append("no Chat Completions endpoint")
    if summary["per_request_usd"] > 0:
        blockers.append("per-request fee (not representable in the registry)")
    if not summary["max_completion_tokens"] or not summary["context_length"]:
        blockers.append("catalog does not state context/output limits")
    if "max_tokens" not in summary["supported_parameters"]:
        blockers.append("max_tokens not supported")
    if require_zdr and not summary["zdr_available"]:
        blockers.append("no zero-data-retention endpoint (OPENROUTER_ZDR=true)")
    return blockers


def _body(model: str, provider: ProviderPreferences, **extra: Any) -> dict[str, Any]:
    return {
        "model": model,
        "messages": [{"role": m.role, "content": m.content} for m in PROBE_PROMPT],
        "max_tokens": PROBE_MAX_TOKENS,
        "provider": provider.as_body(),
        **extra,
    }


def _error_shape(response: httpx2.Response) -> dict[str, Any]:
    """Status and error *code/type* only: upstream messages can echo request content."""
    try:
        error = response.json().get("error", {})
    except ValueError:
        error = {}
    metadata = error.get("metadata") if isinstance(error, dict) else None
    return {
        "status": response.status_code,
        "error_code": error.get("code") if isinstance(error, dict) else None,
        "error_type": metadata.get("error_type") if isinstance(metadata, dict) else None,
    }


def _header_names(response: httpx2.Response) -> list[str]:
    return sorted(h for h in response.headers if "id" in h or "openrouter" in h or "ratelimit" in h)


async def _raw_complete(
    http: httpx2.AsyncClient, model: str, provider: ProviderPreferences, **extra: Any
) -> dict[str, Any]:
    started = time.perf_counter()
    response = await http.post("/chat/completions", json=_body(model, provider, **extra))
    latency_ms = round((time.perf_counter() - started) * 1000)
    if response.status_code != 200:
        return {"ok": False, **_error_shape(response), "latency_ms": latency_ms}
    data = response.json()
    choice = (data.get("choices") or [{}])[0]
    usage = data.get("usage") or {}
    return {
        "ok": True,
        "status": 200,
        "latency_ms": latency_ms,
        "id_prefix": str(data.get("id", ""))[:4],
        "served_model": data.get("model"),
        "served_provider": data.get("provider"),
        "finish_reason": choice.get("finish_reason"),
        "output_chars": len((choice.get("message") or {}).get("content") or ""),
        "usage_keys": sorted(usage),
        "usage_detail_keys": {k: sorted(v) for k, v in usage.items() if isinstance(v, dict)},
        "usage_cost_present": isinstance(usage.get("cost"), int | float),
        "top_level_keys": sorted(data),
        "header_names": _header_names(response),
    }


async def _raw_stream(http: httpx2.AsyncClient, model: str, provider: ProviderPreferences) -> dict[str, Any]:
    started = time.perf_counter()
    ttft_ms: int | None = None
    chunks = usage_chunks = comment_lines = 0
    first_id: str | None = None
    finish: str | None = None
    usage_keys: list[str] = []
    stream_error: dict[str, Any] | None = None
    async with http.stream("POST", "/chat/completions", json=_body(model, provider, stream=True)) as response:
        if response.status_code != 200:
            await response.aread()
            return {"ok": False, **_error_shape(response)}
        async for line in response.aiter_lines():
            if line.startswith(":"):
                comment_lines += 1  # e.g. ": OPENROUTER PROCESSING" keep-alives
                continue
            if not line.startswith("data: ") or line == "data: [DONE]":
                continue
            data = json.loads(line.removeprefix("data: "))
            chunks += 1
            first_id = first_id or str(data.get("id", ""))[:4]
            if isinstance(data.get("error"), dict):
                stream_error = {"error_code": data["error"].get("code")}
            if data.get("usage"):
                usage_chunks += 1
                usage_keys = sorted(data["usage"])
            for choice in data.get("choices") or []:
                finish = choice.get("finish_reason") or finish
                if (choice.get("delta") or {}).get("content") and ttft_ms is None:
                    ttft_ms = round((time.perf_counter() - started) * 1000)
    return {
        "ok": stream_error is None,
        "ttft_ms": ttft_ms,
        "total_ms": round((time.perf_counter() - started) * 1000),
        "chunks": chunks,
        "comment_lines": comment_lines,
        "first_chunk_id_prefix": first_id,
        "finish_reason": finish,
        "usage_in_stream": usage_chunks > 0,
        "usage_keys": usage_keys,
        "stream_error": stream_error,
    }


async def _key_limits(http: httpx2.AsyncClient) -> dict[str, Any]:
    """Credit/limit state of the key (``GET /key``); the key label is never recorded."""
    response = await http.get("/key")
    if response.status_code != 200:
        return {"ok": False, **_error_shape(response)}
    data = response.json().get("data") or {}
    fields = ("limit", "limit_remaining", "limit_reset", "usage", "usage_daily", "is_free_tier")
    return {"ok": True, **{k: data.get(k) for k in fields}}


async def _client_roundtrip(client: OpenRouterGatewayClient, model: str) -> dict[str, Any]:
    """The production adapter end to end: complete + stream, mapped exactly as the service sees it."""
    request = GatewayRequest(
        request_id="probe", model=model, messages=PROBE_PROMPT, max_output_tokens=PROBE_MAX_TOKENS
    )
    result: dict[str, Any] = {}
    try:
        done = await client.complete(request)
        result["complete"] = {
            "finish_reason": done.finish_reason,
            "usage": done.usage.model_dump(),
            "served_model": done.served_model,
            "served_provider": done.served_provider,
            "reported_cost_usd": done.reported_cost_usd,
            "gateway_request_id_present": done.gateway_request_id is not None,
            "attempts": done.attempts,
        }
    except GatewayError as exc:
        result["complete"] = {"error": exc.code, "status": exc.status_code}
    try:
        deltas, end = 0, None
        async for item in client.stream(request):
            if isinstance(item, GatewayDelta):
                deltas += 1
            elif isinstance(item, GatewayStreamEnd):
                end = item
        result["stream"] = {
            "deltas": deltas,
            "finish_reason": end.finish_reason if end else None,
            "usage": end.usage.model_dump() if end else None,
            "served_model": end.served_model if end else None,
            "served_provider": end.served_provider if end else None,
            "reported_cost_usd": end.reported_cost_usd if end else None,
            "gateway_request_id_present": bool(end and end.gateway_request_id),
        }
    except GatewayError as exc:
        result["stream"] = {"error": exc.code, "status": exc.status_code}
    return result


def _verdict(model: dict[str, Any]) -> bool:
    raw, adapter = model.get("raw_complete", {}), model.get("adapter", {})
    stream = model.get("raw_stream", {})
    complete_ok = raw.get("ok") and "error" not in adapter.get("complete", {"error": 1})
    stream_ok = stream.get("ok") and "error" not in adapter.get("stream", {"error": 1})
    usage_ok = (adapter.get("stream", {}).get("usage") or {}).get("output_tokens") is not None
    return bool(complete_ok and stream_ok and usage_ok and not model.get("blockers"))


async def _fetch_catalog(
    base: str, transport: httpx2.AsyncBaseTransport | None
) -> tuple[dict[str, dict[str, Any]], set[str]]:
    """Public, unauthenticated catalog reads: all text models, and the ZDR-capable subset."""
    async with httpx2.AsyncClient(base_url=base, timeout=httpx2.Timeout(30.0), transport=transport) as public:
        catalog = (await public.get("/models")).raise_for_status().json()["data"]
        zdr = (await public.get("/models", params={"zdr": "true"})).raise_for_status().json()["data"]
    return {m["id"]: m for m in catalog}, {m["id"] for m in zdr}


async def _record_performance(
    base: str,
    key: SecretStr,
    candidates: list[str],
    report: ProbeReport,
    transport: httpx2.AsyncBaseTransport | None,
) -> None:
    headers = {"Authorization": f"Bearer {key.get_secret_value()}"}
    async with httpx2.AsyncClient(
        base_url=base, timeout=httpx2.Timeout(30.0), headers=headers, transport=transport
    ) as http:
        for model in candidates:
            response = await http.get(f"/models/{model}/endpoints")
            endpoints = (response.json().get("data") or {}).get("endpoints") if response.is_success else None
            perf = endpoint_performance(endpoints or [])
            report.models[model]["performance"] = perf if endpoints else {"error": response.status_code}


async def run_probe(
    args: argparse.Namespace,
    settings: ProbeSettings,
    *,
    transport: httpx2.AsyncBaseTransport | None = None,
) -> ProbeReport:
    if args.confirm_paid_calls and settings.openrouter_api_key is None:
        raise SystemExit("OPENROUTER_API_KEY is not set (env or .env); nothing was called.")
    base = settings.openrouter_base_url.rstrip("/")
    provider = settings.provider
    report = ProbeReport(
        probed_at=dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
        base_url=base,
        provider=provider.as_body(),
        max_run_cost_usd=args.max_run_cost_usd,
    )
    by_id, zdr_ids = await _fetch_catalog(base, transport)

    candidates = list(dict.fromkeys(slug for _, slug in args.assign))
    if args.fallback and args.fallback not in candidates:
        raise SystemExit("--fallback must also be assigned to a tier (e.g. --assign BALANCED=...)")
    worst = 0.0
    for model in candidates:
        if model not in by_id:
            raise SystemExit(f"{model} is not in the live OpenRouter catalog; nothing was called.")
        summary = catalog_summary(by_id[model], zdr_available=model in zdr_ids)
        calls = PAID_CALLS_PER_MODEL + (1 if model == args.fallback else 0)
        cost = worst_case_cost(summary, calls)
        if cost is None:
            raise SystemExit(f"{model} has no parseable catalog price; refusing to call it.")
        worst += cost
        report.models[model] = {
            "catalog": summary,
            "blockers": catalog_blockers(summary, require_zdr=provider.zdr),
        }
    if settings.openrouter_api_key is not None:
        # Free metadata read (no inference): latency/throughput are only shown to a key holder.
        await _record_performance(base, settings.openrouter_api_key, candidates, report, transport)
    report.worst_case_run_cost_usd = round(worst, 6)
    if worst > args.max_run_cost_usd:
        raise SystemExit(
            f"Worst-case probe cost {worst:.6f} USD exceeds --max-run-cost-usd; nothing was called."
        )
    if not args.confirm_paid_calls or settings.openrouter_api_key is None:
        report.checks["dry_run"] = "catalog only; pass --confirm-paid-calls to make the paid calls"
        return report

    timeout = httpx2.Timeout(30.0)
    headers = {"Authorization": f"Bearer {settings.openrouter_api_key.get_secret_value()}"}
    async with (
        httpx2.AsyncClient(base_url=base, timeout=timeout, headers=headers, transport=transport) as http,
        httpx2.AsyncClient(
            base_url=base,
            timeout=timeout,
            headers={"Authorization": "Bearer karen-probe-invalid-key"},
            transport=transport,
        ) as bad,
    ):
        report.checks["key_limits"] = await _key_limits(http)
        report.checks["invalid_key"] = await _raw_complete(bad, candidates[0], provider)
        report.checks["unknown_model"] = await _raw_complete(http, UNKNOWN_MODEL_SLUG, provider)
        if args.fallback:
            report.checks["fallback"] = await _raw_complete(
                http, UNKNOWN_MODEL_SLUG, provider, models=[UNKNOWN_MODEL_SLUG, args.fallback]
            )
        for model in candidates:
            report.models[model]["raw_complete"] = await _raw_complete(http, model, provider)
            report.models[model]["raw_stream"] = await _raw_stream(http, model, provider)

    client = OpenRouterGatewayClient(
        base_url=base,
        api_key=settings.openrouter_api_key,
        timeout_seconds=30,
        max_retries=0,
        provider=provider,
        http_client=httpx2.AsyncClient(transport=transport) if transport else None,
    )
    try:
        for model in candidates:
            report.models[model]["adapter"] = await _client_roundtrip(client, model)
            report.models[model]["passed"] = _verdict(report.models[model])
    finally:
        await client.aclose()
    return report


def _routing_metadata(catalog: dict[str, Any], performance: dict[str, Any], today: str) -> dict[str, Any]:
    """Optional registry fields: only what the catalog/endpoints actually reported."""
    metadata: dict[str, Any] = {
        "quality_index": catalog.get("quality_index"),
        "latency_p50_ms": performance.get("latency_p50_ms"),
        "throughput_p50_tps": performance.get("throughput_p50_tps"),
    }
    present = {k: v for k, v in metadata.items() if v is not None}
    return {**present, "metadata_observed_at": today} if present else {}


def _registry_context(catalog: dict[str, Any]) -> int:
    """Context limit that keeps every request inside the base price band (flat registry prices)."""
    context = int(catalog["context_length"])
    premium = catalog["premium_pricing_from_prompt_tokens"]
    return min(context, premium) if premium else context


def suggested_env(
    assign: list[tuple[RouteTier, str]], routes: list[tuple[TaskRoute, str]]
) -> dict[str, list[str]]:
    """``KAREN_MODEL_*`` names suggested per slug: tier primary/fallback by order, then routes."""
    by_tier: dict[RouteTier, list[str]] = {}
    for tier, slug in assign:
        if slug not in by_tier.setdefault(tier, []):
            by_tier[tier].append(slug)
    result: dict[str, list[str]] = {}
    for tier, slugs in by_tier.items():
        result.setdefault(slugs[0], []).append(f"KAREN_MODEL_{tier}")
        if len(slugs) > 1 and tier in BASE_TEXT_TIERS:
            result.setdefault(slugs[1], []).append(f"KAREN_MODEL_{tier}_FALLBACK")
    for route, slug in routes:
        if slug not in by_tier.get(TASK_ROUTE_TIERS[route], []):
            raise SystemExit(f"--route {route}={slug} must also be assigned to {TASK_ROUTE_TIERS[route]}")
        result.setdefault(slug, []).append(f"KAREN_MODEL_{route}")
    return result


def build_registry(
    report: ProbeReport,
    assign: list[tuple[RouteTier, str]],
    routes: list[tuple[TaskRoute, str]] | None = None,
) -> ModelRegistry:
    """Registry entries from catalog facts; ``verified_at`` only for models that passed live checks."""
    today = report.probed_at[:10]
    suggestions = suggested_env(assign, routes or [])
    tiers: dict[str, list[RouteTier]] = {}
    for tier, slug in assign:
        if tier not in tiers.setdefault(slug, []):
            tiers[slug].append(tier)
    models: list[dict[str, Any]] = []
    for slug, tier_list in tiers.items():
        result = report.models[slug]
        catalog = result["catalog"]
        blockers: list[str] = result.get("blockers", [])
        if not catalog["context_length"] or not catalog["max_completion_tokens"]:
            raise SystemExit(f"{slug}: catalog does not state context/output limits; cannot register it.")
        passed = bool(result.get("passed"))
        params = set(catalog["supported_parameters"])
        stream = result.get("raw_stream", {})
        status = (
            f"SP-1 probe passed {today}; TTFT {stream.get('ttft_ms')} ms from the operator machine"
            if passed
            else f"NOT VERIFIED: SP-1 live probe did not pass on {today}"
            if "raw_complete" in result
            else "NOT VERIFIED: no paid SP-1 probe run yet"
        )
        premium = catalog["premium_pricing_from_prompt_tokens"]
        facts = [
            f"Prices/limits from the OpenRouter catalog on {today}",
            f"zdr_endpoint={catalog['zdr_available']}",
            f"moderated={catalog['is_moderated']}",
            *(["reasoning=mandatory (counts against max_tokens)"] if catalog["reasoning_mandatory"] else []),
            *(
                [f"context capped at {premium} tokens: higher price band above it (catalog overrides)"]
                if premium
                else []
            ),
            *([f"BLOCKERS: {'; '.join(blockers)}"] if blockers else []),
            *([f"Suggested env: {', '.join(suggestions[slug])}"] if slug in suggestions else []),
        ]
        models.append(
            {
                "model_id": slug,
                "tiers": tier_list,
                "supports_streaming": True,
                "supports_tools": "tools" in params,
                "supports_json_schema": "structured_outputs" in params,
                "supports_vision": "image" in catalog["input_modalities"],
                "max_context_tokens": _registry_context(catalog),
                "max_output_tokens": int(catalog["max_completion_tokens"]),
                "input_usd_per_million_tokens": catalog["input_usd_per_million_tokens"],
                "output_usd_per_million_tokens": catalog["output_usd_per_million_tokens"],
                "verified_at": today if passed else None,
                **_routing_metadata(catalog, result.get("performance") or {}, today),
                "notes": (
                    f"{'. '.join(facts)}. {status}. Review upstream data-processing terms before "
                    "enabling for users (architecture §9)."
                ),
            }
        )
    return ModelRegistry.model_validate_json(
        json.dumps({"registry_version": f"{today}.openrouter", "models": models})
    )


def registry_json(registry: ModelRegistry) -> str:
    """Serialise for the contract: optional keys are omitted when unset, never written as null."""
    data = registry.model_dump(mode="json")
    omittable = ModelCapability._omittable
    data["models"] = [
        {k: v for k, v in m.items() if not (k in omittable and v is None)} for m in data["models"]
    ]
    return json.dumps(data, indent=2, ensure_ascii=False) + "\n"


def _slug(value: str) -> str:
    value = value.strip()
    if not re.fullmatch(MODEL_ID_PATTERN, value):
        raise argparse.ArgumentTypeError(f"not a creator/model slug: {value}")
    return value


def _assignment(value: str) -> tuple[RouteTier, str]:
    name, sep, slug = value.partition("=")
    tier = next((t for t in PROBE_TIERS if t == name), None)
    if not sep or tier is None:
        raise argparse.ArgumentTypeError(f"expected {'|'.join(sorted(PROBE_TIERS))}=creator/model")
    return tier, _slug(slug)


def _route(value: str) -> tuple[TaskRoute, str]:
    name, sep, slug = value.partition("=")
    route = next((r for r in TASK_ROUTE_TIERS if r == name), None)
    if not sep or route is None:
        raise argparse.ArgumentTypeError(f"expected {'|'.join(TASK_ROUTE_TIERS)}=creator/model")
    return route, _slug(slug)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="karen-ai-probe", description=__doc__.splitlines()[0])
    parser.add_argument(
        "--assign", type=_assignment, action="append", required=True, help="TIER=creator/model (repeatable)"
    )
    parser.add_argument(
        "--route", type=_route, action="append", default=[], help="TASK_ROUTE=creator/model (repeatable)"
    )
    parser.add_argument("--fallback", type=_slug, default=None, help="assigned slug to test as fallback")
    parser.add_argument("--write-registry", type=Path, default=None, help="write a registry JSON here")
    parser.add_argument("--max-run-cost-usd", type=float, default=0.05)
    parser.add_argument(
        "--confirm-paid-calls", action="store_true", help="without it only the free catalog is read"
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    args = parse_args(argv)
    suggested_env(args.assign, args.route)  # fail fast on an inconsistent --route
    report = asyncio.run(run_probe(args, ProbeSettings()))
    json.dump(report.__dict__, sys.stdout, indent=2, sort_keys=True)
    sys.stdout.write("\n")
    if args.write_registry is not None:
        registry = build_registry(report, args.assign, args.route)
        args.write_registry.write_text(registry_json(registry))
        verified = sum(m.verified_at is not None for m in registry.models)
        sys.stderr.write(f"wrote {args.write_registry} ({verified}/{len(registry.models)} verified)\n")


if __name__ == "__main__":  # pragma: no cover
    main()
