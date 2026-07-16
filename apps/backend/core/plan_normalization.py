"""
Implementation Plan Normalization Utilities
===========================================

Small helpers for normalizing common LLM/legacy field variants in
implementation_plan.json without changing status semantics.
"""

from typing import Any


def normalize_plan_summary(plan: dict[str, Any]) -> bool:
    """Synchronize display-only summary counts with executable plan arrays."""

    phases = plan.get("phases", [])
    if not isinstance(phases, list):
        phases = []

    total_phases = len(phases)
    total_subtasks = sum(
        len(phase.get("subtasks", []))
        for phase in phases
        if isinstance(phase, dict) and isinstance(phase.get("subtasks", []), list)
    )

    summary = plan.get("summary")
    if not isinstance(summary, dict):
        return False

    changed = False
    if summary.get("total_phases") != total_phases:
        summary["total_phases"] = total_phases
        changed = True
    if summary.get("total_subtasks") != total_subtasks:
        summary["total_subtasks"] = total_subtasks
        changed = True
    return changed


def normalize_subtask_aliases(subtask: dict[str, Any]) -> tuple[dict[str, Any], bool]:
    """Normalize common subtask field aliases.

    - If `id` is missing and `subtask_id` exists, copy it into `id` as a string.
    - If `description` is missing/empty and `title` is a non-empty string, copy it
      into `description`.
    """

    normalized = dict(subtask)
    changed = False

    id_value = normalized.get("id")
    id_missing = (
        "id" not in normalized
        or id_value is None
        or (isinstance(id_value, str) and not id_value.strip())
    )
    if id_missing and "subtask_id" in normalized:
        subtask_id = normalized.get("subtask_id")
        if subtask_id is not None:
            subtask_id_str = str(subtask_id).strip()
            if subtask_id_str:
                normalized["id"] = subtask_id_str
                changed = True

    description_value = normalized.get("description")
    description_missing = (
        "description" not in normalized
        or description_value is None
        or (isinstance(description_value, str) and not description_value.strip())
    )
    title = normalized.get("title")
    if description_missing and isinstance(title, str):
        title_str = title.strip()
        if title_str:
            normalized["description"] = title_str
            changed = True

    return normalized, changed
