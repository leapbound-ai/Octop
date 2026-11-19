"""Build index entries from successful tool outputs without opening files."""

from __future__ import annotations

import json
import os
from collections.abc import Mapping, Sequence
from pathlib import Path, PurePosixPath
from typing import Any

from langchain_core.messages import HumanMessage, ToolMessage

from octop.infra.agents.threads.artifact import artifact_path_allowed
from octop.infra.db.repos.artifacts import ArtifactWrite
from octop.infra.gateway.media.backend_files import file_url_to_abs_path
from octop.infra.gateway.media.tool_media import tool_name_base

_DOCUMENTS = {
    ".md": "markdown",
    ".markdown": "markdown",
    ".docx": "doc",
    ".pdf": "pdf",
    ".xlsx": "sheet",
    ".xls": "sheet",
    ".pptx": "slide",
    ".csv": "csv",
    ".html": "html",
    ".htm": "html",
    ".txt": "text",
    ".json": "json",
}
_EXCLUDED = {"node_modules", "__pycache__", "_builtin_skills", "dist", "build", "tmp", "temp"}
_VIRTUAL_DIRS = ("outbound/", "inbound/", "generated/")


def workspace_artifact_path(path: str, workspace: Path) -> str:
    raw = path.strip().replace("\\", "/")
    if raw.startswith("file://"):
        raw = file_url_to_abs_path(raw).replace("\\", "/")
    root = workspace.as_posix().rstrip("/")
    comparison = raw.casefold() if os.name == "nt" else raw
    prefix = root.casefold() if os.name == "nt" else root
    if comparison.startswith(prefix + "/"):
        raw = raw[len(root) + 1 :]
    elif (
        not path.startswith("file://") and raw.startswith("/") and raw[1:].startswith(_VIRTUAL_DIRS)
    ):
        raw = raw[1:]
    if raw.startswith(("/", "~")) or ":" in raw or "\x00" in raw:
        return ""
    parts = raw.removeprefix("./").split("/")
    if any(not part or part.startswith(".") or part.lower() in _EXCLUDED for part in parts):
        return ""
    rel = PurePosixPath(*parts)
    if rel.stem.isdecimal() or not artifact_path_allowed(rel.as_posix()):
        return ""
    return rel.as_posix()


def workbench_entries(
    paths: Sequence[str], *, workspace: Path, name: str, state: Any, collect_all: bool
) -> list[ArtifactWrite]:
    result: dict[str, ArtifactWrite] = {}
    for path in paths:
        relative = workspace_artifact_path(path, workspace)
        if not relative:
            continue
        file = PurePosixPath(relative)
        mime = _DOCUMENTS.get(file.suffix.lower())
        if mime is None and not collect_all:
            continue
        report = _sourcing_report(relative, name, state)
        item = ArtifactWrite(relative, file.name, mime or "other")
        if report is not None:
            payload, summary = report
            scene = payload.get("scene")
            tags = (scene[:80],) if isinstance(scene, str) and scene.strip() else ()
            item = ArtifactWrite(
                relative, file.name, mime or "other", "sourcing-report", summary, payload, tags
            )
        key = relative.casefold() if os.name == "nt" else relative
        result.setdefault(key, item)
    return list(result.values())


def _sourcing_report(path: str, name: str, state: Any) -> tuple[dict[str, Any], str] | None:
    if tool_name_base(name) != "write_file" or not path.startswith("outbound/选品报告-"):
        return None
    messages = (
        state.get("messages", []) if isinstance(state, Mapping) else getattr(state, "messages", [])
    )
    for message in reversed(messages):
        if isinstance(message, HumanMessage):
            break
        if (
            not isinstance(message, ToolMessage)
            or message.status == "error"
            or tool_name_base(message.name or "") != "run_breadth_research"
            or not isinstance(message.content, str)
        ):
            continue
        try:
            envelope = json.loads(message.content)
        except ValueError:
            continue
        if (
            not isinstance(envelope, dict)
            or envelope.get("status") != "completed"
            or envelope.get("filename") != path
        ):
            continue
        hint = envelope.get("octop_ui")
        if (
            not isinstance(hint, dict)
            or hint.get("renderer") != "sourcing_report"
            or hint.get("version") != 1
        ):
            continue
        data = message.artifact if envelope.get("data_ref") == "artifact" else envelope.get("data")
        if (
            isinstance(data, dict)
            and isinstance(data.get("candidates"), list)
            and isinstance(data.get("sources"), list)
        ):
            payload = {key: value for key, value in data.items() if key != "report_markdown"}
            return payload, str(envelope.get("summary") or "")[:4000]
    return None
