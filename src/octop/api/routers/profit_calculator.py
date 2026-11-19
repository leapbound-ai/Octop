"""Account-scoped storage for the dashboard's profit calculator."""

import json
from typing import TYPE_CHECKING, Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from pydantic.alias_generators import to_camel

from octop.api.deps import current_user, get_server
from octop.infra.db.services import SharedServices
from octop.infra.users.identity import User
from octop.infra.utils.ulid import new_ulid

if TYPE_CHECKING:
    from octop.infra.server import OctopServer


router = APIRouter()
CurrentUser = Annotated[User, Depends(current_user)]
Server = Annotated["OctopServer", Depends(get_server)]
FieldName = Annotated[str, StringConstraints(max_length=40)]
InputValue = Annotated[str, StringConstraints(pattern=r"^([0-9]{1,8}(\.[0-9]{1,2})?)?$")]
Version = Annotated[int, Field(ge=1, lt=2**31 - 1)]
PageLimit = Annotated[int, Query(ge=1, le=50)]
SnapshotId = Annotated[str, StringConstraints(pattern=r"^[0-9A-HJKMNP-TV-Z]{26}$")]


def calculator_services(server: Server) -> SharedServices:
    services = server.services
    if services is None:
        raise HTTPException(status_code=503)
    return services


Services = Annotated[SharedServices, Depends(calculator_services)]


class BaselineField(BaseModel):
    value: InputValue
    source: Literal["actual", "public", "seller", "model", "empty"]
    source_note: str = Field(default="", max_length=200)
    updated_at: int = Field(ge=0)


class BaselineInput(BaseModel):
    payload: dict[FieldName, BaselineField] = Field(max_length=16)


class Baseline(BaselineInput):
    version: Version
    created_at: int


class BaselineRestore(BaseModel):
    version: Version


class ResultRow(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel)


class Outcome(ResultRow):
    before: int
    loss: int
    profit: int
    margin: int
    status: Literal["loss", "even", "below", "passed"]


class CostRow(ResultRow):
    key: Literal[
        "purchase",
        "inbound",
        "outbound",
        "packaging",
        "platform",
        "ad",
        "insurance",
        "reserve",
        "refundLoss",
    ]
    amount: int
    cost_share: int
    sale_share: int


class LimitRow(ResultRow):
    key: Literal["outbound", "ad", "adShare", "unitPrice", "refund"]
    current: int
    upper: int | None
    state: Literal["ok", "edge", "over"]


class PriceRow(Outcome):
    key: Literal["lower", "current", "higher", "goal"]
    price: int


class RefundRow(Outcome):
    key: Literal["conservative", "base", "optimistic"]
    rate: int


class ProfitResults(ResultRow):
    outcome: Outcome
    total_cost: int
    break_even: int | None
    target_price: int | None
    monthly_orders: Annotated[str, StringConstraints(pattern=r"^[0-9]{1,28}$")] | None
    costs: list[CostRow] = Field(max_length=9)
    limits: list[LimitRow] = Field(max_length=5)
    prices: list[PriceRow] = Field(max_length=4)
    refunds: list[RefundRow] = Field(max_length=3)


class SnapshotInput(BaseModel):
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
    inputs: dict[FieldName, InputValue] = Field(max_length=16)
    results: ProfitResults = Field(description="Frozen amounts in cents and rates in basis points.")
    engine_version: Literal["pdd-profit-1"]
    baseline_version: Version | None = None


class SnapshotSummary(BaseModel):
    snapshot_id: SnapshotId
    title: str
    engine_version: Literal["pdd-profit-1"]
    baseline_version: Version | None
    created_at: int


class Snapshot(SnapshotInput, SnapshotSummary):
    pass


@router.get("/baseline", summary="Get current calculator defaults")
def get_baseline(user: CurrentUser, services: Services) -> Baseline | None:
    rows = services.profit_calculator_repo.list_baselines(user.id, 1)
    return Baseline.model_validate(rows[0]) if rows else None


@router.put("/baseline", summary="Save a new version of calculator defaults")
def save_baseline(body: BaselineInput, user: CurrentUser, services: Services) -> Baseline:
    row = services.profit_calculator_repo.save_baseline(
        user.id, json.dumps(body.model_dump(mode="json")["payload"], ensure_ascii=False)
    )
    return Baseline.model_validate(row)


@router.get("/baseline/history", summary="List versions of calculator defaults")
def list_baselines(
    user: CurrentUser,
    services: Services,
    limit: PageLimit = 20,
    before: Version | None = None,
) -> list[Baseline]:
    rows = services.profit_calculator_repo.list_baselines(user.id, limit, before)
    return [Baseline.model_validate(row) for row in rows]


@router.post(
    "/baseline/rollback",
    summary="Restore a previous defaults version",
    description="Copies the selected values into a new current version and preserves the history.",
)
def restore_baseline(body: BaselineRestore, user: CurrentUser, services: Services) -> Baseline:
    row = services.profit_calculator_repo.save_baseline(user.id, restore=body.version)
    if row is None:
        raise HTTPException(status_code=404)
    return Baseline.model_validate(row)


@router.post("/snapshots", status_code=201, summary="Save a calculator scenario")
def create_snapshot(body: SnapshotInput, user: CurrentUser, services: Services) -> Snapshot:
    row = services.profit_calculator_repo.create_snapshot(
        user.id,
        new_ulid(),
        body.title,
        json.dumps(body.inputs),
        body.results.model_dump_json(by_alias=True),
        body.engine_version,
        body.baseline_version,
    )
    return Snapshot.model_validate(row)


@router.get("/snapshots", summary="List your saved calculator scenarios")
def list_snapshots(
    user: CurrentUser,
    services: Services,
    limit: PageLimit = 20,
    before: SnapshotId | None = None,
) -> list[SnapshotSummary]:
    rows = services.profit_calculator_repo.list_snapshots(user.id, limit, before)
    return [SnapshotSummary.model_validate(row) for row in rows]


@router.get("/snapshots/{snapshot_id}", summary="Read a frozen scenario result")
def get_snapshot(snapshot_id: SnapshotId, user: CurrentUser, services: Services) -> Snapshot:
    row = services.profit_calculator_repo.get_snapshot(user.id, snapshot_id)
    if row is None:
        raise HTTPException(status_code=404)
    return Snapshot.model_validate(row)


@router.delete("/snapshots/{snapshot_id}", status_code=204, summary="Delete a saved scenario")
def delete_snapshot(snapshot_id: SnapshotId, user: CurrentUser, services: Services) -> None:
    if not services.profit_calculator_repo.delete_snapshot(user.id, snapshot_id):
        raise HTTPException(status_code=404)
