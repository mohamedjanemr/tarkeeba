"""End-to-end tests for deterministic capability-slice planning."""

import json

from implementation_plan import WorkflowType
from planner_lib.generators import FeaturePlanGenerator
from planner_lib.models import PlannerContext
from spec.requirements import create_requirements_from_task
from spec.validate_pkg.validators.implementation_plan_validator import (
    ImplementationPlanValidator,
)


def _capability_files() -> list[dict]:
    groups = {
        "connection": [
            "apps/backend/azure/auth.py",
            "apps/backend/azure/config.py",
            "apps/frontend/settings/AzureForm.tsx",
            "apps/frontend/settings/azure-store.ts",
            "tests/test_azure_connection.py",
        ],
        "repositories": [
            "apps/backend/azure/repositories.py",
            "apps/backend/api/azure_repositories.py",
            "apps/frontend/api/azure-repositories.ts",
            "apps/frontend/components/RepositoryPicker.tsx",
            "tests/test_azure_repositories.py",
        ],
        "pull requests": [
            "apps/backend/azure/pull_requests.py",
            "apps/backend/review/azure_review.py",
            "apps/frontend/api/azure-pull-requests.ts",
            "apps/frontend/components/PullRequestList.tsx",
            "tests/test_azure_pull_requests.py",
        ],
        "work items": [
            "apps/backend/azure/work_items.py",
            "apps/backend/api/azure_work_items.py",
            "apps/frontend/api/azure-work-items.ts",
            "apps/frontend/components/WorkItemList.tsx",
            "tests/test_azure_work_items.py",
        ],
        "pipelines": [
            "apps/backend/azure/pipelines.py",
            "apps/backend/api/azure_pipelines.py",
            "apps/frontend/api/azure-pipelines.ts",
            "apps/frontend/components/PipelineList.tsx",
            "tests/test_azure_pipelines.py",
        ],
    }
    files = []
    for reason, paths in groups.items():
        for path in paths:
            files.append(
                {
                    "path": path,
                    "service": "frontend" if "frontend" in path else "backend",
                    "reason": f"Deliver Azure DevOps {reason}",
                }
            )
    files.extend(
        {
            "path": path,
            "service": "frontend",
            "reason": "Register shared Azure DevOps entry points",
        }
        for path in (
            "apps/frontend/ipc/index.ts",
            "apps/frontend/preload.ts",
            "apps/frontend/navigation.ts",
            "apps/frontend/i18n.ts",
            "apps/frontend/routes.ts",
        )
    )
    return files


def test_azure_class_task_becomes_six_valid_capability_slices(tmp_path):
    (tmp_path / "task_metadata.json").write_text(
        json.dumps({"executionMode": "efficient", "maxSubtasks": 6}),
        encoding="utf-8",
    )
    requirements = create_requirements_from_task("Add Azure DevOps integration")
    (tmp_path / "requirements.json").write_text(
        json.dumps(requirements),
        encoding="utf-8",
    )
    criteria = [
        "AC-1: Azure DevOps connection settings work",
        "AC-2: Azure DevOps repositories are available",
        "AC-3: Azure DevOps pull requests can be reviewed",
        "AC-4: Azure DevOps work items are visible",
        "AC-5: Azure DevOps pipelines are visible",
        "AC-6: Shared Azure DevOps entry points work",
    ]
    spec = "## Success Criteria\n" + "\n".join(
        f"- [ ] **{criterion.split(':', 1)[0]}**:{criterion.split(':', 1)[1]}"
        for criterion in criteria
    )
    (tmp_path / "spec.md").write_text(spec, encoding="utf-8")
    context = PlannerContext(
        spec_content="# Specification: Azure DevOps\n" + spec,
        project_index={
            "services": {
                "backend": {"path": "apps/backend", "type": "backend"},
                "frontend": {
                    "path": "apps/frontend",
                    "type": "frontend",
                    "port": 3000,
                },
            }
        },
        task_context={},
        services_involved=["backend", "frontend"],
        workflow_type=WorkflowType.FEATURE,
        files_to_modify=_capability_files(),
        files_to_reference=[],
    )

    plan = FeaturePlanGenerator(context, tmp_path).generate()
    plan.save(tmp_path / "implementation_plan.json")

    assert len(plan.phases) == 6
    assert sum(len(phase.subtasks) for phase in plan.phases) == 6
    assert all(len(phase.subtasks[0].files_to_modify) > 1 for phase in plan.phases)
    assert plan.phases[-1].type.value == "integration"
    owned_paths = [
        path
        for phase in plan.phases
        for subtask in phase.subtasks
        for path in subtask.files_to_modify
    ]
    assert len(owned_paths) == len(set(owned_paths)) == 30
    assert ImplementationPlanValidator(tmp_path).validate().valid is True


def test_plan_includes_created_files_and_always_maps_acceptance_refs(tmp_path):
    (tmp_path / "task_metadata.json").write_text(
        json.dumps({"executionMode": "efficient", "maxSubtasks": 6}),
        encoding="utf-8",
    )
    requirements = create_requirements_from_task("Add provider integration")
    (tmp_path / "requirements.json").write_text(
        json.dumps(requirements),
        encoding="utf-8",
    )
    spec = (
        "## Success Criteria\n"
        "- [ ] **AC-1**: Users can connect their account\n"
        "- [ ] **AC-2**: Administrators see a health indicator\n"
    )
    (tmp_path / "spec.md").write_text(spec, encoding="utf-8")
    context = PlannerContext(
        spec_content="# Provider\n" + spec,
        project_index={},
        task_context={},
        services_involved=["backend", "frontend"],
        workflow_type=WorkflowType.FEATURE,
        files_to_modify=[
            {"path": "src/auth.py", "service": "backend"},
            {"path": "src/models/foo.py", "service": "backend"},
        ],
        files_to_reference=[],
        files_to_create=[{"path": "src/ui/HealthCard.tsx", "service": "frontend"}],
    )

    plan = FeaturePlanGenerator(context, tmp_path).generate()
    subtasks = [subtask for phase in plan.phases for subtask in phase.subtasks]

    assert any(
        "src/ui/HealthCard.tsx" in subtask.files_to_create for subtask in subtasks
    )
    assert all(subtask.acceptance_criteria_refs for subtask in subtasks)
