"""Tests for implementation plan acceptance-criteria traceability."""

import json

from implementation_plan import WorkflowType
from planner_lib.generators import FeaturePlanGenerator
from planner_lib.models import PlannerContext
from spec.requirements import create_requirements_from_task
from spec.validate_pkg.validators.implementation_plan_validator import (
    ImplementationPlanValidator,
)


def _write_scope_files(tmp_path, *, parity_row="| N/A | N/A | N/A |"):
    requirements = create_requirements_from_task("Add provider")
    if "required" in parity_row:
        requirements["required_parity"] = ["Pull request listing"]
    (tmp_path / "requirements.json").write_text(
        json.dumps(requirements),
        encoding="utf-8",
    )
    (tmp_path / "spec.md").write_text(
        f"""## Overview
Provider.
## Workflow Type
Feature
## Task Scope
Provider.
## MVP Boundary
### Must Have
- Add provider
### Required Parity
- Pull request listing
### Reuse Existing
- N/A
### Deferred
- N/A
### Non-Goals
- N/A
## Parity Matrix
| Capability | Disposition | Driving Acceptance Criterion |
|------------|-------------|------------------------------|
{parity_row}
## Success Criteria
- [ ] **AC-1**: Provider connects
- [ ] **AC-2**: Pull requests are listed
""",
        encoding="utf-8",
    )


def _write_plan(tmp_path, refs):
    plan = {
        "feature": "Provider",
        "workflow_type": "feature",
        "phases": [
            {
                "phase": 1,
                "name": "Implementation",
                "subtasks": [
                    {
                        "id": "provider",
                        "description": "Implement provider",
                        "status": "pending",
                        "acceptance_criteria_refs": refs,
                    }
                ],
            }
        ],
    }
    (tmp_path / "implementation_plan.json").write_text(
        json.dumps(plan),
        encoding="utf-8",
    )


def test_structured_plan_requires_acceptance_refs(tmp_path):
    _write_scope_files(tmp_path)
    _write_plan(tmp_path, [])

    result = ImplementationPlanValidator(tmp_path).validate()

    assert result.valid is False
    assert any("missing acceptance_criteria_refs" in error for error in result.errors)


def test_plan_rejects_unknown_acceptance_ref(tmp_path):
    _write_scope_files(tmp_path)
    _write_plan(tmp_path, ["AC-99"])

    result = ImplementationPlanValidator(tmp_path).validate()

    assert result.valid is False
    assert any("unknown acceptance" in error.lower() for error in result.errors)


def test_required_parity_must_be_cited_by_a_subtask(tmp_path):
    _write_scope_files(
        tmp_path,
        parity_row="| Pull request listing | required | AC-2 |",
    )
    _write_plan(tmp_path, ["AC-1"])

    result = ImplementationPlanValidator(tmp_path).validate()

    assert result.valid is False
    assert any("Required parity criteria" in error for error in result.errors)


def test_valid_scope_refs_pass(tmp_path):
    _write_scope_files(
        tmp_path,
        parity_row="| Pull request listing | required | AC-2 |",
    )
    _write_plan(tmp_path, ["AC-1", "AC-2"])

    result = ImplementationPlanValidator(tmp_path).validate()

    assert result.valid is True


def test_deferred_scope_cannot_become_a_subtask(tmp_path):
    _write_scope_files(tmp_path)
    requirements = json.loads(
        (tmp_path / "requirements.json").read_text(encoding="utf-8")
    )
    requirements["deferred"] = ["Pipeline management"]
    (tmp_path / "requirements.json").write_text(
        json.dumps(requirements),
        encoding="utf-8",
    )
    _write_plan(tmp_path, ["AC-1"])
    plan = json.loads(
        (tmp_path / "implementation_plan.json").read_text(encoding="utf-8")
    )
    plan["phases"][0]["subtasks"][0]["description"] = "Add pipeline management"
    (tmp_path / "implementation_plan.json").write_text(
        json.dumps(plan),
        encoding="utf-8",
    )

    result = ImplementationPlanValidator(tmp_path).validate()

    assert result.valid is False
    assert any("implements deferred scope item" in error for error in result.errors)


def test_deterministic_generator_adds_acceptance_refs(tmp_path):
    context = PlannerContext(
        spec_content="""# Specification: Provider
## Success Criteria
- [ ] **AC-1**: Repository connection succeeds
- [ ] **AC-2**: Provider lists pull requests
""",
        project_index={
            "services": {"backend": {"path": "apps/backend", "type": "backend"}}
        },
        task_context={},
        services_involved=["backend"],
        workflow_type=WorkflowType.FEATURE,
        files_to_modify=[
            {
                "path": "apps/backend/repository_connection.py",
                "service": "backend",
                "reason": "Implement repository connection",
            }
        ],
        files_to_reference=[],
    )

    plan = FeaturePlanGenerator(context, tmp_path).generate()

    assert plan.final_acceptance == [
        "**AC-1**: Repository connection succeeds",
        "**AC-2**: Provider lists pull requests",
    ]
    assert plan.phases[0].subtasks[0].acceptance_criteria_refs == ["AC-1"]
