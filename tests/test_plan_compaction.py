"""Tests for token-efficient implementation-plan compaction."""

from implementation_plan import (
    ImplementationPlan,
    Phase,
    Subtask,
    Verification,
    VerificationType,
)
from planner_lib.compaction import compact_plan


def _plan_with_subtasks(counts: list[int]) -> ImplementationPlan:
    return ImplementationPlan(
        feature="Efficient plan",
        phases=[
            Phase(
                phase=phase_index,
                name=f"Phase {phase_index}",
                subtasks=[
                    Subtask(
                        id=f"subtask-{phase_index}-{subtask_index}",
                        description=f"Change file {phase_index}-{subtask_index}",
                        service="backend",
                        files_to_modify=[f"file-{phase_index}-{subtask_index}.py"],
                    )
                    for subtask_index in range(1, count + 1)
                ],
            )
            for phase_index, count in enumerate(counts, start=1)
        ],
    )


def test_compacts_large_plan_to_requested_limit():
    source = _plan_with_subtasks([5, 4, 3])
    source.phases[0].parallel_safe = False
    source.phases[0].subtasks[0].acceptance_criteria_refs = ["AC-1"]
    source.phases[0].subtasks[1].acceptance_criteria_refs = ["AC-2"]
    source.phases[0].subtasks[0].verification = Verification(
        type=VerificationType.COMMAND,
        run="pytest tests/test_feature.py",
    )

    plan = compact_plan(source, 6)

    assert sum(len(phase.subtasks) for phase in plan.phases) == 6
    assert all(phase.subtasks for phase in plan.phases)
    merged_files = {
        path
        for phase in plan.phases
        for subtask in phase.subtasks
        for path in subtask.files_to_modify
    }
    assert len(merged_files) == 12
    assert plan.phases[0].parallel_safe is False
    assert plan.phases[0].subtasks[0].acceptance_criteria_refs == ["AC-1", "AC-2"]
    assert "run=pytest tests/test_feature.py" in (
        plan.phases[0].subtasks[0].verification.scenario or ""
    )


def test_does_not_change_plan_within_limit():
    plan = _plan_with_subtasks([2, 2])
    original_ids = [subtask.id for phase in plan.phases for subtask in phase.subtasks]

    compact_plan(plan, 6)

    assert [
        subtask.id for phase in plan.phases for subtask in phase.subtasks
    ] == original_ids


def test_full_mode_without_limit_does_not_compact():
    plan = _plan_with_subtasks([7])

    compact_plan(plan, None)

    assert len(plan.phases[0].subtasks) == 7
