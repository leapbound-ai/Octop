"""Search and manage artifacts owned by the signed-in user."""

from datetime import datetime, timedelta
from typing import Annotated, Any, Literal
from uuid import NAMESPACE_URL, uuid5
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, StringConstraints
from starlette.concurrency import run_in_threadpool

from octop.api.common.agent import require_agent_row
from octop.api.common.workspace import require_agent_workspace
from octop.api.deps import current_user, get_server
from octop.infra.agents.threads.artifact_context import SNAPSHOT_LIMIT, TEXT_KINDS, draft_context
from octop.infra.errors import ErrorCode, OctopError
from octop.infra.gateway.threads import ThreadRegistry

router = APIRouter()
CollectMode = Literal["documents", "all"]
Status = Literal["active", "archived", "ignored"]
Tag = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]


class ArtifactSummary(BaseModel):
    artifact_id: str
    agent_id: str
    thread_id: str
    path: str
    title: str
    kind: str
    mime_kind: str
    summary: str
    schema_version: int
    tags: list[str]
    status: Status
    source: str
    pinned: bool = False
    created_at: int
    updated_at: int


class ArtifactDetail(ArtifactSummary):
    payload: dict[str, Any]
    parent_id: str
    parent_version: int | None
    refs: list[str]


class ArtifactVersionInfo(BaseModel):
    artifact_id: str
    revision: int
    content_type: Literal["text", "json"]
    truncated: bool
    created_at: int


class ArtifactVersion(ArtifactVersionInfo):
    content: str


class ArtifactDeriveRequest(BaseModel):
    request_id: Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{32}$")]
    focus: str = Field(default="", max_length=1000)
    revision: int | None = Field(default=None, ge=1)
    agent_id: str | None = Field(default=None, max_length=128)


class ArtifactContext(BaseModel):
    artifact_id: str
    title: str
    summary: str
    excerpt: str
    truncated: bool
    revision: int | None


class ArtifactDerivedThread(BaseModel):
    agent_id: str
    thread_id: str
    context: ArtifactContext


class ArtifactList(BaseModel):
    items: list[ArtifactSummary]
    total: int


class ArtifactPatch(BaseModel):
    title: (
        Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)]
        | None
    ) = None
    summary: str | None = Field(default=None, max_length=4000)
    tags: list[Tag] | None = Field(default=None, max_length=30)


class ArtifactSettings(BaseModel):
    collect_mode: CollectMode


class ArtifactStatus(BaseModel):
    status: Status


class ArtifactAgent(BaseModel):
    agent_id: str
    name: str


class ArtifactStats(BaseModel):
    total: int
    this_week: int
    agents: int


class ArtifactReviewPatch(BaseModel):
    rating: int | None = Field(default=None, ge=0, le=5)
    decision: Literal["pending", "adopted", "rejected"] | None = None
    use_for_preferences: bool | None = None


class ArtifactReview(BaseModel):
    artifact_id: str
    rating: int
    decision: Literal["pending", "adopted", "rejected"]
    use_for_preferences: bool
    revision: int | None
    updated_at: int | None


class ArtifactCommentBody(BaseModel):
    comment_id: Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{32}$")]
    content: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]


class ArtifactComment(BaseModel):
    comment_id: str
    content: str
    revision: int | None
    created_at: int


class ArtifactComments(BaseModel):
    items: list[ArtifactComment]


class ArtifactThread(BaseModel):
    agent_id: str
    thread_id: str


