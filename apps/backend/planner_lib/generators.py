"""
Plan generation logic for different workflow types.
"""

import re
from pathlib import Path

from execution_budget import get_max_subtasks
from implementation_plan import (
    ImplementationPlan,
    Phase,
    PhaseType,
    Subtask,
    SubtaskStatus,
    Verification,
    VerificationType,
    WorkflowType,
)

from .capabilities import group_files_into_capabilities
from .models import PlannerContext
from .utils import (
    create_verification,
    extract_acceptance_criteria,
    extract_feature_name,
    get_patterns_for_capability,
    infer_subtask_type,
)


class PlanGenerator:
    """Base class for plan generators."""

    def __init__(self, context: PlannerContext, spec_dir: Path):
        self.context = context
        self.spec_dir = spec_dir

    def generate(self) -> ImplementationPlan:
        """Generate implementation plan. Override in subclasses."""
        raise NotImplementedError

    def _acceptance_context(self) -> tuple[list[str], list[tuple[str, str]]]:
        criteria = extract_acceptance_criteria(self.context)
        acceptance_items = []
        for index, criterion in enumerate(criteria, start=1):
            explicit_ref = re.search(r"\bAC-\d+\b", criterion, re.IGNORECASE)
            ref = explicit_ref.group(0).upper() if explicit_ref else f"AC-{index}"
            acceptance_items.append((ref, criterion))
        return criteria, acceptance_items

    @staticmethod
    def _apply_acceptance_refs(
        phases: list[Phase], acceptance_items: list[tuple[str, str]]
    ) -> None:
        all_refs = [ref for ref, _ in acceptance_items]
        criterion_tokens = {
            ref: PlanGenerator._scope_tokens(criterion)
            for ref, criterion in acceptance_items
        }
        common_tokens = (
            set.intersection(*criterion_tokens.values())
            if len(criterion_tokens) > 1 and all(criterion_tokens.values())
            else set()
        )
        for phase in phases:
            for subtask in phase.subtasks:
                if subtask.acceptance_criteria_refs:
                    continue
                if phase.type == PhaseType.INTEGRATION:
                    subtask.acceptance_criteria_refs = list(all_refs)
                    continue

                subtask_text = " ".join(
                    [
                        subtask.description,
                        subtask.expected_output or "",
                        *subtask.files_to_modify,
                        *subtask.files_to_create,
                    ]
                )
                subtask_tokens = PlanGenerator._scope_tokens(subtask_text)
                matching_refs = [
                    ref
                    for ref, _ in acceptance_items
                    if (
                        len(acceptance_items) == 1
                        or subtask_tokens & (criterion_tokens[ref] - common_tokens)
                    )
                ]
                if not matching_refs and all_refs:
                    matching_refs = [
                        max(
                            all_refs,
                            key=lambda ref: len(subtask_tokens & criterion_tokens[ref]),
                        )
                    ]
                subtask.acceptance_criteria_refs = matching_refs

    @staticmethod
    def _scope_tokens(value: str) -> set[str]:
        stop_words = {
            "acceptance",
            "add",
            "build",
            "change",
            "criteria",
            "existing",
            "feature",
            "implementation",
            "implement",
            "provider",
            "task",
            "update",
            "user",
            "verify",
            "works",
        }
        tokens = set()
        for token in re.findall(r"[a-z0-9]+", value.lower()):
            if token.startswith("ac") and token[2:].isdigit():
                continue
            for suffix in ("ing", "ed", "es", "s"):
                if token.endswith(suffix) and len(token) > len(suffix) + 3:
                    token = token[: -len(suffix)]
                    break
            if len(token) > 2 and token not in stop_words:
                tokens.add(token)
        return tokens


