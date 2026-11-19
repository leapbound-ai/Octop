"""Account-scoped inquiries, supplier profiles and immutable reply revisions."""

import json
from typing import Any

from octop.infra.db.pool import DatabasePool
from octop.infra.db.repos._base import DbRow, now_ts
from octop.infra.utils.ulid import new_ulid


def _decode(row: DbRow, *fields: str) -> dict[str, Any]:
    result = dict(row)
    for field in fields:
        value = result[field]
        result[field] = json.loads(value) if value is not None else None
    return result


_RFQ_COUNTS = """
    SELECT r.*, COUNT(DISTINCT p.supplier_id) AS supplier_count,
        COUNT(DISTINCT CASE WHEN p.terms IS NOT NULL THEN p.supplier_id END) AS parsed_count
    FROM sourcing_rfqs r
    LEFT JOIN sourcing_rfq_replies p ON p.user_id = r.user_id AND p.rfq_id = r.rfq_id
        AND p.id = (SELECT MAX(n.id) FROM sourcing_rfq_replies n WHERE n.user_id = r.user_id
            AND n.rfq_id = r.rfq_id AND n.supplier_id = p.supplier_id)
"""

_REPLY_SELECT = """
    SELECT p.*, s.name AS supplier_name, r.title AS product_title, r.candidate_id
    FROM sourcing_rfq_replies p
    JOIN sourcing_suppliers s ON s.user_id = p.user_id AND s.supplier_id = p.supplier_id
    JOIN sourcing_rfqs r ON r.user_id = p.user_id AND r.rfq_id = p.rfq_id
"""


