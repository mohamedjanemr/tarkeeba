"""Compact implementation plans into fewer vertical coding sessions."""

from __future__ import annotations

import math

from implementation_plan import (
    ImplementationPlan,
    Phase,
    PhaseType,
    Subtask,
    SubtaskStatus,
)


def _unique(values: list[str]) -> list[str]:
    return list(dict.fromkeys(value for value in values if value))


def _merge_subtasks(subtasks: list[Subtask], group_number: int) -> Subtask:
    if len(subtasks) == 1:
        return subtasks[0]

    descriptions = [subtask.description.rstrip(".") for subtask in subtasks]
    services = {subtask.service for subtask in subtasks if subtask.service}
    slice_services = _unique(
        [
            service
            for subtask in subtasks
            for service in ([subtask.service] if subtask.service else subtask.services)
        ]
    )
    verification_steps = []
    for subtask in subtasks:
        verification_steps.extend(subtask.verification_steps)
        if subtask.verification is not None:
            verification_steps.append(subtask.verification.to_dict())

    statuses = {subtask.status for subtask in subtasks}

    return Subtask(
        id=f"{subtasks[0].id}-group-{group_number}",
        description="Complete this vertical implementation slice: "
        + "; ".join(descriptions),
        service=next(iter(services)) if len(services) == 1 else None,
        services=slice_services if len(slice_services) > 1 else [],
        all_services=any(subtask.all_services for subtask in subtasks)
        or len(slice_services) > 1,
        files_to_modify=_unique(
            [path for subtask in subtasks for path in subtask.files_to_modify]
        ),
        files_to_create=_unique(
            [path for subtask in subtasks for path in subtask.files_to_create]
        ),
        patterns_from=_unique(
            [path for subtask in subtasks for path in subtask.patterns_from]
        ),
        acceptance_criteria_refs=_unique(
            [
                criterion
                for subtask in subtasks
                for criterion in subtask.acceptance_criteria_refs
            ]
        ),
        verification_steps=verification_steps,
        expected_output="; ".join(
            subtask.expected_output for subtask in subtasks if subtask.expected_output
        )
        or None,
        status=next(iter(statuses)) if len(statuses) == 1 else SubtaskStatus.PENDING,
    )


def _partition(items: list, count: int) -> list[list]:
    """Split items into ``count`` stable, non-empty contiguous groups."""
    return [
        items[index * len(items) // count : (index + 1) * len(items) // count]
        for index in range(count)
    ]


def _compact_phases(plan: ImplementationPlan, max_subtasks: int) -> None:
    """Collapse an oversized initial phase graph into conservative slices."""
    populated = [phase for phase in plan.phases if phase.subtasks]
    if len(populated) <= max_subtasks:
        return

    integration_phase = (
        populated[-1] if populated[-1].type == PhaseType.INTEGRATION else None
    )
    regular_phases = populated[:-1] if integration_phase else populated
    regular_slots = max_subtasks - (1 if integration_phase else 0)
    if regular_slots < 1:
        regular_slots = 1
        integration_phase = None
        regular_phases = populated

    phase_groups = _partition(regular_phases, min(regular_slots, len(regular_phases)))
    if integration_phase:
        phase_groups.append([integration_phase])

    compacted = []
    for index, phase_group in enumerate(phase_groups, start=1):
        subtasks = [subtask for phase in phase_group for subtask in phase.subtasks]
        phase_type = (
            PhaseType.INTEGRATION
            if any(phase.type == PhaseType.INTEGRATION for phase in phase_group)
            else PhaseType.IMPLEMENTATION
        )
        compacted.append(
            Phase(
                phase=index,
                name=(
                    phase_group[0].name
                    if len(phase_group) == 1
                    else "Capability Slice: "
                    + " / ".join(phase.name for phase in phase_group)
                ),
                type=phase_type,
                subtasks=[_merge_subtasks(subtasks, index)],
                depends_on=[index - 1] if index > 1 else [],
                parallel_safe=False,
            )
        )
    plan.phases = compacted


def compact_plan(
    plan: ImplementationPlan, max_subtasks: int | None
) -> ImplementationPlan:
    """Reduce a plan to ``max_subtasks`` using conservative capability slices.

    Subtasks within a phase are compacted first. If the phase count itself
    exceeds the cap, adjacent phases are grouped and serialized so executable
    checkpoints remain bounded without inventing parallel ownership.
    """

    if max_subtasks is None:
        return plan

    populated_phases = [phase for phase in plan.phases if phase.subtasks]
    pending = [
        subtask
        for phase in populated_phases
        for subtask in phase.subtasks
        if subtask.status == SubtaskStatus.PENDING
    ]
    total = len(pending)
    if total <= max_subtasks:
        return plan

    if any(
        subtask.status != SubtaskStatus.PENDING
        for phase in populated_phases
        for subtask in phase.subtasks
    ):
        # Never rewrite checkpoints or retry state in an active/follow-up plan.
        return plan

    _compact_phases(plan, max_subtasks)
    populated_phases = [phase for phase in plan.phases if phase.subtasks]
    if sum(len(phase.subtasks) for phase in populated_phases) <= max_subtasks:
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