class FeaturePlanGenerator(PlanGenerator):
    """Generates feature implementation plans."""

    def generate(self) -> ImplementationPlan:
        """Generate a feature implementation plan."""
        feature_name = extract_feature_name(self.context)
        final_acceptance, acceptance_items = self._acceptance_context()
        max_slices = get_max_subtasks(self.spec_dir) or 10
        planned_files = [
            *self.context.files_to_modify,
            *[
                {**file_info, "operation": "create"}
                for file_info in self.context.files_to_create
            ],
        ]
        capability_groups = group_files_into_capabilities(
            planned_files,
            max_slices=max_slices,
        )

        phases = []
        for phase_num, group in enumerate(capability_groups, start=1):
            paths_to_modify = []
            paths_to_create = []
            services = []
            reasons = []
            verification_steps = []

            for file_info in group.files:
                path = str(file_info.get("path", ""))
                operation = str(
                    file_info.get("operation")
                    or file_info.get("action")
                    or file_info.get("change_type")
                    or ""
                ).lower()
                if operation in {"add", "create", "new"}:
                    paths_to_create.append(path)
                else:
                    paths_to_modify.append(path)
                if file_info.get("service"):
                    services.append(str(file_info["service"]))
                if file_info.get("reason"):
                    reasons.append(str(file_info["reason"]))

                service = str(file_info.get("service") or "main")
                verification = create_verification(
                    self.context,
                    service,
                    infer_subtask_type(path),
                ).to_dict()
                if verification not in verification_steps:
                    verification_steps.append(verification)

            services = list(dict.fromkeys(services))
            reasons = list(dict.fromkeys(reasons))
            capability_text = " ".join(
                [
                    group.label,
                    group.description,
                    *reasons,
                    *paths_to_modify,
                    *paths_to_create,
                ]
            )
            description = group.description
            if reasons:
                description += " Outcomes: " + "; ".join(reasons)

            phase_type = (
                PhaseType.INTEGRATION
                if group.key == "integration"
                else PhaseType.IMPLEMENTATION
            )
            subtask = Subtask(
                id=(
                    "capability-"
                    + re.sub(r"[^a-z0-9]+", "-", group.key.lower()).strip("-")
                ),
                description=description,
                service=services[0] if len(services) == 1 else None,
                services=services if len(services) > 1 else [],
                all_services=len(services) > 1 or group.key == "integration",
                files_to_modify=paths_to_modify,
                files_to_create=paths_to_create,
                patterns_from=get_patterns_for_capability(
                    self.context,
                    capability_text,
                    services,
                ),
                verification=(
                    Verification(
                        type=VerificationType.BROWSER,
                        scenario=(
                            "All acceptance criteria work through shared entry points"
                        ),
                    )
                    if group.key == "integration"
                    else None
                ),
                verification_steps=verification_steps,
            )
            phases.append(
                Phase(
                    phase=phase_num,
                    name=group.label,
                    type=phase_type,
                    subtasks=[subtask],
                    depends_on=[phase_num - 1] if phase_num > 1 else [],
                    parallel_safe=False,
                )
            )

        self._apply_acceptance_refs(phases, acceptance_items)

        return ImplementationPlan(
            feature=feature_name,
            workflow_type=WorkflowType.FEATURE,
            services_involved=self.context.services_involved,
            phases=phases,
            final_acceptance=final_acceptance,
            spec_file=str(self.spec_dir / "spec.md"),
        )


class InvestigationPlanGenerator(PlanGenerator):
    """Generates investigation plans for debugging."""

    def generate(self) -> ImplementationPlan:
        """Generate an investigation plan for debugging."""
        feature_name = extract_feature_name(self.context)
        _, acceptance_items = self._acceptance_context()

        phases = [
            Phase(
                phase=1,
                name="Reproduce & Instrument",
                type=PhaseType.INVESTIGATION,
                subtasks=[
                    Subtask(
                        id="add-logging",
                        description="Add detailed logging around suspected problem areas",
                        expected_output="Logs capture relevant state changes and events",
                        files_to_modify=[
                            f.get("path", "") for f in self.context.files_to_modify[:3]
                        ],
                    ),
                    Subtask(
                        id="create-repro",
                        description="Create reliable reproduction steps",
                        expected_output="Can reproduce issue on demand with documented steps",
                    ),
                ],
            ),
            Phase(
                phase=2,
                name="Investigate & Analyze",
                type=PhaseType.INVESTIGATION,
                depends_on=[1],
                subtasks=[
                    Subtask(
                        id="analyze-logs",
                        description="Analyze logs from multiple reproductions",
                        expected_output="Pattern identified in when/how issue occurs",
                    ),
                    Subtask(
                        id="form-hypothesis",
                        description="Form and test hypotheses about root cause",
                        expected_output="Root cause identified with supporting evidence",
                    ),
                ],
            ),
            Phase(
                phase=3,
                name="Implement Fix",
                type=PhaseType.IMPLEMENTATION,
                depends_on=[2],
                subtasks=[
                    Subtask(
                        id="implement-fix",
                        description="[TO BE DETERMINED: Fix based on investigation findings]",
                        status=SubtaskStatus.BLOCKED,
                    ),
                    Subtask(
                        id="add-regression-test",
                        description="Add test to prevent issue from recurring",
                        status=SubtaskStatus.BLOCKED,
                    ),
                ],
            ),
            Phase(
                phase=4,
                name="Verify & Harden",
                type=PhaseType.INTEGRATION,
                depends_on=[3],
                subtasks=[
                    Subtask(
                        id="verify-fix",
                        description="Verify issue no longer occurs",
                        verification=Verification(
                            type=VerificationType.MANUAL,
                            scenario="Run reproduction steps - issue should not occur",
                        ),
                    ),
                    Subtask(
                        id="add-monitoring",
                        description="Add alerting/monitoring to catch if issue returns",
                    ),
                ],
            ),
        ]

        self._apply_acceptance_refs(phases, acceptance_items)

        return ImplementationPlan(
            feature=feature_name,
            workflow_type=WorkflowType.INVESTIGATION,
            services_involved=self.context.services_involved,
            phases=phases,
            final_acceptance=[
                "Issue no longer reproducible",
                "Root cause documented",
                "Regression test in place",
            ],
            spec_file=str(self.spec_dir / "spec.md"),
        )


