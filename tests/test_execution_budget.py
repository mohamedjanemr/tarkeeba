"""Tests for task-level execution budgets."""

import json

from execution_budget import FULL_MAX_QA_ITERATIONS, get_execution_budget


def test_legacy_task_preserves_full_autonomous_defaults(tmp_path):
    budget = get_execution_budget(tmp_path)

    assert budget.mode == "full"
    assert budget.max_subtasks is None
    assert budget.max_agent_sessions is None
    assert budget.max_qa_iterations == FULL_MAX_QA_ITERATIONS
    assert budget.max_spec_attempts == 3
    assert budget.use_ai_phase_summaries is True
    assert budget.include_optional_spec_phases is True


def test_efficient_mode_uses_bounded_defaults(tmp_path):
    (tmp_path / "task_metadata.json").write_text(
        json.dumps({"executionMode": "efficient"}), encoding="utf-8"
    )

    budget = get_execution_budget(tmp_path)

    assert budget.mode == "efficient"
    assert budget.max_subtasks == 6
    assert budget.max_agent_sessions == 8
    assert budget.max_qa_iterations == 2
    assert budget.max_spec_attempts == 2
    assert budget.use_ai_phase_summaries is False
    assert budget.include_optional_spec_phases is False


def test_overrides_are_bounded_and_invalid_values_fall_back(tmp_path):
    (tmp_path / "task_metadata.json").write_text(
        json.dumps(
            {
                "executionMode": "efficient",
                "maxSubtasks": 0,
                "maxAgentSessions": 500,
                "maxQaIterations": "invalid",
                "maxSpecAttempts": 9,
            }
        ),
        encoding="utf-8",
    )

    budget = get_execution_budget(tmp_path)

    assert budget.max_subtasks == 1
    assert budget.max_agent_sessions == 100
    assert budget.max_qa_iterations == 2
    assert budget.max_spec_attempts == 3


def test_unknown_mode_falls_back_to_full(tmp_path):
    (tmp_path / "task_metadata.json").write_text(
        json.dumps({"executionMode": "future-mode"}), encoding="utf-8"
    )

    assert get_execution_budget(tmp_path).mode == "full"
