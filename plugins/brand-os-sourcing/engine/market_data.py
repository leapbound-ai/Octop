"""Catalog adapters based on the published SkillHub data interfaces."""

import asyncio
import html
import json
import os
import re
from datetime import UTC, datetime
from decimal import Decimal

import httpx

from .web_research import canonical_url

OFFER_ID = re.compile(r"[0-9]{5,20}")
OFFER_URL = re.compile(r"https://detail\.1688\.com/offer/([0-9]{5,20})\.html(?:\?.*)?")
ASIN = re.compile(r"[A-Z0-9]{10}")
SUPPLIER_ENDPOINTS = (
    "https://s.1688.com/youzhan/search/searchOffer.json",
    "https://search.1688.com/service/json.htm",
    "https://s.1688.com/selloffer/offer_search.htm",
)
COMPETITOR_ENDPOINT = "https://api.apiclaw.io/openapi/v2/products/competitor-lookup"


def records(value):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from records(child)
    elif isinstance(value, list):
        for child in value:
            yield from records(child)


def scalar(value):
    if type(value) in (str, int, float):
        value = html.unescape(re.sub(r"<[^>]+>", "", str(value))).strip()[:240]
        if value:
            return value
    return None


def first(row, *keys):
    return next((row[key] for key in keys if row.get(key) is not None), None)


def evidence(source, key, url, title, query, raw, level="structured_record"):
    return {
        "id": f"{source}:{key}",
        "source_type": source,
        "evidence_level": level,
        "url": url,
        "title": title,
        "query": query,
        "collected_at": datetime.now(UTC).isoformat(),
        "raw": raw,
    }


def supplier_documents(text):
    try:
        yield json.loads(text)
        return
    except ValueError:
        pass
    decoder = json.JSONDecoder()
    for match in re.finditer(
        r'window\.__INIT_STATE__\s*=\s*|var\s+offerList\s*=\s*|"(?:moduleList|resultList)"\s*:\s*',
        text,
    ):
        try:
            yield decoder.raw_decode(text, match.end())[0]
        except ValueError:
            continue


def supplier_rows(text, query, limit=3):
    rows = {}
    for document in supplier_documents(text):
        for item in records(document):
            key = scalar(first(item, "offerId", "productId", "id", "itemId"))
            title = scalar(first(item, "title", "subject"))
            price = scalar(first(item, "price", "unitPrice"))
            if not (key and OFFER_ID.fullmatch(key) and title and price):
                continue
            rows.setdefault(
                key,
                evidence(
                    "1688",
                    key,
                    f"https://detail.1688.com/offer/{key}.html",
                    title,
                    query,
                    {
                        "offer_id": key,
                        "price": price,
                        "moq": scalar(first(item, "最小起订量", "minOrder")),
                        "sold_30d": scalar(item.get("soldCount30")),
                        "credit_years": scalar(item.get("creditYear")),
                        "company": scalar(first(item, "companyName", "company")),
                    },
                ),
            )
            if len(rows) >= limit:
                return list(rows.values())
    return list(rows.values())


async def supplier_search(client, query, limit=3):
    statuses = []
    async with asyncio.timeout(16):
        for endpoint in SUPPLIER_ENDPOINTS:
            try:
                response = await client.get(
                    endpoint,
                    params={"keywords": query, "beginPage": 1, "pageSize": 20},
                    headers={"Accept-Language": "zh-CN"},
                    follow_redirects=False,
                    timeout=4.5,
                )
                if not response.is_success:
                    statuses.append(f"HTTP {response.status_code}")
                    continue
                if len(response.content) > 5 * 1024 * 1024:
                    statuses.append("响应过大")
                    continue
                text = response.text
                if "\ufffd" in text:
                    text = response.content.decode("gb18030", errors="replace")
                if rows := supplier_rows(text, query, limit):
                    return rows, None
                statuses.append(
                    "页面要求人机验证" if "captcha" in text.lower() else "未返回可解析的货源"
                )
            except httpx.HTTPError:
                statuses.append("请求失败")
    return [], " / ".join(dict.fromkeys(statuses))


