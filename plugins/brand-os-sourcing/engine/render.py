"""Portable evidence report: render facts and hypotheses separately."""

import re
from decimal import Decimal
from urllib.parse import urlencode

from .domain import MIN_MARGIN_PCT
from .market_data import purchase_quote
from .web_research import canonical_url

PRICE_STATUS = {
    "verified": "标价已核",
    "unverified": "标价待核",
    "out_of_range": "标价超出区间",
}
GRADES = {
    "test": "建议测",
    "hold": "缓一缓",
    "drop": "放弃",
    "insufficient": "信息不足",
}
FIELDS = {
    "use_case": "购买任务",
    "rationale": "分档依据",
    "audience": "人群假设",
    "niche": "长尾痛点",
    "lifecycle": "生命周期",
    "competition": "竞争判断",
    "after_sales": "售后风险",
    "resale": "退货二卖",
    "gaps": "数据缺口",
    "next_step": "验证动作",
}


def escape(text):
    return re.sub(r"([\\`*{}_\[\]<>|])", r"\\\1", str(text or "")).replace("\n", " ")


def brief(result):
    counts = {key: sum(c["grade"] == key for c in result["candidates"]) for key in GRADES}
    return (
        f"{result['scene']}：完成 {result['completed_queries']}/6 组搜索，{len(result['sources'])} 个来源，{len(result['candidates'])} 个候选。"
        + "、".join(f"{GRADES[k]} {v}" for k, v in counts.items())
        + "。建议测不等于可以备货；实盘数据待验。"
        + (" 部分来源采集失败，详见报告。" if result["partial"] else "")
    )


def to_markdown(result):
    sources = {s["id"]: s for s in result["sources"]}
    out = [
        f"# 选品报告 · {escape(result['scene'])}",
        "",
        brief(result),
        "",
        f"采集时间：{result['created_at']}",
        "",
        "> 1688 字段来自货源页面。Amazon 销量为 APIClaw 估算。成交价、完整成本和实际毛利须以实盘记录核验。",
        "",
    ]
    if result.get("retail_price_range"):
        p = result["retail_price_range"]
        out += [
            f"目标零售价格带：{p['minimum']}–{p['maximum']} 元（含端点）。",
            "",
            "标价待核的商品保留业务分档。进入实测前，先确认同规格零售标价落在目标区间。",
            "",
        ]
    out += [
        "## 候选对照",
        "",
        "| 商品方向 | 分档 | 零售标价 | 最先验证 |",
        "| --- | --- | --- | --- |",
    ]
    for c in result["candidates"]:
        price_status = c.get("retail_price_status")
        status = PRICE_STATUS.get(price_status, "标价待核")
        action = c["next_step"]
        if price_status == "out_of_range":
            action = "售价超出目标区间"
        elif (
            result.get("retail_price_range")
            and price_status == "unverified"
            and c["grade"] in {"test", "hold"}
        ):
            action = "先核对同规格零售标价"
        out.append(f"| {escape(c['title'])} | {GRADES[c['grade']]} | {status} | {escape(action)} |")
    if not result["candidates"]:
        out += [
            "",
            "未找到满足当前证据与售价条件的候选。可扩大场景或取消售价筛选重新调研；这不等于市场不存在机会。",
        ]
    for c in result["candidates"]:
        out += ["", f"## {escape(c['title'])} · {GRADES[c['grade']]}", ""]
        inquiry = {"product": c["title"]}
        if c.get("id"):
            inquiry["candidate"] = c["id"]
        if c.get("retail_price_status") == "verified" and c.get("retail_price_cny"):
            inquiry["price"] = c["retail_price_cny"]
        out += [f"[去询价](/supplier-rfq?{urlencode(inquiry)})", ""]
        if c.get("grade_reason"):
            out.append(f"- **核验结论**：{escape(c['grade_reason'])}")
        out += [f"- **{label}**：{escape(c.get(key))}" for key, label in FIELDS.items()]
        out += ["", "### 可核对证据", ""]
        if not c["findings"]:
            out.append("暂无正文引文通过核验。")
        for f in c["findings"]:
            s = sources.get(f["source_id"])
            if s and canonical_url(s["url"]):
                out += [
                    f"- {escape(f['fact'])}",
                    f"  > {escape(f['quote'])}",
                    f"  来源：[{escape(s['title'])}](<{s['url']}>) · {s['evidence_level']}",
                    "",
                ]
        out += market_sections(c, result.get("market", {}), sources)
        out += [
            f"拼多多核验词：{' / '.join(escape(x) for x in c['pdd_terms'])}",
            f"1688 询价词：{escape(c['supply_term'])}",
            "",
            "实盘售价、采购、入库物流、发货物流、包装、平台费、投放、赔付、退货损耗、转化率、退款率均待核验。",
        ]
    out += [
        "",
        "## 实盘验证门槛",
        "",
        "单件成本 = 采购 + 入库物流 + 发货物流 + 包装 + 平台费 + 投放 + 赔付 + 退货损耗。",
        "毛利率 =（实盘售价 − 单件成本）÷ 实盘售价 × 100%。使用未四舍五入的值判定：≥30% 通过，<30% 不通过。缺任一成本项不能判定。通过毛利门槛仍须核验竞争、售后、供应质量和交期。",
        "",
        "## 搜索记录",
        "",
    ]
    out += [f"- {escape(q['intent'])}：{escape(q['query'])}" for q in result["queries"]]
    out += ["", "## 来源目录", ""]
    out += [
        f"- [{escape(s['title'])}](<{s['url']}>) · {s['evidence_level']} · ID `{s['id']}`"
        for s in result["sources"]
        if canonical_url(s["url"])
    ]
    if result.get("errors"):
        out += ["", "## 采集缺口", ""] + [
            f"- {escape(e['stage'])}：{escape(e.get('query') or e.get('url'))} · {escape(e['error'])}"
            for e in result["errors"]
        ]
    return "\n".join(out) + "\n"


