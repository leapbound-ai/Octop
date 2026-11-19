"""Explicit, directed artifact references and existing derivation edges."""

from __future__ import annotations

from typing import Any

from octop.infra.db.pool import DatabasePool
from octop.infra.db.repos._base import now_ts


class ArtifactReferenceRepo:
    def __init__(self, db: DatabasePool) -> None:
        self._db = db

    def add(self, user_id: int, source_id: str, target_id: str) -> bool:
        with self._db.transaction() as conn:
            owned = conn.execute(
                "SELECT 1 FROM artifacts s, artifacts t WHERE s.artifact_id = ? AND t.artifact_id = ? AND s.user_id = ? AND t.user_id = ? AND s.artifact_id <> t.artifact_id",
                (source_id, target_id, user_id, user_id),
            ).fetchone()
            if owned is None:
                return False
            conn.execute(
                "INSERT INTO artifact_references (source_id, target_id, created_at) VALUES (?, ?, ?) ON CONFLICT (source_id, target_id) DO NOTHING",
                (source_id, target_id, now_ts()),
            )
        return True

    def remove(self, user_id: int, source_id: str, target_id: str) -> bool:
        with self._db.transaction() as conn:
            owned = conn.execute(
                "SELECT 1 FROM artifacts WHERE artifact_id = ? AND user_id = ?",
                (source_id, user_id),
            ).fetchone()
            if owned is None:
                return False
            conn.execute(
                "DELETE FROM artifact_references WHERE source_id = ? AND target_id = ?",
                (source_id, target_id),
            )
        return True

    def graph(self, user_id: int, artifact_id: str) -> dict[str, Any]:
        # One-hop neighbourhood, with navigation expanding the next node. Bound the
        # result for large hubs; never load another user's nodes or titles.
        with self._db.connect() as conn:
            rows = conn.execute(
                """WITH edges AS (
                  SELECT source_id, target_id, 'reference' AS kind FROM artifact_references
                  WHERE source_id = ? OR target_id = ?
                  UNION ALL
                  SELECT artifact_id, parent_id, 'derivation' AS kind FROM artifacts
                  WHERE parent_id <> '' AND (artifact_id = ? OR parent_id = ?)
                )
                SELECT e.*, s.title AS source_title, t.title AS target_title,
                  s.status AS source_status, t.status AS target_status
                FROM edges e JOIN artifacts s ON s.artifact_id = e.source_id
                JOIN artifacts t ON t.artifact_id = e.target_id
                WHERE s.user_id = ? AND t.user_id = ?
                ORDER BY e.kind, e.source_id, e.target_id LIMIT 101""",
                (artifact_id, artifact_id, artifact_id, artifact_id, user_id, user_id),
            ).fetchall()
        return {"edges": [dict(row) for row in rows[:100]], "truncated": len(rows) > 100}
