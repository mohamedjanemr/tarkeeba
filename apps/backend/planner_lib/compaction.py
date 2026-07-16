"""Compact implementation plans into fewer vertical coding sessions."""

from __future__ import annotations

import math

from implementation_plan import (
    ImplementationPlan,
    Subtask,
    Verification,
    VerificationType,
)


def _unique(values: list[str]) -> list[str]:
    return list(dict.fromkeys(value for value in values if value))


def _merge_subtasks(subtasks: list[Subtask], group_number: int) -> Subtask:
    if len(subtasks) == 1:
        return subtasks[0]

    descriptions = [subtask.description.rstrip(".") for subtask in subtasks]
    services = {subtask.service for subtask in subtasks if subtask.service}
    verification_steps = [
        ", ".join(
            f"{key}={value}"
            for key, value in subtask.verification.to_dict().items()
            if key != "type"
        )
        or subtask.verification.type.value
        for subtask in subtasks
        if subtask.verification is not None
    ]

    return Subtask(
        id=f"{subtasks[0].id}-group-{group_number}",
        description="Complete this vertical implementation slice: "
        + "; ".join(descriptions),
        service=next(iter(services)) if len(services) == 1 else None,
        all_services=any(subtask.all_services for subtask in subtasks),
        files_to_modify=_unique(
            [path for subtask in subtasks for path in subtask.files_to_modify]
        ),
        files_to_create=_unique(
            [path for subtask in subtasks for path in subtask.files_to_create]
        ),
        patterns_from=_unique(
            [path for subtask in subtasks for path in subtask.patterns_from]
        ),
        verification=Verification(
            type=VerificationType.MANUAL,
            scenario=(
                "Verify every grouped change and its original checks: "
                + "; ".join(verification_steps)
            ),
        )
        if verification_steps
        else None,
        expected_output="; ".join(
            subtask.expected_output for subtask in subtasks if subtask.expected_output
        )
        or None,
    )


def compact_plan(
    plan: ImplementationPlan, max_subtasks: int | None
) -> ImplementationPlan:
    """Reduce a plan to ``max_subtasks`` while preserving phase boundaries.

    Subtasks within the same phase are combined into vertical slices. Keeping
    phase boundaries intact preserves the plan's dependency graph.
    """

    if max_subtasks is None:
        return plan

    populated_phases = [phase for phase in plan.phases if phase.subtasks]
    total = sum(len(phase.subtasks) for phase in populated_phases)
    if total <= max_subtasks:
        return plan

    if len(populated_phases) > max_subtasks:
        # The plan cannot be compacted safely without rewriting phase
        # dependencies. Leave it for validation to reject with a clear error.
        return plan

    target_counts = {id(phase): 1 for phase in populated_phases}
    remaining_slots = max_subtasks - len(populated_phases)

    # Give extra slots to the phases with the largest unallocated workload.
    while remaining_slots > 0:
        candidates = [
            phase
            for phase in populated_phases
            if target_counts[id(phase)] < len(phase.subtasks)
        ]
        if not candidates:
            break
        phase = max(
            candidates,
            key=lambda item: len(item.subtasks) / target_counts[id(item)],
        )
        target_counts[id(phase)] += 1
        remaining_slots -= 1

    for phase in populated_phases:
        target = target_counts[id(phase)]
        original = phase.subtasks
        chunk_size = math.ceil(len(original) / target)
        groups = [
            original[index : index + chunk_size]
            for index in range(0, len(original), chunk_size)
        ]
        phase.subtasks = [
            _merge_subtasks(group, group_number)
            for group_number, group in enumerate(groups, start=1)
        ]

    return plan
