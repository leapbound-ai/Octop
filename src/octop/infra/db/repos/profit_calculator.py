"""Persistence for account-scoped calculator defaults and frozen scenarios."""

import json
from typing import Any

from octop.infra.db.pool import DatabasePool
from octop.infra.db.repos._base import DbRow, now_ts


def _decode(row: DbRow, *columns: str) -> dict[str, Any]:
    result = dict(row)
    for column in columns:
        result[column] = json.loads(result[column])
    return result


class ProfitCalculatorRepo:
    def __init__(self, db: DatabasePool) -> None:
        self._db = db

    def list_baselines(
        self, user_id: int, limit: int, before: int | None = None
    ) -> list[dict[str, Any]]:
        with self._db.connect() as conn:
            rows = conn.execute(
                """SELECT version, payload, created_at FROM profit_calc_baselines
                   WHERE user_id = ? AND version < ?
                   ORDER BY version DESC LIMIT ?""",
                (user_id, before if before is not None else 2**31 - 1, limit),
            ).fetchall()
        return [_decode(row, "payload") for row in rows]

    def save_baseline(
        self, user_id: int, payload: str | None = None, *, restore: int | None = None
    ) -> dict[str, Any] | None:
        with self._db.transaction() as conn:
            # SQLite transactions begin IMMEDIATE. On PostgreSQL, serialize versions per user.
            if self._db.dialect == "postgresql":
                conn.execute("SELECT id FROM users WHERE id = ? FOR UPDATE", (user_id,))
            if restore is not None:
                source = conn.execute(
                    "SELECT payload FROM profit_calc_baselines WHERE user_id = ? AND version = ?",
                    (user_id, restore),
                ).fetchone()
                if source is None:
                    return None
                payload = source["payload"]
            row = conn.execute(
                """INSERT INTO profit_calc_baselines (user_id, version, payload, created_at)
                   SELECT ?, COALESCE(MAX(version), 0) + 1, ?, ?
                   FROM profit_calc_baselines WHERE user_id = ?
                   RETURNING version, payload, created_at""",
                (user_id, payload, now_ts(), user_id),
            ).fetchone()
            assert row is not None
            return _decode(row, "payload")

    def create_snapshot(
        self,
        user_id: int,
        snapshot_id: str,
        title: str,
        inputs: str,
        results: str,
        engine_version: str,
        baseline_version: int | None,
    ) -> dict[str, Any]:
        with self._db.connect() as conn:
            row = conn.execute(
                """INSERT INTO profit_calc_snapshots
                   (user_id, snapshot_id, title, inputs, results, engine_version, baseline_version, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                   RETURNING snapshot_id, title, inputs, results, engine_version, baseline_version, created_at""",
                (
                    user_id,
                    snapshot_id,
                    title,
                    inputs,
                    results,
                    engine_version,
                    baseline_version,
                    now_ts(),
                ),
            ).fetchone()
            assert row is not None
            return _decode(row, "inputs", "results")

    def list_snapshots(self, user_id: int, limit: int, before: str | None) -> list[dict[str, Any]]:
        with self._db.connect() as conn:
            rows = conn.execute(
                """SELECT snapshot_id, title, created_at, engine_version, baseline_version
                   FROM profit_calc_snapshots WHERE user_id = ? AND snapshot_id < ?
                   ORDER BY snapshot_id DESC LIMIT ?""",
                (user_id, before if before is not None else "Z", limit),
            ).fetchall()
        return [dict(row) for row in rows]

    def get_snapshot(self, user_id: int, snapshot_id: str) -> dict[str, Any] | None:
        with self._db.connect() as conn:
            row = conn.execute(
                """SELECT snapshot_id, title, inputs, results, engine_version, baseline_version, created_at
                   FROM profit_calc_snapshots WHERE user_id = ? AND snapshot_id = ?""",
                (user_id, snapshot_id),
            ).fetchone()
        return _decode(row, "inputs", "results") if row is not None else None

    def delete_snapshot(self, user_id: int, snapshot_id: str) -> bool:
        with self._db.connect() as conn:
            row = conn.execute(
                """DELETE FROM profit_calc_snapshots WHERE user_id = ? AND snapshot_id = ?
                   RETURNING snapshot_id""",
                (user_id, snapshot_id),
            ).fetchone()
        return row is not None