class RefactorPlanGenerator(PlanGenerator):
    """Generates refactor plans with stage-based phases."""

    def generate(self) -> ImplementationPlan:
        """Generate a refactor plan with stage-based phases."""
        feature_name = extract_feature_name(self.context)
        _, acceptance_items = self._acceptance_context()

        # For refactors, stages are: Add new, Migrate, Remove old, Cleanup
        phases = [
            Phase(
                phase=1,
                name="Add New System",
                type=PhaseType.IMPLEMENTATION,
                subtasks=[
                    Subtask(
                        id="add-new-implementation",
                        description="Implement new system alongside existing",
                        files_to_modify=[
                            f.get("path", "") for f in self.context.files_to_modify
                        ],
                        patterns_from=[
                            f.get("path", "")
                            for f in self.context.files_to_reference[:3]
                        ],
                        verification=Verification(
                            type=VerificationType.COMMAND,
                            run="echo 'New system added - both old and new should work'",
                        ),
                    ),
                ],
            ),
            Phase(
                phase=2,
                name="Migrate Consumers",
                type=PhaseType.IMPLEMENTATION,
                depends_on=[1],
                subtasks=[
                    Subtask(
                        id="migrate-to-new",
                        description="Update consumers to use new system",
                        verification=Verification(
                            type=VerificationType.BROWSER,
                            scenario="All functionality works with new system",
                        ),
                    ),
                ],
            ),
            Phase(
                phase=3,
                name="Remove Old System",
                type=PhaseType.CLEANUP,
                depends_on=[2],
                subtasks=[
                    Subtask(
                        id="remove-old",
                        description="Remove old system code",
                        verification=Verification(
                            type=VerificationType.COMMAND,
                            run="echo 'Old system removed - verify no references remain'",
                        ),
                    ),
                ],
            ),
            Phase(
                phase=4,
                name="Polish",
                type=PhaseType.CLEANUP,
                depends_on=[3],
                subtasks=[
                    Subtask(
                        id="cleanup",
                        description="Final cleanup and documentation",
                    ),
                    Subtask(
                        id="verify-complete",
                        description="Verify refactor is complete",
                        verification=Verification(
                            type=VerificationType.BROWSER,
                            scenario="All functionality works, no regressions",
                        ),
                    ),
                ],
            ),
        ]

        self._apply_acceptance_refs(phases, acceptance_items)

        return ImplementationPlan(
            feature=feature_name,
            workflow_type=WorkflowType.REFACTOR,
            services_involved=self.context.services_involved,
            phases=phases,
            final_acceptance=[
                "All functionality migrated to new system",
                "Old system completely removed",
                "No regressions in existing features",
            ],
            spec_file=str(self.spec_dir / "spec.md"),
        )


def get_plan_generator(context: PlannerContext, spec_dir: Path) -> PlanGenerator:
    """Factory function to get the appropriate plan generator."""
    if context.workflow_type == WorkflowType.INVESTIGATION:
        return InvestigationPlanGenerator(context, spec_dir)
    elif context.workflow_type == WorkflowType.REFACTOR:
        return RefactorPlanGenerator(context, spec_dir)
    else:
        return FeaturePlanGenerator(context, spec_dir)
