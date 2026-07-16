"""Tests for structured requirements scope normalization and validation."""

import json

from spec.requirements import (
    DEFAULT_NON_GOAL,
    SCOPE_CONTRACT_VERSION,
    create_requirements_from_task,
    normalize_requirements,
)
from spec.validate_pkg.validators.requirements_validator import RequirementsValidator


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
