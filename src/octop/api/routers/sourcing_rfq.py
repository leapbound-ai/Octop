"""Supplier inquiries and quote history."""

import json
from typing import TYPE_CHECKING, Annotated, Any, Self
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, StringConstraints, field_validator, model_validator
from starlette.concurrency import run_in_threadpool

from octop.api.deps import current_user, get_server
from octop.infra.db.services import SharedServices
from octop.infra.errors import OctopError
from octop.infra.sourcing.rfq import (
    Category,
    ParseUnavailable,
    Question,
    Term,
    TermStatus,
    parse_reply,
    questions_for,
    supplier_key,
)
from octop.infra.text_assist import require_host_models
from octop.infra.users.identity import User
from octop.infra.utils.locale import resolve_request_locale

if TYPE_CHECKING:
    from octop.infra.server import OctopServer

router = APIRouter()
CurrentUser = Annotated[User, Depends(current_user)]
Server = Annotated["OctopServer", Depends(get_server)]
Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]
Price = Annotated[str, StringConstraints(pattern=r"^[0-9]{1,8}(\.[0-9]{1,2})?$")]


def services_for(server: Server) -> SharedServices:
    if server.services is None:
        raise HTTPException(status_code=503)
    return server.services


Services = Annotated[SharedServices, Depends(services_for)]


class InquiryInput(BaseModel):
    title: Title
    candidate_id: str = Field(default="", max_length=240)
    plan_price: Price | None = None
    monthly_qty: int | None = Field(default=None, ge=1, le=100_000_000)
    categories: list[Category] = Field(default_factory=list, max_length=3)

    @field_validator("categories")
    @classmethod
    def unique_categories(cls, value: list[Category]) -> list[Category]:
        return list(dict.fromkeys(value))


class InquirySummary(InquiryInput):
    rfq_id: str
    archived: bool
    supplier_count: int
    parsed_count: int
    created_at: int
    updated_at: int


class ArchiveInput(BaseModel):
    archived: bool


class Supplier(BaseModel):
    supplier_id: str
    name: str
    shop_url: str
    last_contact: int | None
    version_count: int


class ReplyInput(BaseModel):
    supplier_id: str | None = Field(default=None, max_length=26)
    name: Title | None = None
    shop_url: str = Field(default="", max_length=500)
    raw_text: str = Field(min_length=1, max_length=16000)

    @field_validator("raw_text")
    @classmethod
    def require_content(cls, raw: str) -> str:
        if not raw.strip() or "\x00" in raw:
            raise ValueError("invalid reply text")
        return raw

    @field_validator("shop_url")
    @classmethod
    def validate_shop_url(cls, value: str) -> str:
        value = value.strip()
        if value:
            url = urlsplit(value)
            host = url.hostname or ""
            if (
                url.scheme != "https"
                or url.username
                or url.password
                or not (host == "1688.com" or host.endswith(".1688.com"))
            ):
                raise ValueError("expected an HTTPS 1688 link")
        return value


class ReviewedTerm(Term):
    manual: bool = False


class TermReview(BaseModel):
    status: TermStatus
    value: (
        Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=400)]
        | None
    ) = None

    @model_validator(mode="after")
    def require_confirmed_value(self) -> Self:
        if (self.status == "found") != (self.value is not None):
            raise ValueError("only confirmed terms require a value")
        if self.value and "\x00" in self.value:
            raise ValueError("invalid term value")
        return self


class TermReviewInput(BaseModel):
    review: TermReview | None


class Reply(BaseModel):
    reply_id: str
    rfq_id: str
    supplier_id: str
    supplier_name: str
    product_title: str
    candidate_id: str
    raw_text: str
    terms: list[ReviewedTerm] | None
    created_at: int
    parsed_at: int | None

    @classmethod
    def from_row(cls, row: dict[str, Any]) -> Self:
        terms = row["terms"]
        manual = row["manual_terms"]
        if terms is None or not manual:
            return cls.model_validate(row)
        terms = [
            {**term, **manual[term["id"]], "manual": True} if term["id"] in manual else term
            for term in terms
        ]
        return cls.model_validate({**row, "terms": terms})


class Inquiry(InquirySummary):
    questions: list[Question]
    replies: list[Reply]


@router.get("/rfqs", summary="List your supplier inquiries")
def list_rfqs(user: CurrentUser, services: Services) -> list[InquirySummary]:
    return [
        InquirySummary.model_validate(row) for row in services.sourcing_rfq_repo.list_rfqs(user.id)
    ]


