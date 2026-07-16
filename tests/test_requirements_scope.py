"""Tests for structured requirements scope normalization and validation."""

import json

from spec.requirements import (
    DEFAULT_NON_GOAL,
    SCOPE_CONTRACT_VERSION,
    create_requirements_from_task,
    normalize_requirements,
)
from spec.validate_pkg.validators.requirements_validator import RequirementsValidator


TASK_DESCRIPTION = """Add a “Project Location” section to Project Settings → General.

Requirements:

- Display the selected project’s absolute path.
- Add “Copy Path” to copy it to the clipboard.
- Add “Open Folder” to open it in the operating system’s file manager.

Non-goals:

- Do not edit the project path.
- Do not add recent-folder history.

Acceptance criteria:

- AC-1: The correct absolute project path is displayed.
- AC-2: “Copy Path” copies the displayed path.
"""


def test_create_requirements_from_task_adds_conservative_scope():
    requirements = create_requirements_from_task("Add Azure DevOps integration")

    assert requirements["must_have"] == ["Add Azure DevOps integration"]
    assert requirements["scope_contract_version"] == SCOPE_CONTRACT_VERSION
    assert requirements["required_parity"] == []
    assert requirements["deferred"] == []
    assert requirements["reuse_existing"] == []
    assert requirements["non_goals"] == [DEFAULT_NON_GOAL]


def test_normalize_requirements_preserves_explicit_scope_and_imports_metadata_criteria():
    requirements = normalize_requirements(
        {
            "task_description": "Add provider",
            "must_have": ["Connect repository"],
            "non_goals": [],
        },
        acceptance_criteria=["Connection succeeds"],
    )

    assert requirements["must_have"] == ["Connect repository"]
    assert requirements["non_goals"] == []
    assert requirements["acceptance_criteria"] == ["Connection succeeds"]
    assert all(
        field in requirements
        for field in (
            "required_parity",
            "deferred",
            "reuse_existing",
            "constraints",
        )
    )


def test_requirements_validator_rejects_legacy_unstructured_file(tmp_path):
    (tmp_path / "requirements.json").write_text(
        json.dumps({"task_description": "Legacy task"}),
        encoding="utf-8",
    )

    result = RequirementsValidator(tmp_path).validate()

    assert result.valid is False
    assert any("must_have" in error for error in result.errors)


def test_requirements_validator_accepts_normalized_file(tmp_path):
    requirements = create_requirements_from_task("Scoped task")
    (tmp_path / "requirements.json").write_text(
        json.dumps(requirements),
        encoding="utf-8",
    )

    result = RequirementsValidator(tmp_path).validate()

    assert result.valid is True
    assert result.checkpoint == "requirements"


def test_normalize_extracts_scope_from_noninteractive_markdown_description():
    requirements = normalize_requirements(
        {
            "scope_contract_version": 1,
            "task_description": TASK_DESCRIPTION,
            "must_have": [TASK_DESCRIPTION],
            "required_parity": [],
            "deferred": [],
            "reuse_existing": [],
            "non_goals": [DEFAULT_NON_GOAL],
            "acceptance_criteria": [],
        }
    )

    assert requirements["must_have"] == [
        "Add a “Project Location” section to Project Settings → General.",
        "Display the selected project’s absolute path.",
        "Add “Copy Path” to copy it to the clipboard.",
        "Add “Open Folder” to open it in the operating system’s file manager.",
    ]
    assert requirements["non_goals"] == [
        "Do not edit the project path.",
        "Do not add recent-folder history.",
    ]
    assert requirements["acceptance_criteria"] == [
        "AC-1: The correct absolute project path is displayed.",
        "AC-2: “Copy Path” copies the displayed path.",
    ]


def test_normalize_preserves_explicit_scope_over_description_sections():
    requirements = normalize_requirements(
        {
            "task_description": TASK_DESCRIPTION,
            "must_have": ["Explicit must-have"],
            "non_goals": ["Explicit non-goal"],
            "acceptance_criteria": ["Explicit criterion"],
        }
    )

    assert requirements["must_have"] == ["Explicit must-have"]
    assert requirements["non_goals"] == ["Explicit non-goal"]
    assert requirements["acceptance_criteria"] == ["Explicit criterion"]
