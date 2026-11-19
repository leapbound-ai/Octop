"""Owner-scoped artifact reviews and comments."""

from __future__ import annotations

from typing import Any

from octop.infra.db.pool import DatabasePool
from octop.infra.db.repos._base import now_ts


class ArtifactFeedbackRepo:
    def __init__(self, db: DatabasePool) -> None:
        self._db = db

    def review(self, user_id: int, artifact_id: str) -> dict[str, Any] | None:
        with self._db.connect() as conn:
            row = conn.execute(
                """SELECT a.artifact_id, COALESCE(r.rating, 0) rating,
              COALESCE(r.decision, 'pending') decision, COALESCE(r.use_for_preferences, 1) use_for_preferences,
              r.revision, r.updated_at FROM artifacts a LEFT JOIN artifact_reviews r ON r.artifact_id=a.artifact_id
              WHERE a.artifact_id=? AND a.user_id=?""",
                (artifact_id, user_id),
            ).fetchone()
        return dict(row) if row else None

    def update(
        self,
        user_id: int,
        artifact_id: str,
        *,
        rating: int | None = None,
        decision: str | None = None,
        use_for_preferences: bool | None = None,
    ) -> dict[str, Any] | None:
        with self._db.transaction() as conn:
            owned = conn.execute(
                "SELECT 1 FROM artifacts WHERE artifact_id=? AND user_id=?", (artifact_id, user_id)
            ).fetchone()
            if not owned:
                return None
            conn.execute(
                """INSERT INTO artifact_reviews(artifact_id,rating,decision,use_for_preferences,revision,updated_at)
              VALUES(?,COALESCE(?,0),COALESCE(?,'pending'),COALESCE(?,1),(SELECT MAX(revision) FROM artifact_versions WHERE artifact_id=?),?)
              ON CONFLICT(artifact_id) DO UPDATE SET rating=COALESCE(?,rating), decision=COALESCE(?,decision),
              use_for_preferences=COALESCE(?,use_for_preferences), revision=COALESCE((SELECT MAX(revision) FROM artifact_versions WHERE artifact_id=?),revision), updated_at=excluded.updated_at""",
                (
                    artifact_id,
                    rating,
                    decision,
                    int(use_for_preferences) if use_for_preferences is not None else None,
                    artifact_id,
                    now_ts(),
                    rating,
                    decision,
                    int(use_for_preferences) if use_for_preferences is not None else None,
                    artifact_id,
                ),
            )
            row = conn.execute(
                "SELECT * FROM artifact_reviews WHERE artifact_id=?", (artifact_id,)
            ).fetchone()
        return dict(row) if row else None

    def comments(self, user_id: int, artifact_id: str) -> list[dict[str, Any]]:
        with self._db.connect() as conn:
            rows = conn.execute(
                """SELECT c.comment_id,c.content,c.revision,c.created_at FROM artifact_comments c
              JOIN artifacts a ON a.artifact_id=c.artifact_id WHERE c.artifact_id=? AND a.user_id=? AND c.user_id=? ORDER BY c.id DESC LIMIT 50""",
                (artifact_id, user_id, user_id),
            ).fetchall()
        return [dict(row) for row in rows]

    def add_comment(
        self, user_id: int, artifact_id: str, comment_id: str, content: str
    ) -> dict[str, Any] | None:
        with self._db.transaction() as conn:
            row = conn.execute(
                """INSERT INTO artifact_comments(comment_id,artifact_id,user_id,content,revision,created_at)
              SELECT ?,artifact_id,?, ?, (SELECT MAX(revision) FROM artifact_versions WHERE artifact_id=?), ? FROM artifacts
              WHERE artifact_id=? AND user_id=? ON CONFLICT(comment_id) DO NOTHING RETURNING comment_id,content,revision,created_at""",
                (comment_id, user_id, content, artifact_id, now_ts(), artifact_id, user_id),
            ).fetchone()
        return dict(row) if row else None

    def delete_comment(self, user_id: int, artifact_id: str, comment_id: str) -> bool:
        with self._db.connect() as conn:
            row = conn.execute(
                "DELETE FROM artifact_comments WHERE comment_id=? AND artifact_id=? AND user_id=? RETURNING comment_id",
                (comment_id, artifact_id, user_id),
            ).fetchone()
        return row is not None

    def evidence(self, user_id: int) -> list[dict[str, Any]]:
        with self._db.connect() as conn:
            rows = conn.execute(
                """SELECT a.title,a.summary,r.rating,r.decision,r.revision FROM artifact_reviews r
              JOIN artifacts a ON a.artifact_id=r.artifact_id WHERE a.user_id=? AND r.use_for_preferences=1
              AND (r.rating>0 OR r.decision<>'pending' OR EXISTS(SELECT 1 FROM artifact_comments c WHERE c.artifact_id=a.artifact_id AND c.user_id=?))
              ORDER BY r.updated_at DESC LIMIT 12""",
                (user_id, user_id),
            ).fetchall()
        return [dict(row) for row in rows]
