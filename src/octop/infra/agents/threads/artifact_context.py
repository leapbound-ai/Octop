"""Build an editable chat draft from a bounded artifact snapshot."""

from __future__ import annotations

import json
import re
from typing import Any

SNAPSHOT_LIMIT = 64_000
CONTEXT_LIMIT = 8_000
TEXT_KINDS = frozenset({"markdown", "text", "html", "csv", "json"})


def _excerpt(text: str, focus: str) -> tuple[str, bool]:
    if len(text) <= CONTEXT_LIMIT:
        return text, False
    paragraphs = text.split("\n\n")
    terms: set[str] = set()
    for word in re.findall(r"[\u3400-\u9fff]+|[^\W_]+", focus.casefold()):
        if len(word) < 2:
            continue
        if "\u3400" <= word[0] <= "\u9fff":
            terms.update(word[index : index + 2] for index in range(len(word) - 1))
        else:
            terms.add(word)
    if not terms or len(paragraphs) < 2:
        return text[:CONTEXT_LIMIT], True

    def score(index: int) -> int:
        return sum(term in paragraphs[index].casefold() for term in terms)

    ranked = sorted(range(1, len(paragraphs)), key=score, reverse=True)
    selected: dict[int, str] = {}
    remaining = CONTEXT_LIMIT
    for index in [0, *ranked]:
        if remaining <= 0:
            break
        selected[index] = paragraphs[index][:remaining]
        remaining -= len(selected[index]) + 2
    return "\n\n".join(selected[index] for index in sorted(selected)), True


def _structured_text(value: dict[str, Any]) -> str:
    # Keep each candidate together and omit the duplicate rendered Markdown.
    items: list[str] = []
    overview: dict[str, Any] = {}
    for key, field in value.items():
        if key == "report_markdown":
            continue
        if isinstance(field, list):
            items.extend(
                f"{key}: {json.dumps(item, ensure_ascii=False, sort_keys=True)}" for item in field
            )
        else:
            overview[key] = field
    return "\n\n".join([json.dumps(overview, ensure_ascii=False, sort_keys=True), *items])


def draft_context(
    artifact: dict[str, Any], version: dict[str, Any] | None, live_text: str | None, focus: str
) -> dict[str, Any]:
    content = live_text or ""
    truncated = False
    if version is not None:
        content = version["content"]
        truncated = bool(version["truncated"])
        if version["content_type"] == "json":
            content = _structured_text(json.loads(content))
    elif artifact["payload"]:
        content = _structured_text(artifact["payload"])
    excerpt, clipped = _excerpt(content, focus)
    return {
        "artifact_id": artifact["artifact_id"],
        "title": artifact["title"],
        "summary": artifact["summary"][:1000],
        "excerpt": excerpt,
        "truncated": truncated or clipped,
        "revision": version["revision"] if version else None,
    }
