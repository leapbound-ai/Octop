"""Brand OS sourcing plugin. Artifacts use the host write_file tool."""

import json
import re
import uuid
from decimal import Decimal

import httpx
from octop_harness.plugins import PluginContext

from .engine import pipeline, render
from .engine.domain import MIN_MARGIN_PCT, ActualEconomics, sourcing_margin
from .engine.market_data import OFFER_ID, purchase_quote, supplier_search


async def run_breadth_research(
    scene: str = "", price_min: float | None = None, price_max: float | None = None
) -> str:
    """Discover sourced product candidates; then write report_markdown verbatim to filename with write_file."""
    try:
        result = await pipeline.run(scene, price_min, price_max)
    except (ValueError, RuntimeError, TimeoutError, httpx.HTTPError) as exc:
        message = (
            str(exc)
            if isinstance(exc, (ValueError, RuntimeError))
            else "调研超时或网络请求失败，请稍后重试。"
        )
        return json.dumps(
            {"status": "failed", "error": message[:500], "text": message[:500]},
            ensure_ascii=False,
        )
    slug = re.sub(r"[^\w\-\u4e00-\u9fff]", "-", result["scene"])[:45]
    filename = f"outbound/选品报告-{slug}-{uuid.uuid4().hex[:8]}.md"
    markdown = render.to_markdown(result)
    summary = render.brief(result)
    return json.dumps(
        {
            "status": "completed",
            "filename": filename,
            "report_markdown": markdown,
            "summary": summary,
            "octop_ui": {"renderer": "sourcing_report", "version": 1},
            "data": {**result, "filename": filename, "report_markdown": markdown},
            "text": summary,
        },
        ensure_ascii=False,
    )


async def check_sourcing_margin(
    actual_json: str,
    supplier_offer_id: str = "",
    supplier_query: str = "",
    order_quantity: int | None = None,
) -> str:
    """Verify actual unit economics or estimate them with a user-selected live quote."""
    actual_fields = json.loads(actual_json)
    if not isinstance(actual_fields, dict):
        raise ValueError("成本记录必须是 JSON 对象")
    quote = None
    if supplier_offer_id or supplier_query or order_quantity is not None:
        if (
            not OFFER_ID.fullmatch(supplier_offer_id)
            or not 0 < len(supplier_query.strip()) <= 128
            or order_quantity is None
            or order_quantity < 1
            or "purchase" in actual_fields
        ):
            raise ValueError("报价测算须提供已确认的 1688 商品 ID、询价词和数量，并省略 purchase")
        actual = ActualEconomics.model_validate({**actual_fields, "purchase": 0})
        try:
            async with httpx.AsyncClient() as client:
                offers, _ = await supplier_search(client, supplier_query.strip(), limit=20)
        except (TimeoutError, httpx.HTTPError):
            offers = []
        quote = next(
            (offer for offer in offers if offer["raw"]["offer_id"] == supplier_offer_id), None
        )
        purchase = purchase_quote(quote, order_quantity) if quote else None
        if purchase is None:
            return json.dumps(
                {
                    "status": "unverified",
                    "passes": None,
                    "note": "未取得该货源适用的明确单价和起订量。请核对规格与价格后填写实际采购记录。",
                },
                ensure_ascii=False,
            )
        actual = actual.model_copy(update={"purchase": purchase})
    else:
        actual = ActualEconomics.model_validate(actual_fields)
    cost, pct = sourcing_margin(actual)
    return json.dumps(
        {
            "unit_cost": str(cost),
            "margin_pct": str(pct.quantize(Decimal("0.01"))),
            "passes": pct >= MIN_MARGIN_PCT if quote is None else None,
            "record": actual.record,
            **(
                {
                    "status": "quote_estimate",
                    "estimate_passes": pct >= MIN_MARGIN_PCT,
                    "purchase_cny": str(actual.purchase),
                    "supplier_offer": quote,
                }
                if quote
                else {}
            ),
            "note": "1688 公示报价测算，实盘毛利待验"
            if quote
            else "仅核验毛利门槛，备货须另行评估",
        },
        ensure_ascii=False,
    )


def setup(ctx: PluginContext) -> None:
    ctx.tool(
        "run_breadth_research",
        run_breadth_research,
        description="从场景、人群、痛点做六组公开网页选品调研并采集货源，返回四档候选、证据、待核线索和报告。完成后必须用 write_file 将顶层 report_markdown 原样写入 filename，再向用户给出 summary。可选售价区间须同时提供上下限；最长约七分钟。",
    )
    ctx.tool(
        "check_sourcing_margin",
        check_sourcing_margin,
        description="核验真实成本记录是否达到 30% 毛利门槛。actual_json 含 selling_price、purchase、inbound、outbound、packaging、platform、ads、compensation、return_loss、conversion_pct、refund_pct、record。用户需要报价测算并确认 1688 商品、询价词和数量时，可省略 purchase，传 supplier_offer_id、supplier_query 和 order_quantity，用公示报价自动测算。其余字段须来自用户记录。",
    )
