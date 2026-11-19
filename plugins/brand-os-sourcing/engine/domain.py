"""P130 schemas, prompts and evidence gates extracted without web/database dependencies."""

from __future__ import annotations

import json
import logging
import re
import uuid
from decimal import Decimal
from typing import Annotated, Any, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    ValidationError,
    model_validator,
)

from .web_research import Provider
from .web_research import json_call as _json_call

MAX_QUERIES = 6
logger = logging.getLogger(__name__)


class RetailPriceRange(BaseModel):
    minimum: Decimal = Field(ge=0, allow_inf_nan=False)
    maximum: Decimal = Field(gt=0, allow_inf_nan=False)

    @model_validator(mode="after")
    def ordered(self):
        if self.minimum > self.maximum:
            raise ValueError("售价下限不能高于上限")
        return self


Grade = Literal["test", "hold", "drop", "insufficient"]


ShortText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=600)]


Cost = Annotated[Decimal, Field(ge=0, max_digits=12, decimal_places=4)]


QueryText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=128)]


class SearchPlan(BaseModel):
    queries: list[QueryText] = Field(min_length=MAX_QUERIES, max_length=MAX_QUERIES)


class Finding(BaseModel):
    fact: ShortText
    quote: ShortText
    source_id: int = Field(ge=1)


class RetailPriceFinding(BaseModel):
    source_id: int = Field(ge=1)
    quote: ShortText


class CandidateDraft(BaseModel):
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
    use_case: ShortText
    grade: Grade
    findings: list[Finding] = Field(min_length=1, max_length=4)
    retail_price: RetailPriceFinding | None = None
    rationale: ShortText
    audience: ShortText
    niche: ShortText
    lifecycle: ShortText
    next_step: ShortText
    competition: ShortText
    after_sales: ShortText
    resale: ShortText
    gaps: ShortText
    pdd_terms: list[ShortText] = Field(min_length=2, max_length=4)
    supply_term: ShortText
    amazon_term: QueryText | None = None


class Synthesis(BaseModel):
    candidates: list[Any]


class ActualEconomics(BaseModel):
    selling_price: Annotated[Cost, Field(gt=0)]
    purchase: Cost
    inbound: Cost
    outbound: Cost
    packaging: Cost
    platform: Cost
    ads: Cost
    compensation: Cost
    return_loss: Cost
    conversion_pct: Annotated[Cost, Field(le=100)]
    refund_pct: Annotated[Cost, Field(le=100)]
    record: ShortText


COST_FIELDS = (
    "purchase",
    "inbound",
    "outbound",
    "packaging",
    "platform",
    "ads",
    "compensation",
    "return_loss",
)
MIN_MARGIN_PCT = Decimal("30")


def sourcing_margin(actual: ActualEconomics):
    cost = sum(getattr(actual, key) for key in COST_FIELDS)
    return cost, (actual.selling_price - cost) / actual.selling_price * 100


