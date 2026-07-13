"""Focused tests for the Codex MVP pipeline runner."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).parent.parent / "apps" / "backend"
sys.path.insert(0, str(BACKEND_DIR))

from runners.codex_runner import (
    DEFAULT_CODEX_MODEL,
    _build_prompt,
    _item_summary,
    _metadata_config,
    _prepare_workspace,
    _qa_prompt,
    _spec_prompt,
)


def test_metadata_config_defaults(tmp_path: Path) -> None:
    assert _metadata_config(tmp_path) == (DEFAULT_CODEX_MODEL, "high")


def test_metadata_config_reads_codex_settings(tmp_path: Path) -> None:
    (tmp_path / "task_metadata.json").write_text(
        json.dumps(
            {
                "provider": "codex",
                "codexModel": "gpt-5.4",
                "codexReasoningEffort": "xhigh",
            }
        ),
        encoding="utf-8",
    )
    assert _metadata_config(tmp_path) == ("gpt-5.4", "xhigh")


def test_metadata_config_sanitizes_unknown_effort(tmp_path: Path) -> None:
    (tmp_path / "task_metadata.json").write_text(
        json.dumps({"codexReasoningEffort": "maximum"}), encoding="utf-8"
    )
    assert _metadata_config(tmp_path)[1] == "high"


@pytest.mark.parametrize(
    ("item", "expected"),
    [
        ({"type": "agent_message", "text": "Done"}, "Done"),
        ({"type": "command_execution", "command": "npm test"}, "[Codex command] npm test"),
        ({"type": "file_change", "changes": [{}, {}]}, "[Codex files] 2 change(s)"),
        ({"type": "reasoning", "text": "hidden"}, None),
    ],
)
def test_item_summary(item: dict, expected: str | None) -> None:
    assert _item_summary(item) == expected


def test_prompts_preserve_pipeline_contracts(tmp_path: Path) -> None:
    project_dir = tmp_path / "project"
    spec_dir = project_dir / ".auto-claude" / "specs" / "001-task"

    spec_prompt = _spec_prompt(project_dir, spec_dir, "Build feature")
    assert "implementation_plan.json" in spec_prompt
    assert "Do not implement code" in spec_prompt

    build_prompt = _build_prompt(project_dir, spec_dir)
    assert "Implement the complete plan" in build_prompt
    assert "update each subtask status" in build_prompt

    qa_prompt = _qa_prompt(project_dir, spec_dir)
    assert "qa_report.md" in qa_prompt
    assert '"qa_signoff"' in qa_prompt


def test_prepare_workspace_respects_direct_mode(tmp_path: Path) -> None:
    project_dir = tmp_path / "project"
    spec_dir = project_dir / ".auto-claude" / "specs" / "001-task"
    spec_dir.mkdir(parents=True)
    (spec_dir / "task_metadata.json").write_text(
        json.dumps({"useWorktree": False}), encoding="utf-8"
    )

    working_dir, localized_spec_dir = _prepare_workspace(project_dir, spec_dir)
    assert working_dir == project_dir
    assert localized_spec_dir == spec_dir