@router.get("/rfqs/{rfq_id}", summary="Read an inquiry and its latest supplier replies")
def get_rfq(rfq_id: str, user: CurrentUser, services: Services) -> Inquiry:
    row = services.sourcing_rfq_repo.get_rfq(user.id, rfq_id)
    if row is None:
        raise HTTPException(status_code=404)
    replies = [Reply.from_row(reply) for reply in row["replies"]]
    return Inquiry.model_validate({**row, "replies": replies})


@router.post("/rfqs", status_code=201, summary="Start an inquiry and generate its checklist")
def create_rfq(
    body: InquiryInput, request: Request, user: CurrentUser, services: Services
) -> Inquiry:
    questions = questions_for(body.categories, resolve_request_locale(request))
    rfq_id = services.sourcing_rfq_repo.create_rfq(
        user.id,
        body.model_dump(),
        json.dumps([q.model_dump() for q in questions], ensure_ascii=False),
    )
    return get_rfq(rfq_id, user, services)


@router.patch("/rfqs/{rfq_id}", summary="Archive or reopen an inquiry")
def set_archived(rfq_id: str, body: ArchiveInput, user: CurrentUser, services: Services) -> Inquiry:
    if not services.sourcing_rfq_repo.set_archived(user.id, rfq_id, body.archived):
        raise HTTPException(status_code=404)
    return get_rfq(rfq_id, user, services)


@router.get("/suppliers", summary="List reusable supplier profiles")
def list_suppliers(user: CurrentUser, services: Services) -> list[Supplier]:
    return [
        Supplier.model_validate(row) for row in services.sourcing_rfq_repo.list_suppliers(user.id)
    ]


@router.get("/suppliers/{supplier_id}/history", summary="List saved supplier conversations")
def supplier_history(supplier_id: str, user: CurrentUser, services: Services) -> list[Reply]:
    rows = services.sourcing_rfq_repo.supplier_history(user.id, supplier_id)
    if rows is None:
        raise HTTPException(status_code=404)
    return [Reply.from_row(row) for row in rows]


@router.post("/rfqs/{rfq_id}/replies", summary="Save the original supplier text")
def save_reply(rfq_id: str, body: ReplyInput, user: CurrentUser, services: Services) -> Reply:
    if body.supplier_id is None and body.name is None:
        raise HTTPException(status_code=422)
    name = body.name or ""
    row = services.sourcing_rfq_repo.save_reply(
        user.id,
        rfq_id,
        body.raw_text,
        body.supplier_id,
        name,
        supplier_key(name),
        body.shop_url,
    )
    if row is None:
        raise HTTPException(status_code=404)
    return Reply.from_row(row)


@router.put("/replies/{reply_id}/terms/{term_id}", summary="Set or restore a manual term review")
def review_term(
    reply_id: str, term_id: str, body: TermReviewInput, user: CurrentUser, services: Services
) -> Reply:
    row = services.sourcing_rfq_repo.review_term(
        user.id, reply_id, term_id, body.review.model_dump() if body.review is not None else None
    )
    if row is None:
        raise HTTPException(status_code=404)
    return Reply.from_row(row)


@router.post("/replies/{reply_id}/parse", summary="Extract and verify terms from a saved reply")
async def extract_reply(
    reply_id: str, user: CurrentUser, services: Services, server: Server
) -> Reply:
    repo = services.sourcing_rfq_repo
    row = await run_in_threadpool(repo.get_reply, user.id, reply_id)
    if row is None:
        raise HTTPException(status_code=404)
    reply = Reply.from_row(row)
    if reply.terms is not None:
        return reply
    inquiry = await run_in_threadpool(get_rfq, reply.rfq_id, user, services)
    if inquiry.archived:
        raise HTTPException(status_code=409)
    try:
        terms = await parse_reply(require_host_models(server), reply.raw_text, inquiry.questions)
    except (OctopError, ParseUnavailable):
        raise HTTPException(status_code=503) from None

    stored = await run_in_threadpool(
        repo.finish_parse,
        user.id,
        reply.rfq_id,
        reply_id,
        json.dumps([term.model_dump() for term in terms], ensure_ascii=False),
    )
    if not stored:
        raise HTTPException(status_code=409)
    row = await run_in_threadpool(repo.get_reply, user.id, reply_id)
    if row is None:
        raise HTTPException(status_code=404)
    return Reply.from_row(row)
