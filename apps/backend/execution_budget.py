"""Task-level execution budgets for token-efficient autonomous runs.

Legacy tasks default to ``full`` so existing behaviour is preserved. New tasks
created by the desktop app explicitly opt into ``efficient`` mode.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

FULL_MAX_QA_ITERATIONS = 50


@dataclass(frozen=True)
class ExecutionBudget:
    """Resolved limits for one task execution."""

    mode: str
    max_subtasks: int | None
    max_agent_sessions: int | None
    max_qa_iterations: int
    max_spec_attempts: int
    use_ai_phase_summaries: bool
    include_optional_spec_phases: bool


_MODE_DEFAULTS = {
    "efficient": ExecutionBudget(
        mode="efficient",
        max_subtasks=6,
        max_agent_sessions=8,
        max_qa_iterations=2,
        max_spec_attempts=2,
        use_ai_phase_summaries=False,
        include_optional_spec_phases=False,
    ),
    "full": ExecutionBudget(
        mode="full",
        max_subtasks=None,
        max_agent_sessions=None,
        max_qa_iterations=FULL_MAX_QA_ITERATIONS,
        max_spec_attempts=3,
        use_ai_phase_summaries=True,
        include_optional_spec_phases=True,
    ),
}


def _load_metadata(spec_dir: Path) -> dict[str, Any]:
    metadata_path = Path(spec_dir) / "task_metadata.json"
    try:
        data = json.loads(metadata_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def _bounded_int(
    value: Any,
    default: int | None,
    *,
    minimum: int,
    maximum: int,
) -> int | None:
    if value is None:
        return default
    if isinstance(value, bool):
        return default
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return max(minimum, min(parsed, maximum))


def get_execution_budget(spec_dir: Path) -> ExecutionBudget:
    """Resolve an execution budget from ``task_metadata.json``.

    Numeric overrides are intentionally bounded to prevent invalid metadata
    from creating unbounded loops or disabling required validation entirely.
    """

    metadata = _load_metadata(spec_dir)
    mode = str(metadata.get("executionMode") or "full").lower()
    defaults = _MODE_DEFAULTS.get(mode, _MODE_DEFAULTS["full"])

    return ExecutionBudget(
        mode=defaults.mode,
        max_subtasks=_bounded_int(
            metadata.get("maxSubtasks"),
            defaults.max_subtasks,
            minimum=1,
            maximum=50,
        ),
        max_agent_sessions=_bounded_int(
            metadata.get("maxAgentSessions"),
            defaults.max_agent_sessions,
            minimum=1,
            maximum=100,
        ),
        max_qa_iterations=_bounded_int(
            metadata.get("maxQaIterations"),
            defaults.max_qa_iterations,
            minimum=1,
            maximum=FULL_MAX_QA_ITERATIONS,
        )
        or defaults.max_qa_iterations,
        max_spec_attempts=_bounded_int(
            metadata.get("maxSpecAttempts"),
            defaults.max_spec_attempts,
            minimum=1,
            maximum=3,
        )
        or defaults.max_spec_attempts,
        use_ai_phase_summaries=defaults.use_ai_phase_summaries,
        include_optional_spec_phases=defaults.include_optional_spec_phases,
    )


def get_max_subtasks(spec_dir: Path) -> int | None:
    """Return the task's subtask ceiling, if one is configured."""

    return get_execution_budget(spec_dir).max_subtasks
