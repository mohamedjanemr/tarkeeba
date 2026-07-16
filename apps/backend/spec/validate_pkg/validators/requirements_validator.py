"""
Requirements Validator
======================

Validates the structured requirements and MVP scope contract.
"""

import json
from pathlib import Path

from ..models import ValidationResult
from ..schemas import REQUIREMENTS_SCOPE_FIELDS


class RequirementsValidator:
    """Validate requirements.json and its structured scope fields."""

    def __init__(self, spec_dir: Path):
        self.spec_dir = Path(spec_dir)

    def validate(self) -> ValidationResult:
        errors = []
        warnings = []
        fixes = []
        requirements_file = self.spec_dir / "requirements.json"

        if not requirements_file.exists():
            errors.append("requirements.json not found")
            fixes.append("Create requirements.json before writing the spec")
            return ValidationResult(False, "requirements", errors, warnings, fixes)

        try:
            requirements = json.loads(requirements_file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError, UnicodeDecodeError) as exc:
            errors.append(f"requirements.json is invalid: {exc}")
            fixes.append("Repair requirements.json so it contains valid JSON")
            return ValidationResult(False, "requirements", errors, warnings, fixes)

        if not isinstance(requirements, dict):
            errors.append("requirements.json must contain a JSON object")
            fixes.append("Replace the root value with a requirements object")
            return ValidationResult(False, "requirements", errors, warnings, fixes)

        if not str(requirements.get("task_description") or "").strip():
            errors.append("Missing required field: task_description")
            fixes.append("Add a non-empty task_description")

        if requirements.get("scope_contract_version") not in (0, 1):
            errors.append("scope_contract_version must be 0 or 1")
            fixes.append("Set scope_contract_version to 1 for new tasks")

        for field in REQUIREMENTS_SCOPE_FIELDS:
            if field not in requirements:
                errors.append(f"Missing scope field: {field}")
                fixes.append(f"Add '{field}' as a JSON array")
            elif not isinstance(requirements[field], list) or not all(
                isinstance(item, str) and item.strip() for item in requirements[field]
            ):
                errors.append(f"Scope field '{field}' must be an array of strings")
                fixes.append(f"Normalize '{field}' to a JSON string array")

        if not requirements.get("must_have"):
            warnings.append("Scope field 'must_have' is empty")

        return ValidationResult(
            valid=len(errors) == 0,
            checkpoint="requirements",
            errors=errors,
            warnings=warnings,
            fixes=fixes,
        )