async def indexed_suppliers(provider, query):
    body = await provider.search(f"{query} site:detail.1688.com", query)
    rows = {}
    for item in body.get("results") or body.get("items") or []:
        if not isinstance(item, dict):
            continue
        url = canonical_url(item.get("url") or item.get("link") or item.get("href"))
        match = OFFER_URL.fullmatch(url)
        if match and (title := scalar(item.get("title"))):
            key = match[1]
            rows.setdefault(
                key,
                evidence(
                    "1688",
                    key,
                    f"https://detail.1688.com/offer/{key}.html",
                    title,
                    query,
                    {"offer_id": key},
                    "search_snippet",
                ),
            )
        if len(rows) >= 3:
            break
    return list(rows.values())


def purchase_quote(offer, quantity=None):
    if offer["evidence_level"] != "structured_record":
        return None
    raw = offer["raw"]
    price = re.fullmatch(
        r"(?:[¥￥]\s*)?([0-9]{1,8}(?:\.[0-9]{1,4})?)(?:\s*元(?:/件)?)?", raw["price"] or ""
    )
    moq = re.fullmatch(r"([1-9][0-9]{0,8})(?:\s*件)?", raw["moq"] or "")
    if not price or not moq or (quantity is not None and quantity < int(moq[1])):
        return None
    amount = Decimal(price[1])
    return amount if amount > 0 else None


async def competitor_search(client, query, api_key):
    response = await client.post(
        COMPETITOR_ENDPOINT,
        headers={"Authorization": f"Bearer {api_key}"},
        json={
            "keyword": query,
            "pageSize": 3,
            "sortBy": "atLeastMonthlySales",
            "sortOrder": "desc",
        },
        follow_redirects=False,
        timeout=10,
    )
    if not response.is_success:
        return [], f"HTTP {response.status_code}"
    body = response.json()
    if not isinstance(body, dict) or body.get("success") is not True:
        return [], "接口未返回成功状态"
    rows = {}
    for item in records(body.get("data")):
        key = scalar(item.get("asin"))
        title = scalar(first(item, "title", "productTitle"))
        if key and ASIN.fullmatch(key) and title:
            rows.setdefault(
                key,
                evidence(
                    "apiclaw",
                    key,
                    f"https://www.amazon.com/dp/{key}",
                    title,
                    query,
                    {
                        "asin": key,
                        "market": "US",
                        "bsr": scalar(first(item, "bsrRank", "bsr", "bigCategoryBsr")),
                        "estimated_monthly_sales_min": scalar(item.get("atLeastMonthlySales")),
                        "rating": scalar(first(item, "rating", "ratingAmt")),
                    },
                ),
            )
        if len(rows) >= 3:
            break
    return list(rows.values()), None if rows else "未返回带 ASIN 的竞品"


async def enrich(client, provider, candidates):
    api_key = os.getenv("APICLAW_API_KEY", "").strip()
    slots = asyncio.Semaphore(6)

    async def bounded(call, *args):
        async with slots:
            try:
                async with asyncio.timeout(20):
                    return await call(*args)
            except (httpx.HTTPError, ValueError, RuntimeError, TimeoutError, RecursionError):
                return [], "采集失败或超时"

    async def supply(query):
        rows, error = await bounded(supplier_search, client, query)
        if not rows:
            links, _ = await bounded(indexed, provider, query)
            return links, error
        return rows, error

    async def indexed(provider, query):
        return await indexed_suppliers(provider, query), None

    queries = dict.fromkeys(c["supply_term"] for c in candidates)
    competitor_terms = dict.fromkeys(c["amazon_term"] for c in candidates if c.get("amazon_term"))
    async with asyncio.TaskGroup() as group:
        offers = {q: group.create_task(supply(q)) for q in queries}
        competitors = {
            q: group.create_task(bounded(competitor_search, client, q, api_key))
            for q in competitor_terms
            if api_key
        }

        tasks = [*offers.values(), *competitors.values()]
        if tasks:
            _, pending = await asyncio.wait(tasks, timeout=42)
            for task in pending:
                task.cancel()

    def read(task):
        return ([], "采集超时") if task.cancelled() else task.result()

    errors = []
    for source, tasks in (("1688", offers), ("apiclaw", competitors)):
        for query, task in tasks.items():
            _, error = read(task)
            if error:
                errors.append({"stage": source, "query": query, "error": error})
    for candidate in candidates:
        candidate["sourcing_offers"] = read(offers[candidate["supply_term"]])[0]
        task = competitors.get(candidate.get("amazon_term"))
        if api_key:
            candidate["competitors"] = read(task)[0] if task else []
    return {"apiclaw_enabled": bool(api_key)}, errors