def market_sections(candidate, market, sources):
    out = ["", "### 货源对照表", ""]
    offers = candidate.get("sourcing_offers", [])
    rows = [offer for offer in offers if offer["evidence_level"] == "structured_record"]
    if rows:
        out += [
            "| 1688 商品 | 供货标价（元） | MOQ | 30 天成交 | 诚信通年限 | 公司 |",
            "| --- | --- | --- | --- | --- | --- |",
        ]
        for offer in rows:
            raw = offer["raw"]
            fields = ("price", "moq", "sold_30d", "credit_years", "company")
            metrics = " | ".join(
                escape(raw[key] if raw[key] is not None else "—") for key in fields
            )
            out.append(f"| [{escape(offer['title'])}](<{offer['url']}>) | {metrics} |")
        out += [
            "",
            "标价、起订量和成交字段按采集时的页面记录展示。下单前须确认规格、数量和到手价。",
        ]
    else:
        out.append("未取得结构化货源报价。")

    if market.get("apiclaw_enabled"):
        out += ["", "### 竞品数据", ""]
        if competitors := candidate.get("competitors"):
            out += [
                "美国 Amazon · APIClaw 关键词样本。月销量为 APIClaw 估算下限。",
                "",
                "| Amazon 商品 | ASIN | BSR | 月销量估算下限 | 评分 |",
                "| --- | --- | --- | --- | --- |",
            ]
            for competitor in competitors:
                raw = competitor["raw"]
                metrics = " | ".join(
                    escape(raw[key] if raw[key] is not None else "—")
                    for key in (
                        "asin",
                        "bsr",
                        "estimated_monthly_sales_min",
                        "rating",
                    )
                )
                out.append(
                    f"| [{escape(competitor['title'])}](<{competitor['url']}>) | {metrics} |"
                )
        else:
            out.append("本候选暂无竞品样本。")

    out += ["", "### 待核线索", ""]
    leads = candidate.get("unverified_leads", [])
    indexed = [offer for offer in offers if offer["evidence_level"] == "search_snippet"]
    if not (leads or indexed):
        out.append("暂无待核线索。")
    for lead in leads:
        source = sources.get(lead["source_id"])
        link = (
            f" · [核对来源](<{source['url']}>)" if source and canonical_url(source["url"]) else ""
        )
        out.append(f"- {escape(lead['fact'])}{link}")
    for offer in indexed:
        out.append(
            f"- [1688 商品索引：{escape(offer['title'])}](<{offer['url']}>) · 货源字段待核。"
        )

    out += ["", "### 实盘门槛", ""]
    prices = [(offer, purchase_quote(offer)) for offer in rows]
    price = candidate.get("retail_price_cny")
    compatible = [(offer, amount) for offer, amount in prices if amount is not None]
    if compatible and price is not None:
        out.append("以下预算使用公开零售标价与供应商标价，须核对两者的规格与起订条件。")
        out.append("")
        for offer, amount in compatible:
            available = Decimal(price) * (100 - MIN_MARGIN_PCT) / 100 - amount
            out.append(
                f"- [供货 {offer['raw']['offer_id']}](<{offer['url']}>) 采购标价 {amount} 元。"
                f"达到 30% 毛利时，其他七项单件成本最多可用 {available:.2f} 元。"
                if available >= 0
                else f"- [供货 {offer['raw']['offer_id']}](<{offer['url']}>) 采购标价 {amount} 元，已超出该零售标价下的总成本上限。"
            )
    else:
        out.append("采购成本测算待核，须取得明确的零售标价、货源单价和起订条件。")
    out.append("")
    return out
