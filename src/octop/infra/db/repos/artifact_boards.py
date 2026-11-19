"""Private artifact boards and their memberships."""

from __future__ import annotations

from typing import Any

from octop.infra.db.pool import DatabasePool
from octop.infra.db.repos._base import now_ts
from octop.infra.utils.ulid import new_ulid


class ArtifactBoardRepo:
    def __init__(self, db: DatabasePool) -> None:
        self._db = db

    def list(self, user_id: int) -> list[dict[str, Any]]:
        with self._db.connect() as conn:
            rows = conn.execute(
                """SELECT b.board_id, b.name, b.created_at, b.updated_at,
                (SELECT COUNT(*) FROM artifact_board_items i JOIN artifacts a
                 ON a.artifact_id = i.artifact_id
                 WHERE i.board_id = b.board_id AND a.user_id = b.user_id) AS total
                FROM artifact_boards b WHERE b.user_id = ? ORDER BY b.created_at, b.id""",
                (user_id,),
            ).fetchall()
        return [dict(row) for row in rows]

    def create(self, user_id: int, name: str) -> dict[str, Any]:
        now = now_ts()
        with self._db.connect() as conn:
            row = conn.execute(
                """INSERT INTO artifact_boards (board_id, user_id, name, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?) RETURNING board_id, name, created_at, updated_at""",
                (new_ulid(), user_id, name, now, now),
            ).fetchone()
        return {**dict(row), "total": 0}

    def rename(self, user_id: int, board_id: str, name: str) -> bool:
        with self._db.connect() as conn:
            return (
                conn.execute(
                    "UPDATE artifact_boards SET name = ?, updated_at = ? WHERE user_id = ? AND board_id = ? RETURNING board_id",
                    (name, now_ts(), user_id, board_id),
                ).fetchone()
                is not None
            )

    def delete(self, user_id: int, board_id: str) -> bool:
        with self._db.connect() as conn:
            return (
                conn.execute(
                    "DELETE FROM artifact_boards WHERE user_id = ? AND board_id = ? RETURNING board_id",
                    (user_id, board_id),
                ).fetchone()
                is not None
            )

    def save(self, user_id: int, board_id: str, artifact_id: str, pinned: bool | None) -> bool:
        with self._db.connect() as conn:
            return (
                conn.execute(
                    """INSERT INTO artifact_board_items (board_id, artifact_id, pinned, created_at)
                SELECT b.board_id, a.artifact_id, ?, ? FROM artifact_boards b, artifacts a
                WHERE b.board_id = ? AND a.artifact_id = ? AND b.user_id = ? AND a.user_id = ?
                ON CONFLICT (board_id, artifact_id) DO UPDATE SET
                pinned = COALESCE(?, artifact_board_items.pinned) RETURNING board_id""",
                    (
                        int(pinned or False),
                        now_ts(),
                        board_id,
                        artifact_id,
                        user_id,
                        user_id,
                        int(pinned) if pinned is not None else None,
                    ),
                ).fetchone()
                is not None
            )

    def remove(self, user_id: int, board_id: str, artifact_id: str) -> bool:
        with self._db.transaction() as conn:
            owned = conn.execute(
                "SELECT 1 FROM artifact_boards WHERE board_id = ? AND user_id = ?",
                (board_id, user_id),
            ).fetchone()
            if owned is None:
                return False
            conn.execute(
                "DELETE FROM artifact_board_items WHERE board_id = ? AND artifact_id = ?",
                (board_id, artifact_id),
            )
        return True