@router.get("", summary="List artifacts", response_model=ArtifactList)
def list_artifacts(
    agent_id: str | None = None,
    kind: str | None = None,
    board_id: str | None = None,
    tag: str | None = Query(default=None, max_length=80),
    q: str | None = Query(default=None, max_length=300),
    status: Status = "active",
    since: int | None = Query(default=None, alias="from"),
    until: int | None = Query(default=None, alias="to"),
    sort: Literal["newest", "oldest"] = "newest",
    page: int = Query(default=1, ge=1, le=1000000),
    page_size: int = Query(default=24, ge=1, le=100),
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    return server.services.artifact_repo.list_for_user(  # type: ignore[no-any-return]
        user.id,
        status=status,
        board_id=board_id,
        agent_id=agent_id,
        kind=kind,
        tag=tag,
        query=q,
        since=since,
        until=until,
        newest_first=sort == "newest",
        page=page,
        page_size=page_size,
    )


@router.get("/agents", summary="List artifact producers", response_model=list[ArtifactAgent])
def list_agents(
    user: Any = Depends(current_user), server: Any = Depends(get_server)
) -> list[dict[str, str]]:
    return server.services.artifact_repo.agents(user.id)  # type: ignore[no-any-return]


@router.get("/stats", summary="Count active artifacts", response_model=ArtifactStats)
def get_stats(
    user: Any = Depends(current_user), server: Any = Depends(get_server)
) -> dict[str, int]:
    now = datetime.now(ZoneInfo(server.services.config.default_timezone))
    monday = (now - timedelta(days=now.weekday())).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    return server.services.artifact_repo.stats(user.id, int(monday.timestamp()))  # type: ignore[no-any-return]


def _require(row: dict[str, Any] | None) -> dict[str, Any]:
    if row is None:
        raise OctopError(ErrorCode.NOT_FOUND, "artifact not found")
    return row


@router.get(
    "/{artifact_id}/review",
    summary="Read the owner's artifact review",
    response_model=ArtifactReview,
)
def get_review(
    artifact_id: str, user: Any = Depends(current_user), server: Any = Depends(get_server)
) -> Any:
    return _require(server.services.artifact_feedback_repo.review(user.id, artifact_id))


@router.patch(
    "/{artifact_id}/review",
    summary="Rate, decide, or exclude feedback from future preferences",
    response_model=ArtifactReview,
)
def update_review(
    artifact_id: str,
    body: ArtifactReviewPatch,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> Any:
    return _require(
        server.services.artifact_feedback_repo.update(user.id, artifact_id, **body.model_dump())
    )


@router.get(
    "/{artifact_id}/comments", summary="Read artifact comments", response_model=ArtifactComments
)
def get_comments(
    artifact_id: str, user: Any = Depends(current_user), server: Any = Depends(get_server)
) -> Any:
    get_artifact(artifact_id, user, server)
    return {"items": server.services.artifact_feedback_repo.comments(user.id, artifact_id)}


@router.post(
    "/{artifact_id}/comments",
    summary="Comment on an artifact",
    response_model=ArtifactComment,
    status_code=201,
)
def add_comment(
    artifact_id: str,
    body: ArtifactCommentBody,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> Any:
    return _require(
        server.services.artifact_feedback_repo.add_comment(
            user.id, artifact_id, body.comment_id, body.content
        )
    )


@router.delete(
    "/{artifact_id}/comments/{comment_id}", summary="Delete an artifact comment", status_code=204
)
def delete_comment(
    artifact_id: str,
    comment_id: str,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> None:
    _require_change(
        server.services.artifact_feedback_repo.delete_comment(user.id, artifact_id, comment_id)
    )


@router.get("/settings", summary="Get artifact collection settings")
def get_settings(
    user: Any = Depends(current_user), server: Any = Depends(get_server)
) -> ArtifactSettings:
    mode = server.services.settings_repo.artifact_collect_mode(user.id)
    return ArtifactSettings(collect_mode="all" if mode == "all" else "documents")


@router.put("/settings", summary="Set artifact collection mode")
def set_settings(
    body: ArtifactSettings, user: Any = Depends(current_user), server: Any = Depends(get_server)
) -> ArtifactSettings:
    server.services.settings_repo.set_artifact_collect_mode(user.id, body.collect_mode)
    return body


class ArtifactBoardName(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]


class ArtifactBoard(ArtifactBoardName):
    board_id: str
    created_at: int
    updated_at: int
    total: int


class ArtifactBoardItem(BaseModel):
    pinned: bool | None = None


class ArtifactReference(BaseModel):
    target_id: Annotated[str, StringConstraints(min_length=1, max_length=128)]


class ArtifactEdge(BaseModel):
    source_id: str
    target_id: str
    kind: Literal["reference", "derivation"]
    source_title: str
    target_title: str
    source_status: Status
    target_status: Status


class ArtifactGraph(BaseModel):
    edges: list[ArtifactEdge]
    truncated: bool


def _require_change(changed: bool) -> None:
    if not changed:
        raise OctopError(ErrorCode.NOT_FOUND, "artifact or board not found")


@router.get("/boards", summary="List private artifact boards", response_model=list[ArtifactBoard])
def list_boards(user: Any = Depends(current_user), server: Any = Depends(get_server)) -> Any:
    return server.services.artifact_board_repo.list(user.id)


@router.post(
    "/boards", summary="Create a private board", response_model=ArtifactBoard, status_code=201
)
def create_board(
    body: ArtifactBoardName, user: Any = Depends(current_user), server: Any = Depends(get_server)
) -> Any:
    return server.services.artifact_board_repo.create(user.id, body.name)


@router.patch("/boards/{board_id}", summary="Rename a board", status_code=204)
def rename_board(
    board_id: str,
    body: ArtifactBoardName,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> None:
    _require_change(server.services.artifact_board_repo.rename(user.id, board_id, body.name))


@router.delete(
    "/boards/{board_id}", summary="Delete a board without deleting its artifacts", status_code=204
)
def delete_board(
    board_id: str, user: Any = Depends(current_user), server: Any = Depends(get_server)
) -> None:
    _require_change(server.services.artifact_board_repo.delete(user.id, board_id))


@router.put(
    "/boards/{board_id}/items/{artifact_id}",
    summary="Save or pin an artifact in a board",
    status_code=204,
)
def save_board_item(
    board_id: str,
    artifact_id: str,
    body: ArtifactBoardItem,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> None:
    _require_change(
        server.services.artifact_board_repo.save(user.id, board_id, artifact_id, body.pinned)
    )


@router.delete(
    "/boards/{board_id}/items/{artifact_id}",
    summary="Remove an artifact from a board",
    status_code=204,
)
def remove_board_item(
    board_id: str,
    artifact_id: str,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> None:
    _require_change(server.services.artifact_board_repo.remove(user.id, board_id, artifact_id))


@router.get(
    "/{artifact_id}/graph",
    summary="Explore references and derivations around an artifact",
    response_model=ArtifactGraph,
)
def artifact_graph(
    artifact_id: str, user: Any = Depends(current_user), server: Any = Depends(get_server)
) -> Any:
    get_artifact(artifact_id, user, server)
    return server.services.artifact_reference_repo.graph(user.id, artifact_id)


@router.post(
    "/{artifact_id}/references", summary="Reference another owned artifact", status_code=204
)
def add_reference(
    artifact_id: str,
    body: ArtifactReference,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> None:
    if artifact_id == body.target_id:
        raise HTTPException(status_code=422, detail="cannot reference the same artifact")
    _require_change(
        server.services.artifact_reference_repo.add(user.id, artifact_id, body.target_id)
    )


@router.delete(
    "/{artifact_id}/references/{target_id}", summary="Remove a reference", status_code=204
)
def remove_reference(
    artifact_id: str,
    target_id: str,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> None:
    _require_change(server.services.artifact_reference_repo.remove(user.id, artifact_id, target_id))


@router.get("/{artifact_id}", summary="Get an artifact", response_model=ArtifactDetail)
def get_artifact(
    artifact_id: str, user: Any = Depends(current_user), server: Any = Depends(get_server)
) -> dict[str, Any]:
    return _require(server.services.artifact_repo.get(user.id, artifact_id))


@router.get(
    "/{artifact_id}/thread", summary="Get the source conversation", response_model=ArtifactThread
)
def get_thread(
    artifact_id: str, user: Any = Depends(current_user), server: Any = Depends(get_server)
) -> dict[str, str]:
    row = get_artifact(artifact_id, user, server)
    return {"agent_id": row["agent_id"], "thread_id": row["thread_id"]}


@router.get(
    "/{artifact_id}/versions",
    summary="List saved artifact versions",
    response_model=list[ArtifactVersionInfo],
)
def list_versions(
    artifact_id: str, user: Any = Depends(current_user), server: Any = Depends(get_server)
) -> list[dict[str, Any]]:
    get_artifact(artifact_id, user, server)
    return server.services.artifact_repo.versions(user.id, artifact_id)  # type: ignore[no-any-return]


@router.get(
    "/{artifact_id}/versions/{revision}",
    summary="Read a saved artifact version",
    response_model=ArtifactVersion,
)
def get_version(
    artifact_id: str,
    revision: int,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    return _require(server.services.artifact_repo.version(user.id, artifact_id, revision))


@router.post(
    "/{artifact_id}/derive",
    status_code=201,
    summary="Draft a task from an artifact",
    response_model=ArtifactDerivedThread,
)
async def derive_artifact(
    artifact_id: str,
    body: ArtifactDeriveRequest,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> ArtifactDerivedThread:
    artifact = await run_in_threadpool(get_artifact, artifact_id, user, server)
    agent_id = body.agent_id or artifact["agent_id"]
    await run_in_threadpool(require_agent_row, agent_id, user=user, as_user=None, server=server)
    repo = server.services.artifact_repo
    version = await run_in_threadpool(repo.version, user.id, artifact_id, body.revision)
    if body.revision is not None:
        _require(version)
    live_text = None
    if version is None and not artifact["payload"] and artifact["mime_kind"] in TEXT_KINDS:
        workspace = await require_agent_workspace(artifact["agent_id"], user=user, server=server)
        live_text = await workspace.aread_text(artifact["path"], limit=SNAPSHOT_LIMIT + 1)
        if live_text is not None:
            await run_in_threadpool(
                server.services.artifact_repo.seed_text_version,
                user.id,
                artifact_id,
                live_text[:SNAPSHOT_LIMIT],
                len(live_text) > SNAPSHOT_LIMIT,
            )
            version = await run_in_threadpool(repo.version, user.id, artifact_id)
    context = ArtifactContext.model_validate(
        draft_context(artifact, version, live_text, body.focus)
    )
    thread_uuid = uuid5(
        NAMESPACE_URL,
        f"octop:derive:{user.id}:{agent_id}:{artifact_id}:{body.revision}:{body.request_id}",
    )
    registry = server.app_runtime.gateway.thread_registry
    thread_id = await run_in_threadpool(
        registry.create_thread,
        thread_id=f"thr_{thread_uuid.hex}",
        agent_id=agent_id,
        user_id=user.id,
        channel_type=ThreadRegistry.CHANNEL_DASHBOARD,
        session_key=ThreadRegistry.dashboard_key(agent_id=agent_id, user_id=user.id),
        title=artifact["title"],
        artifact_parent_id=artifact_id,
        artifact_parent_version=context.revision,
    )
    source = await run_in_threadpool(
        server.services.thread_repo.artifact_source, thread_id, user.id, agent_id
    )
    if source is None or source[0] != artifact_id:
        raise OctopError(ErrorCode.NOT_FOUND, "derived conversation not found")
    if source[1] != context.revision:
        pinned = (
            await run_in_threadpool(repo.version, user.id, artifact_id, source[1])
            if source[1]
            else None
        )
        context = ArtifactContext.model_validate(draft_context(artifact, pinned, None, body.focus))
    return ArtifactDerivedThread(agent_id=agent_id, thread_id=thread_id, context=context)


@router.patch("/{artifact_id}", summary="Edit artifact annotations", response_model=ArtifactDetail)
def patch_artifact(
    artifact_id: str,
    body: ArtifactPatch,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    return _require(server.services.artifact_repo.update(user.id, artifact_id, **body.model_dump()))


@router.post(
    "/{artifact_id}/status", summary="Change artifact status", response_model=ArtifactDetail
)
def update_status(
    artifact_id: str,
    body: ArtifactStatus,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    return _require(server.services.artifact_repo.update(user.id, artifact_id, status=body.status))
