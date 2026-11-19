"""User-scoped index of files published in agent conversations."""

from __future__ import annotations

import json
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from octop.infra.db.pool import DatabasePool
from octop.infra.db.repos._base import DbRow, now_ts
from octop.infra.utils.ulid import new_ulid

SUMMARY_COLUMNS = """
artifact_id, agent_id, thread_id, path, title, kind, mime_kind, summary,
schema_version, tags, status, source, created_at, updated_at
"""


@dataclass(frozen=True)
class ArtifactWrite:
    path: str
    title: str
    mime_kind: str
    kind: str = "file"
    summary: str = ""
    payload: dict[str, Any] | None = None
    tags: tuple[str, ...] = ()
    text: str | None = None
    truncated: bool = False


def _serialize(row: DbRow) -> dict[str, Any]:
    result = dict(row)
    result["tags"] = json.loads(result["tags"])
    for field in ("payload", "refs"):
        if field in result:
            result[field] = json.loads(result[field])
    return result


class ArtifactRepo:
    def __init__(self, db: DatabasePool) -> None:
        self._db = db

    def record(self, thread_id: str, agent_id: str, files: Sequence[ArtifactWrite]) -> None:
        now = now_ts()
        with self._db.transaction() as conn:
            for file in files:
                row = conn.execute(
                    """
                    INSERT INTO artifacts (
                      artifact_id, agent_id, thread_id, user_id, path, title, mime_kind,
                      kind, summary, payload, tags, created_at, updated_at, parent_id, parent_version
                    )
                    SELECT ?, agent_id, thread_id, user_id, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                      artifact_parent_id, artifact_parent_version
                    FROM threads WHERE thread_id = ? AND agent_id = ?
                    ON CONFLICT (agent_id, thread_id, path) DO UPDATE SET
                      updated_at = excluded.updated_at,
                      kind = CASE WHEN ? THEN excluded.kind ELSE artifacts.kind END,
                      payload = CASE WHEN ? THEN excluded.payload ELSE artifacts.payload END,
                      summary = CASE WHEN artifacts.kind = 'file' AND artifacts.summary = ''
                        THEN excluded.summary ELSE artifacts.summary END,
                      tags = CASE WHEN artifacts.kind = 'file' AND artifacts.tags = '[]'
                        THEN excluded.tags ELSE artifacts.tags END
                    WHERE artifacts.user_id = excluded.user_id
                    RETURNING artifact_id
                    """,
                    (
                        new_ulid(),
                        file.path,
                        file.title,
                        file.mime_kind,
                        file.kind,
                        file.summary,
                        json.dumps(file.payload or {}, ensure_ascii=False),
                        json.dumps(file.tags, ensure_ascii=False),
                        now,
                        now,
                        thread_id,
                        agent_id,
                        file.payload is not None or file.text is not None,
                        file.payload is not None or file.text is not None,
                    ),
                ).fetchone()
                if row is None:
                    continue
                if file.payload is not None:
                    content = json.dumps(file.payload, ensure_ascii=False, sort_keys=True)
                    self._append_version(conn, row["artifact_id"], "json", content, False, now)
                elif file.text is not None:
                    self._append_version(
                        conn, row["artifact_id"], "text", file.text, file.truncated, now
                    )

    @staticmethod
    def _append_version(
        conn: Any, artifact_id: str, content_type: str, content: str, truncated: bool, now: int
    ) -> None:
        latest = conn.execute(
            """
            SELECT revision, content_type, content, truncated FROM artifact_versions
            WHERE artifact_id = ? ORDER BY revision DESC LIMIT 1
            """,
            (artifact_id,),
        ).fetchone()
        if (
            latest
            and latest["content_type"] == content_type
            and bool(latest["truncated"]) == truncated
        ):
            previous = latest["content"]
            if previous == content or (
                content_type == "json" and json.loads(previous) == json.loads(content)
            ):
                return
        conn.execute(
            """
            INSERT INTO artifact_versions (artifact_id, revision, content_type, content, truncated, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                artifact_id,
                latest["revision"] + 1 if latest else 1,
                content_type,
                content,
                int(truncated),
                now,
            ),
        )

    def seed_text_version(
        self, user_id: int, artifact_id: str, content: str, truncated: bool
    ) -> None:
        """Pin a pre-versioning file at its first reuse."""
        with self._db.transaction() as conn:
            # Serialize with the upsert path before checking for a concurrent snapshot.
            locked = conn.execute(
                "UPDATE artifacts SET updated_at = updated_at WHERE user_id = ? AND artifact_id = ?"
                " RETURNING artifact_id",
                (user_id, artifact_id),
            ).fetchone()
            if locked is None:
                return
            existing = conn.execute(
                "SELECT 1 FROM artifact_versions WHERE artifact_id = ? LIMIT 1",
                (artifact_id,),
            ).fetchone()
            if existing is None:
                self._append_version(conn, artifact_id, "text", content, truncated, now_ts())

    def versions(self, user_id: int, artifact_id: str) -> list[dict[str, Any]]:
        with self._db.connect() as conn:
            rows = conn.execute(
                """
                SELECT v.artifact_id, v.revision, v.content_type, v.truncated, v.created_at
                FROM artifact_versions v JOIN artifacts a ON a.artifact_id = v.artifact_id
                WHERE a.user_id = ? AND v.artifact_id = ? ORDER BY v.revision DESC
                """,
                (user_id, artifact_id),
            ).fetchall()
        return [dict(row) for row in rows]

    def version(
        self, user_id: int, artifact_id: str, revision: int | None = None
    ) -> dict[str, Any] | None:
        clause = "AND v.revision = ?" if revision is not None else ""
        params = (
            (user_id, artifact_id, revision) if revision is not None else (user_id, artifact_id)
        )
        with self._db.connect() as conn:
            row = conn.execute(
                f"""
                SELECT v.* FROM artifact_versions v JOIN artifacts a ON a.artifact_id = v.artifact_id
                WHERE a.user_id = ? AND v.artifact_id = ? {clause}
                ORDER BY v.revision DESC LIMIT 1
                """,
                params,
            ).fetchone()
        return dict(row) if row is not None else None

    def list_for_user(
        self,
        user_id: int,
        *,
        status: str,
        agent_id: str | None,
        kind: str | None,
        tag: str | None,
        query: str | None,
        since: int | None,
        until: int | None,
        newest_first: bool,
        page: int,
        page_size: int,
        board_id: str | None = None,
    ) -> dict[str, Any]:
        clauses = ["user_id = ?", "status = ?"]
        params: list[str | int] = [user_id, status]
        for condition, value in (
            ("agent_id = ?", agent_id),
            ("kind = ?", kind),
            ("created_at >= ?", since),
            ("created_at < ?", until),
        ):
            if value is not None:
                clauses.append(condition)
                params.append(value)
        if board_id:
            clauses.append(
                "EXISTS (SELECT 1 FROM artifact_board_items bi JOIN artifact_boards b ON b.board_id = bi.board_id"
                " WHERE bi.artifact_id = artifacts.artifact_id AND b.board_id = ? AND b.user_id = artifacts.user_id)"
            )
            params.append(board_id)
        if tag:
            if self._db.dialect == "postgresql":
                clauses.append(
                    "EXISTS (SELECT 1 FROM jsonb_array_elements_text(tags::jsonb) AS tag(value)"
                    " WHERE tag.value = ?)"
                )
            else:
                clauses.append("EXISTS (SELECT 1 FROM json_each(tags) WHERE value = ?)")
            params.append(tag)
        if query:
            clauses.append(
                "(LOWER(title || ' ' || path || ' ' || summary || ' ' || tags || ' ' || payload)"
                " LIKE ? ESCAPE '!' OR EXISTS (SELECT 1 FROM artifact_versions v"
                " WHERE v.artifact_id = artifacts.artifact_id AND LOWER(v.content) LIKE ? ESCAPE '!'))"
            )
            pattern = _contains(query.lower())
            params.extend((pattern, pattern))
        where = " AND ".join(clauses)
        order = "DESC" if newest_first else "ASC"
        pinned = "0"
        select_params: tuple[str, ...] = ()
        if board_id:
            pinned = "COALESCE((SELECT pinned FROM artifact_board_items WHERE board_id = ? AND artifact_id = artifacts.artifact_id), 0)"
            select_params = (board_id,)
        with self._db.connect() as conn:
            total = conn.execute(
                f"SELECT COUNT(*) AS total FROM artifacts WHERE {where}", params
            ).fetchone()
            rows = conn.execute(
                f"""
                SELECT {SUMMARY_COLUMNS}, {pinned} AS pinned FROM artifacts WHERE {where}
                ORDER BY pinned DESC, created_at {order}, id {order} LIMIT ? OFFSET ?
                """,
                (*select_params, *params, page_size, (page - 1) * page_size),
            ).fetchall()
        return {"items": [_serialize(row) for row in rows], "total": total["total"]}

    def get(self, user_id: int, artifact_id: str) -> dict[str, Any] | None:
        with self._db.connect() as conn:
            row = conn.execute(
                f"SELECT {SUMMARY_COLUMNS}, payload, refs, parent_id, parent_version FROM artifacts WHERE user_id = ? AND artifact_id = ?",
                (user_id, artifact_id),
            ).fetchone()
        return _serialize(row) if row is not None else None

    def update(
        self,
        user_id: int,
        artifact_id: str,
        *,
        title: str | None = None,
        summary: str | None = None,
        tags: list[str] | None = None,
        status: str | None = None,
    ) -> dict[str, Any] | None:
        with self._db.connect() as conn:
            row = conn.execute(
                f"""
                UPDATE artifacts SET title = COALESCE(?, title), summary = COALESCE(?, summary),
                  tags = COALESCE(?, tags), status = COALESCE(?, status), updated_at = ?
                WHERE user_id = ? AND artifact_id = ?
                RETURNING {SUMMARY_COLUMNS}, payload, refs, parent_id, parent_version
                """,
                (
                    title,
                    summary,
                    json.dumps(tags, ensure_ascii=False) if tags is not None else None,
                    status,
                    now_ts(),
                    user_id,
                    artifact_id,
                ),
            ).fetchone()
        return _serialize(row) if row is not None else None

    def agents(self, user_id: int) -> list[dict[str, str]]:
        with self._db.connect() as conn:
            rows = conn.execute(
                """
                SELECT DISTINCT agents.agent_id, agents.name
                FROM artifacts JOIN agents ON agents.agent_id = artifacts.agent_id
                WHERE artifacts.user_id = ? ORDER BY agents.name, agents.agent_id
                """,
                (user_id,),
            ).fetchall()
        return [dict(row) for row in rows]

    def stats(self, user_id: int, week_start: int) -> dict[str, int]:
        with self._db.connect() as conn:
            row = conn.execute(
                """
                SELECT COUNT(*) AS total, COUNT(DISTINCT agent_id) AS agents,
                  COUNT(CASE WHEN created_at >= ? THEN 1 END) AS this_week
                FROM artifacts WHERE user_id = ? AND status = 'active'
                """,
                (week_start, user_id),
            ).fetchone()
        return dict(row)


def _contains(value: str) -> str:
    return "%" + value.replace("!", "!!").replace("%", "!%").replace("_", "!_") + "%"