class SourcingRfqRepo:
    def __init__(self, db: DatabasePool) -> None:
        self._db = db

    def list_rfqs(self, user_id: int) -> list[dict[str, Any]]:
        with self._db.connect() as conn:
            rows = conn.execute(
                _RFQ_COUNTS
                + " WHERE r.user_id = ? GROUP BY r.id ORDER BY r.updated_at DESC, r.id DESC",
                (user_id,),
            ).fetchall()
        return [_decode(row, "categories", "questions") for row in rows]

    def get_rfq(self, user_id: int, rfq_id: str) -> dict[str, Any] | None:
        with self._db.connect() as conn:
            row = conn.execute(
                _RFQ_COUNTS + " WHERE r.user_id = ? AND r.rfq_id = ? GROUP BY r.id",
                (user_id, rfq_id),
            ).fetchone()
            if row is None:
                return None
            replies = conn.execute(
                _REPLY_SELECT
                + """ WHERE p.user_id = ? AND p.rfq_id = ?
                      AND p.id = (SELECT MAX(n.id) FROM sourcing_rfq_replies n
                        WHERE n.user_id = p.user_id AND n.rfq_id = p.rfq_id
                        AND n.supplier_id = p.supplier_id)
                      ORDER BY p.id DESC""",
                (user_id, rfq_id),
            ).fetchall()
        result = _decode(row, "categories", "questions")
        result["replies"] = [_decode(reply, "terms", "manual_terms") for reply in replies]
        return result

    def create_rfq(self, user_id: int, data: dict[str, Any], questions: str) -> str:
        rfq_id = new_ulid()
        now = now_ts()
        with self._db.connect() as conn:
            conn.execute(
                """INSERT INTO sourcing_rfqs (rfq_id, user_id, title, candidate_id, plan_price,
                   monthly_qty, categories, questions, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    rfq_id,
                    user_id,
                    data["title"],
                    data["candidate_id"],
                    data["plan_price"],
                    data["monthly_qty"],
                    json.dumps(data["categories"]),
                    questions,
                    now,
                    now,
                ),
            )
        return rfq_id

    def set_archived(self, user_id: int, rfq_id: str, archived: bool) -> bool:
        with self._db.connect() as conn:
            return (
                conn.execute(
                    """UPDATE sourcing_rfqs SET archived = ?, updated_at = ?
                   WHERE user_id = ? AND rfq_id = ? RETURNING rfq_id""",
                    (int(archived), now_ts(), user_id, rfq_id),
                ).fetchone()
                is not None
            )

    def list_suppliers(self, user_id: int) -> list[dict[str, Any]]:
        with self._db.connect() as conn:
            rows = conn.execute(
                """SELECT s.*, COUNT(p.parsed_at) AS version_count, MAX(p.created_at) AS last_contact
                   FROM sourcing_suppliers s LEFT JOIN sourcing_rfq_replies p
                   ON s.user_id = p.user_id AND s.supplier_id = p.supplier_id
                   WHERE s.user_id = ? GROUP BY s.id
                   ORDER BY COALESCE(MAX(p.created_at), s.created_at) DESC, s.id DESC""",
                (user_id,),
            ).fetchall()
        return [dict(row) for row in rows]

    def supplier_history(self, user_id: int, supplier_id: str) -> list[dict[str, Any]] | None:
        with self._db.connect() as conn:
            if (
                conn.execute(
                    "SELECT id FROM sourcing_suppliers WHERE user_id = ? AND supplier_id = ?",
                    (user_id, supplier_id),
                ).fetchone()
                is None
            ):
                return None
            rows = conn.execute(
                _REPLY_SELECT + " WHERE p.user_id = ? AND p.supplier_id = ? ORDER BY p.id DESC",
                (user_id, supplier_id),
            ).fetchall()
        return [_decode(row, "terms", "manual_terms") for row in rows]

    def save_reply(
        self,
        user_id: int,
        rfq_id: str,
        raw: str,
        supplier_id: str | None,
        name: str,
        name_key: str,
        shop_url: str,
    ) -> dict[str, Any] | None:
        now = now_ts()
        with self._db.transaction() as conn:
            # Lock the inquiry before reading the latest revision. Archive and save serialize.
            if (
                conn.execute(
                    """UPDATE sourcing_rfqs SET updated_at = ? WHERE user_id = ? AND rfq_id = ?
                   AND archived = 0 RETURNING rfq_id""",
                    (now, user_id, rfq_id),
                ).fetchone()
                is None
            ):
                return None
            if supplier_id is not None:
                supplier = conn.execute(
                    "SELECT supplier_id FROM sourcing_suppliers WHERE user_id = ? AND supplier_id = ?",
                    (user_id, supplier_id),
                ).fetchone()
                if supplier is None:
                    return None
            else:
                supplier = conn.execute(
                    """INSERT INTO sourcing_suppliers (supplier_id, user_id, name, name_key, shop_url, created_at)
                       VALUES (?, ?, ?, ?, ?, ?)
                       ON CONFLICT (user_id, name_key) DO UPDATE SET
                       shop_url = CASE WHEN sourcing_suppliers.shop_url = '' THEN excluded.shop_url
                                      ELSE sourcing_suppliers.shop_url END
                       RETURNING supplier_id""",
                    (new_ulid(), user_id, name, name_key, shop_url, now),
                ).fetchone()
                assert supplier is not None
            supplier_id = supplier["supplier_id"]
            latest = conn.execute(
                _REPLY_SELECT
                + """ WHERE p.user_id = ? AND p.rfq_id = ? AND p.supplier_id = ?
                       ORDER BY p.id DESC LIMIT 1""",
                (user_id, rfq_id, supplier_id),
            ).fetchone()
            if latest is not None and latest["raw_text"] == raw:
                return _decode(latest, "terms", "manual_terms")

            reply_id = new_ulid()
            conn.execute(
                """INSERT INTO sourcing_rfq_replies (reply_id, user_id, rfq_id, supplier_id, raw_text, created_at)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (reply_id, user_id, rfq_id, supplier_id, raw, now),
            )
            row = conn.execute(
                _REPLY_SELECT + " WHERE p.user_id = ? AND p.reply_id = ?",
                (user_id, reply_id),
            ).fetchone()
            assert row is not None
            return _decode(row, "terms", "manual_terms")

    def get_reply(self, user_id: int, reply_id: str) -> dict[str, Any] | None:
        with self._db.connect() as conn:
            row = conn.execute(
                _REPLY_SELECT + " WHERE p.user_id = ? AND p.reply_id = ?",
                (user_id, reply_id),
            ).fetchone()
        return _decode(row, "terms", "manual_terms") if row is not None else None

    def review_term(
        self,
        user_id: int,
        reply_id: str,
        term_id: str,
        review: dict[str, Any] | None,
    ) -> dict[str, Any] | None:
        with self._db.transaction() as conn:
            # Use the same inquiry lock as saving a reply or archiving.
            locked = conn.execute(
                """UPDATE sourcing_rfqs SET updated_at = updated_at
                   WHERE user_id = ? AND archived = 0 AND rfq_id = (
                       SELECT rfq_id FROM sourcing_rfq_replies WHERE user_id = ? AND reply_id = ?
                   ) RETURNING rfq_id""",
                (user_id, user_id, reply_id),
            ).fetchone()
            if locked is None:
                return None
            row = conn.execute(
                _REPLY_SELECT
                + """ WHERE p.user_id = ? AND p.reply_id = ? AND p.terms IS NOT NULL
                   AND NOT EXISTS (
                       SELECT 1 FROM sourcing_rfq_replies n WHERE n.user_id = p.user_id
                       AND n.rfq_id = p.rfq_id AND n.supplier_id = p.supplier_id AND n.id > p.id
                   )""",
                (user_id, reply_id),
            ).fetchone()
            if row is None:
                return None
            result = _decode(row, "terms", "manual_terms")
            if not any(term["id"] == term_id for term in result["terms"]):
                return None
            reviews = result["manual_terms"]
            if review is None:
                reviews.pop(term_id, None)
            else:
                reviews[term_id] = review
            conn.execute(
                """UPDATE sourcing_rfq_replies SET manual_terms = ?
                   WHERE user_id = ? AND reply_id = ?""",
                (json.dumps(reviews, ensure_ascii=False), user_id, reply_id),
            )
            conn.execute(
                "UPDATE sourcing_rfqs SET updated_at = ? WHERE user_id = ? AND rfq_id = ?",
                (now_ts(), user_id, locked["rfq_id"]),
            )
            return result

    def finish_parse(self, user_id: int, rfq_id: str, reply_id: str, terms: str) -> bool:
        now = now_ts()
        with self._db.transaction() as conn:
            if (
                conn.execute(
                    """UPDATE sourcing_rfqs SET updated_at = ? WHERE user_id = ? AND rfq_id = ?
                   AND archived = 0 RETURNING rfq_id""",
                    (now, user_id, rfq_id),
                ).fetchone()
                is None
            ):
                return False
            conn.execute(
                """UPDATE sourcing_rfq_replies SET terms = ?, parsed_at = ?
                   WHERE user_id = ? AND rfq_id = ? AND reply_id = ? AND terms IS NULL""",
                (terms, now, user_id, rfq_id, reply_id),
            )
        return True