class Review(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    grade: Grade
    confirmed: bool
    shortlisted: bool
    note: str = Field(default="", max_length=2000)
    pdd_observation: str = Field(default="", max_length=4000)
    supplier_observation: str = Field(default="", max_length=4000)
    actual: ActualEconomics | None = None


async def _search_terms(
    provider: Provider,
    scene: str | None,
    retail_price_range: RetailPriceRange | None = None,
) -> list[str]:
    instructions = """
为自备库存、通常从1688进货的拼多多小卖家设计广度调研。以目标人群、使用场景或痛点为起点。
先提炼使用者要完成的任务或想解决的困难，再从不同机制、形态和用途探索独立商品。
输入里若出现具体商品名，将它视为理解需求的例子，围绕背后的使用任务搜索其他解决方式。
若 scene 为 null，主动探索多个彼此不同的小众人群和使用场景，优先寻找稳定、具体、有采购可能的需求。把六组搜索覆盖到至少四个不同场景，避免集中在单一品类。
输出一个 JSON 对象，格式为 {"queries":["搜索词一","搜索词二","搜索词三","搜索词四","搜索词五","搜索词六"]}。
按给定顺序各写一条不同、简洁的中文搜索词：商品叫法及形态、人群或场景、稳定痛点、替代用品、产品说明或故障、公开类目。
数组中的每一项必须是搜索词字符串，不要输出标签或子对象。
指定场景时，先想出至少四种不同的购买任务、商品形态或解决方式，再分配搜索角度。多个词不要反复围绕同一款商品换同义词。人群、痛点和类目查询要保留发现新产品的余地。避免登录墙、销量榜依赖和平台专用搜索语法。
"""
    payload: dict[str, Any] = {"scene": scene}
    if retail_price_range is not None:
        payload["retail_price_range_cny"] = retail_price_range.model_dump(mode="json")
        instructions += "\n有售价区间时，部分搜索词应寻找附有明确人民币零售标价的商品页或购买指南。"
    for attempt in range(2):
        try:
            output = await _json_call(provider, instructions, payload, 1500)
            queries = SearchPlan.model_validate(output).queries
            if len({" ".join(query.casefold().split()) for query in queries}) != MAX_QUERIES:
                raise ValueError("搜索词重复")
            return queries
        except ValueError:
            if attempt:
                raise
            instructions += "\n上一次输出格式不符或有重复，请严格返回六条不同的字符串。"
    raise AssertionError("unreachable")


_PRICE_NUMBER = r"(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\.[0-9]{1,2})?"


_RETAIL_PRICE = re.compile(
    rf"(?:[¥￥]|人民币)\s*({_PRICE_NUMBER})(?![0-9.]|,[0-9])|(?<![0-9.,])({_PRICE_NUMBER})\s*元"
)


_PRICE_RANGE = re.compile(rf"{_PRICE_NUMBER}\s*元?\s*[-–—~～至到]\s*[¥￥]?\s*{_PRICE_NUMBER}")


_NON_RETAIL = re.compile(
    r"批发价|供货价|进货价|采购价|起批|定金|运费|满\s*[0-9]+\s*减|[0-9]+(?:\.[0-9]+)?\s*(?:元\s*)?起|(?:估计|预估|约)\s*[¥￥]?\s*[0-9]|优惠券|券面额|美元|港元|港币|台币|日元|新台币|HKD|NT\$|US\$",
    re.I,
)


def _verified_retail_price(quote: str) -> Decimal | None:
    if _PRICE_RANGE.search(quote) or _NON_RETAIL.search(quote):
        return None
    amounts = {
        Decimal((match.group(1) or match.group(2)).replace(",", ""))
        for match in _RETAIL_PRICE.finditer(quote)
    }
    if len(amounts) != 1:
        return None
    amount = amounts.pop()
    return amount if amount > 0 else None


async def _synthesize(
    web_result: dict[str, Any],
    provider: Provider,
    *,
    scene: str | None,
    retail_price_range: RetailPriceRange | None = None,
) -> dict[str, Any]:
    sources = web_result["sources"]
    if not sources:
        return web_result

    refs = dict(enumerate(sources, 1))
    excerpts = {
        index: " ".join(source.get("page_text", source["excerpt"]).split())
        for index, source in refs.items()
        if source["evidence_level"] == "fetched_content"
    }
    model_sources = [
        {
            "id": index,
            "title": source["title"],
            "intent": source.get("intent"),
            "evidence_level": source["evidence_level"],
            "excerpt": source["excerpt"],
        }
        for index, source in refs.items()
    ]
    instructions = """
围绕输入描述的人群、使用场景或痛点，从公开网页发现适合自备库存的拼多多小卖家评估的细分商品。输入中的具体商品仅作理解场景的例子。scene 为 null 时保留各场景中证据较强的方向，覆盖不同人群和用途。
不同采购品类、结构、用途或退货成本的商品分别列为候选。同义词和仅包装不同的同款归并；
即使解决同一大场景，独立可买的单品仍是不同候选，组合款不能代替有独立证据的单品。
覆盖不同查询角度，优先输出证据最直接的 4–8 个，按验证优先级排列。无证据的方向省略。
若已有候选，找还有来源支持的不同单品，省略已有方向；相关性不足可返回空数组。

返回 {"candidates":[{"title":"商品方向","use_case":"具体购买任务",
"grade":"test|hold|drop|insufficient",
"findings":[{"fact":"可在摘录中核对的描述","quote":"从摘录原样复制的一段关键文字","source_id":1}],
"rationale":"分档依据与推断边界","audience":"购买者、使用者及少比价假设",
"niche":"长尾痛点与替代品","lifecycle":"稳定、季节性或迭代快与理由",
"competition":"小店进入机会、竞争风险与待验项","after_sales":"售后或退货风险与待验项",
"resale":"复检、修复或二卖风险与待验项","gaps":"仍待核验的问题",
"next_step":"最先验证的动作与淘汰条件","pdd_terms":["拼多多主词","长尾词"],"supply_term":"1688询价词","amazon_term":"简洁英文商品搜索词"}]}。
source_id 是输入来源的数字 id，quote 不加省略号，不改标点，不拼接非连续文本。
每个方向提供 1–3 个直接出处。除了原文外，其他字段用一两句简洁中文。
若正文有明确人民币零售单价，可给 retail_price 对象（source_id 和连续 quote）。只用真实网页原文。

优先需求具体稳定、功能简单、售后轻、退回可检测修复或二卖且小店可能有空间的方向。
忙碌、高素质、高收入人群仅是待验证假设；寡头旗舰、百亿补贴或万人团集中、高售后、
退货难二卖、供应商资质质量交期售后不可靠、长期品牌建设和频繁迭代属于降档或放弃信号。
卫生和食品接触类二卖须单独核验状态与合规。test=建议测，hold=缓一缓，drop=放弃，
insufficient=信息不足，仅用于判断需求或商品相关性仍缺乏证据的方向。四档按商品的业务证据与风险判断；
未核实零售标价时保留有依据的业务分档，将查同规格零售标价列为待核动作。放弃须有明确依据；网页观察不能推导实盘售价、销量、转化、
退款、投放或毛利，不能给备货结论。
"""
    filters: dict[str, Any] = {}
    if retail_price_range is not None:
        filters["retail_price_range_cny"] = retail_price_range.model_dump(mode="json")
        instructions += """
已设置零售目标价格带，优先发现与之相符的方向。找到可引用价格时另给 retail_price 对象，字段为 source_id 和 quote。
quote 原样引用能够识别候选商品或对应规格与明确人民币零售单价的连续片段，价格只能有一个。
优先区间内商品。对研究相关但区间外的商品也可交付明确价格引文，找不到价格的方向保留并将 retail_price 留空。
估价、批发报价、运费、定金、起售价、券门槛和外币不可作为人民币零售单价。实盘售价仍待核。
"""
    candidates = []
    seen = set()
    for attempt in range(2):
        try:
            output = Synthesis.model_validate(
                await _json_call(
                    provider,
                    instructions,
                    {
                        "scene": scene,
                        "sources": model_sources,
                        **filters,
                        "existing_candidates": [item["title"] for item in candidates],
                    },
                    7000,
                )
            )
        except Exception as exc:
            if not candidates:
                if attempt == 0 and isinstance(exc, (json.JSONDecodeError, ValidationError)):
                    instructions += "\n只返回一个完整 JSON 对象。"
                    continue
                raise
            logger.warning("Breadth supplemental synthesis failed", exc_info=True)
            break
        for item in output.candidates[:12]:
            try:
                candidate = CandidateDraft.model_validate(item)
            except ValidationError:
                continue
            key = "".join(candidate.title.casefold().split())
            if key in seen:
                continue
            findings, leads = [], []
            for finding in candidate.findings:
                source = refs.get(finding.source_id)
                row = {
                    **finding.model_dump(),
                    "source_id": source["id"] if source else None,
                }
                if " ".join(finding.quote.split()) in excerpts.get(finding.source_id, ""):
                    findings.append(row)
                else:
                    leads.append(row)

            has_product_evidence = bool(findings)
            price = candidate.retail_price
            price_status = "unverified"
            amount = None
            grade = candidate.grade
            if price and " ".join(price.quote.split()) in excerpts.get(price.source_id, ""):
                amount = _verified_retail_price(price.quote)
                if amount is not None:
                    price_status = "verified"
                    findings.append(
                        {
                            "fact": f"公开零售标价 {amount} 元（实盘待验）",
                            "quote": price.quote,
                            "source_id": refs[price.source_id]["id"],
                        }
                    )
                    if retail_price_range is not None and not (
                        retail_price_range.minimum <= amount <= retail_price_range.maximum
                    ):
                        price_status = "out_of_range"
            if price_status == "unverified" and price:
                source = refs.get(price.source_id)
                leads.append(
                    {
                        "fact": "零售标价待核",
                        "quote": price.quote,
                        "source_id": source["id"] if source else None,
                    }
                )
            grade_reason = None
            if price_status == "out_of_range":
                grade = "drop"
                grade_reason = "已核实零售标价超出目标区间"
            elif not has_product_evidence:
                grade = "insufficient"
                grade_reason = "缺少通过核验的商品正文引文"
            seen.add(key)
            candidates.append(
                {
                    **candidate.model_dump(exclude={"findings", "retail_price"}),
                    "grade": grade,
                    "grade_reason": grade_reason,
                    "findings": findings,
                    "unverified_leads": leads,
                    "retail_price_status": price_status,
                    "retail_price_cny": str(amount) if amount is not None else None,
                    "id": str(uuid.uuid4()),
                    "review": None,
                }
            )
        if len(candidates) >= 3 or len(sources) < 8:
            break
    return {**web_result, "candidates": candidates[:12]}
