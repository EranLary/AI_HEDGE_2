from __future__ import annotations

from typing import Literal
from uuid import UUID

Workspace = Literal["analysis", "nasdaq100"]

ANALYSIS_WORKSPACE: Workspace = "analysis"
NASDAQ100_WORKSPACE: Workspace = "nasdaq100"
VALID_WORKSPACES = frozenset({ANALYSIS_WORKSPACE, NASDAQ100_WORKSPACE})


def normalize_workspace(value: object) -> Workspace:
    normalized = str(value or ANALYSIS_WORKSPACE).strip().lower()
    if normalized not in VALID_WORKSPACES:
        raise ValueError(f"Unsupported workspace: {value!r}")
    return normalized  # type: ignore[return-value]


def normalize_workspace_release(
    workspace: object,
    release_id: object | None,
) -> tuple[Workspace, str | None]:
    normalized_workspace = normalize_workspace(workspace)
    raw_release = str(release_id or "").strip()
    normalized_release = str(UUID(raw_release)) if raw_release else None
    if normalized_workspace == NASDAQ100_WORKSPACE and not normalized_release:
        raise ValueError("release_id is required for nasdaq100 reports")
    if normalized_workspace == ANALYSIS_WORKSPACE and normalized_release:
        raise ValueError("analysis reports cannot have a release_id")
    return normalized_workspace, normalized_release
