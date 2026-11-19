"""Deterministic plan → search → fetch → screen → save pipeline (P130)."""

import asyncio
from datetime import UTC, datetime

import httpx

from .domain import RetailPriceRange, _search_terms, _synthesize
from .market_data import enrich
from .web_research import INTENTS, Provider, collect


async def run(scene="", price_min=None, price_max=None, *, provider=None, on_progress=None):
    if len(scene) > 600:
        raise ValueError("场景请控制在 600 字以内")
    if (price_min is None) != (price_max is None):
        raise ValueError("售价上下限须同时填写，或同时留空")
    limits = (
        RetailPriceRange(minimum=price_min, maximum=price_max) if price_min is not None else None
    )

    async def progress(stage, done=0, total=0):
        if on_progress:
            await on_progress(stage, done, total)

    async with httpx.AsyncClient() as client, asyncio.timeout(420):
        provider = provider or Provider(client)
        await progress("plan")
        terms = await _search_terms(provider, scene.strip() or None, limits)
        queries = [
            {"intent": intent, "query": query} for intent, query in zip(INTENTS, terms, strict=True)
        ]
        collected = await collect(provider, queries, scene, progress)
        await progress("screen")
        result = await _synthesize(
            collected, provider, scene=scene.strip() or None, retail_price_range=limits
        )
        for source in result["sources"]:
            source.pop("page_text", None)
        await progress("market")
        market, errors = await enrich(client, provider, result["candidates"])
        await progress("save")
        return {
            **result,
            "market": market,
            "errors": [*result["errors"], *errors],
            "partial": result["partial"] or bool(errors),
            "scene": scene.strip() or "开放场景探索",
            "created_at": datetime.now(UTC).isoformat(),
            "retail_price_range": limits.model_dump(mode="json") if limits else None,
        }
