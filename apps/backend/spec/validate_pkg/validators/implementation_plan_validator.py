"""
Implementation Plan Validator
==============================

Validates implementation_plan.json structure, phases, subtasks, and dependencies.
"""

import json
import re
from pathlib import Path

from execution_budget import get_max_subtasks
from planner_lib.capabilities import is_shared_registry_path

from ..models import ValidationResult
from ..schemas import IMPLEMENTATION_PLAN_SCHEMA, REQUIREMENTS_SCOPE_FIELDS


class ImplementationPlanValidator:
    """Validates implementation_plan.json exists and has valid schema."""

    def __init__(self, spec_dir: Path):
        """Initialize the implementation plan validator.

        Args:
            spec_dir: Path to the spec directory
        """
        self.spec_dir = Path(spec_dir)

    def validate(self) -> ValidationResult:
        """Validate implementation_plan.json exists and has valid schema.

        Returns:
            ValidationResult with errors, warnings, and suggested fixes
        """
        errors = []
        warnings = []
        fixes = []

        plan_file = self.spec_dir / "implementation_plan.json"

        if not plan_file.exists():
            errors.append("implementation_plan.json not found")
            fixes.append(f"Run: python -m planner_lib.main --spec-dir {self.spec_dir}")
            return ValidationResult(False, "plan", errors, warnings, fixes)

        try:
            with open(plan_file, encoding="utf-8") as f:
                plan = json.load(f)
        except json.JSONDecodeError as e:
            errors.append(f"implementation_plan.json is invalid JSON: {e}")
            fixes.append(
                "Regenerate with: python -m planner_lib.main --spec-dir "
                + str(self.spec_dir)
            )
            return ValidationResult(False, "plan", errors, warnings, fixes)

        # Validate top-level required fields
        schema = IMPLEMENTATION_PLAN_SCHEMA
        for field in schema["required_fields"]:
            if field not in plan:
                errors.append(f"Missing required field: {field}")
                fixes.append(f"Add '{field}' to implementation_plan.json")

        # Validate workflow_type
        if "workflow_type" in plan:
            if plan["workflow_type"] not in schema["workflow_types"]:
                errors.append(f"Invalid workflow_type: {plan['workflow_type']}")
                fixes.append(f"Use one of: {schema['workflow_types']}")

        # Validate phases
        phases = plan.get("phases", [])
        if not phases:
            errors.append("No phases defined")
            fixes.append("Add at least one phase with subtasks")
        else:
            for i, phase in enumerate(phases):
                phase_errors = self._validate_phase(phase, i)
                errors.extend(phase_errors)

        # Check for at least one subtask
        total_subtasks = sum(len(p.get("subtasks", [])) for p in phases)
        if total_subtasks == 0:
            errors.append("No subtasks defined in any phase")
            fixes.append("Add subtasks to phases")

        scope_errors, scope_fixes = self._validate_scope_traceability(phases)
        errors.extend(scope_errors)
        fixes.extend(scope_fixes)

        summary = plan.get("summary")
        if isinstance(summary, dict):
            if "total_phases" in summary and summary.get("total_phases") != len(phases):
                warnings.append(
                    "summary.total_phases does not match the phase array; "
                    "the phase array is authoritative"
                )
            if (
                "total_subtasks" in summary
                and summary.get("total_subtasks") != total_subtasks
            ):
                warnings.append(
                    "summary.total_subtasks does not match the phase arrays; "
                    "the phase arrays are authoritative"
                )

        remaining_subtasks = sum(
            1
            for phase in phases
            for subtask in phase.get("subtasks", [])
            if subtask.get("status", "pending") == "pending"
        )
        max_subtasks = get_max_subtasks(self.spec_dir)
        if max_subtasks is not None and remaining_subtasks > max_subtasks:
            errors.append(
                f"Plan has {remaining_subtasks} remaining subtasks; efficient "
                f"execution allows at most {max_subtasks}"
            )
            fixes.append(
                "Combine related file-level steps into vertical implementation slices"
            )

        # Validate dependencies don't create cycles
        dep_errors = self._validate_dependencies(phases)
        errors.extend(dep_errors)
        ownership_errors, ownership_fixes = self._validate_file_ownership(phases)
        errors.extend(ownership_errors)
        fixes.extend(ownership_fixes)

        return ValidationResult(
            valid=len(errors) == 0,
            checkpoint="plan",
            errors=errors,
            warnings=warnings,
            fixes=fixes,
        )

    def _validate_scope_traceability(
        self, phases: list[dict]
    ) -> tuple[list[str], list[str]]:
        """Require structured plans to trace implementation slices to AC-N criteria."""
        requirements_file = self.spec_dir / "requirements.json"
        spec_file = self.spec_dir / "spec.md"
        try:
            requirements = json.loads(requirements_file.read_text(encoding="utf-8"))
            spec_content = spec_file.read_text(encoding="utf-8")
        except (OSError, json.JSONDecodeError, UnicodeDecodeError):
            return [], []

        if (
            not isinstance(requirements, dict)
            or requirements.get("scope_contract_version") != 1
            or not all(field in requirements for field in REQUIREMENTS_SCOPE_FIELDS)
        ):
            return [], []

        success_match = re.search(
            r"^##?\s+Success Criteria\s*$"
            r"(?P<body>.*?)(?=^##?\s+|\Z)",
            spec_content,
            re.MULTILINE | re.IGNORECASE | re.DOTALL,
        )
        success_content = success_match.group("body") if success_match else ""
        valid_refs = {
            match.upper()
            for match in re.findall(r"\bAC-\d+\b", success_content, re.IGNORECASE)
        }
        if not valid_refs:
            return (
                ["Structured scope requires AC-N identifiers in spec.md"],
                ["Label Success Criteria as AC-1, AC-2, and so on"],
            )

        errors = []
        fixes = []
        cited_refs = set()
        excluded_scope = [
            (field, str(item))
            for field in ("deferred", "non_goals")
            for item in requirements.get(field, [])
            if str(item).strip()
        ]
        for phase_index, phase in enumerate(phases, start=1):
            for subtask_index, subtask in enumerate(phase.get("subtasks", []), start=1):
                refs = subtask.get("acceptance_criteria_refs", [])
                location = f"Phase {phase_index}, Subtask {subtask_index}"
                subtask_scope_text = " ".join(
                    [
                        str(subtask.get("description", "")),
                        *[str(path) for path in subtask.get("files_to_modify", [])],
                        *[str(path) for path in subtask.get("files_to_create", [])],
                    ]
                ).lower()
                for field, excluded_item in excluded_scope:
                    if excluded_item.lower() in subtask_scope_text:
                        errors.append(
                            f"{location}: implements {field} scope item "
                            f"'{excluded_item}'"
                        )
                        fixes.append(
                            f"{location}: remove '{excluded_item}' from implementation "
                            "scope or move it into must_have"
                        )
                if not isinstance(refs, list) or not refs:
                    errors.append(f"{location}: missing acceptance_criteria_refs")
                    fixes.append(
                        f"{location}: cite at least one AC-N success criterion"
                    )
                    continue
                normalized_refs = {
                    str(ref).strip().upper() for ref in refs if str(ref).strip()
                }
                unknown_refs = normalized_refs - valid_refs
                if unknown_refs:
                    errors.append(
                        f"{location}: unknown acceptance criteria references: "
                        f"{sorted(unknown_refs)}"
                    )
                    fixes.append(
                        f"{location}: use only AC-N identifiers defined in spec.md"
                    )
                cited_refs.update(normalized_refs & valid_refs)

        required_parity_refs = set()
        parity_section = re.split(
            r"^##?\s+Parity Matrix\s*$",
            spec_content,
            maxsplit=1,
            flags=re.MULTILINE | re.IGNORECASE,
        )
        if len(parity_section) == 2:
            for row in parity_section[1].splitlines():
                if re.search(r"\|\s*required\s*\|", row, re.IGNORECASE):
                    required_parity_refs.update(
                        match.upper()
                        for match in re.findall(r"\bAC-\d+\b", row, re.IGNORECASE)
                    )

        uncited_parity = required_parity_refs - cited_refs
        if uncited_parity:
            errors.append(
                "Required parity criteria are not cited by any subtask: "
                f"{sorted(uncited_parity)}"
            )
            fixes.append(
                "Add the missing AC-N references to the capability slice that "
                "implements the required parity"
            )

        return errors, fixes

    def _validate_phase(self, phase: dict, index: int) -> list[str]:
        """Validate a single phase.

        Supports both legacy format (using 'phase' number) and new format (using 'id' string).

        Args:
            phase: The phase dictionary to validate
            index: The index of the phase in the phases list

        Returns:
            List of error messages
        """
        errors = []
        schema = IMPLEMENTATION_PLAN_SCHEMA["phase_schema"]

        # Check required fields
        for field in schema["required_fields"]:
            if field not in phase:
                errors.append(f"Phase {index + 1}: missing required field '{field}'")

        # Check either-or required fields (must have at least one from each group)
        for field_group in schema.get("required_fields_either", []):
            if not any(f in phase for f in field_group):
                errors.append(
                    f"Phase {index + 1}: missing required field (need one of: {', '.join(field_group)})"
                )

        if "type" in phase and phase["type"] not in schema["phase_types"]:
            errors.append(f"Phase {index + 1}: invalid type '{phase['type']}'")

        # Validate subtasks
        subtasks = phase.get("subtasks", [])
        for j, subtask in enumerate(subtasks):
            subtask_errors = self._validate_subtask(subtask, index, j)
            errors.extend(subtask_errors)

        return errors

    def _validate_file_ownership(
        self, phases: list[dict]
    ) -> tuple[list[str], list[str]]:
        """Ensure capability slices have unique files and serialized registries."""
        errors = []
        fixes = []
        owners = {}
        last_phase_index = len(phases)
        enforce_capability_ownership = False
        try:
            requirements = json.loads(
                (self.spec_dir / "requirements.json").read_text(encoding="utf-8")
            )
            enforce_capability_ownership = (
                isinstance(requirements, dict)
                and requirements.get("scope_contract_version") == 1
            )
        except (OSError, json.JSONDecodeError, UnicodeDecodeError):
            pass

        for phase_index, phase in enumerate(phases, start=1):
            phase_type = phase.get("type", "implementation")
            for subtask_index, subtask in enumerate(phase.get("subtasks", []), start=1):
                location = f"Phase {phase_index}, Subtask {subtask_index}"
                modify = [str(path) for path in subtask.get("files_to_modify", [])]
                create = [str(path) for path in subtask.get("files_to_create", [])]
                overlap = set(modify) & set(create)
                if overlap:
                    errors.append(
                        f"{location}: files listed as both modify and create: "
                        f"{sorted(overlap)}"
                    )
                    fixes.append(f"{location}: give each file one operation")

                for path in modify + create:
                    if (
                        enforce_capability_ownership
                        and path in owners
                        and owners[path] != location
                    ):
                        errors.append(
                            f"File owned by multiple capability slices: '{path}' "
                            f"({owners[path]} and {location})"
                        )
                        fixes.append(f"Assign '{path}' to exactly one capability slice")
                    owners[path] = location

                    if (
                        enforce_capability_ownership
                        and is_shared_registry_path(path)
                        and (
                            phase_index != last_phase_index
                            or phase_type != "integration"
                        )
                    ):
                        errors.append(
                            f"Shared registry must be owned by the final integration "
                            f"slice: '{path}'"
                        )
                        fixes.append(
                            f"Move '{path}' to the final phase with type 'integration'"
                        )

        return errors, fixes

    def _validate_subtask(
        self, subtask: dict, phase_idx: int, subtask_idx: int
    ) -> list[str]:
        """Validate a single subtask.

        Args:
            subtask: The subtask dictionary to validate
            phase_idx: The index of the parent phase
            subtask_idx: The index of the subtask within the phase

        Returns:
            List of error messages
        """
        errors = []
        schema = IMPLEMENTATION_PLAN_SCHEMA["subtask_schema"]
        ver_schema = IMPLEMENTATION_PLAN_SCHEMA["verification_schema"]

        for field in schema["required_fields"]:
            if field not in subtask:
                errors.append(
                    f"Phase {phase_idx + 1}, Subtask {subtask_idx + 1}: missing required field '{field}'"
                )

        if "status" in subtask and subtask["status"] not in schema["status_values"]:
            errors.append(
                f"Phase {phase_idx + 1}, Subtask {subtask_idx + 1}: invalid status '{subtask['status']}'"
            )

        # Validate verification if present
        if "verification" in subtask:
            ver = subtask["verification"]

            if not isinstance(ver, dict) or "type" not in ver:
                errors.append(
                    f"Phase {phase_idx + 1}, Subtask {subtask_idx + 1}: verification missing 'type'"
                )
            elif ver["type"] not in ver_schema["verification_types"]:
                errors.append(
                    f"Phase {phase_idx + 1}, Subtask {subtask_idx + 1}: invalid verification type '{ver['type']}'"
                )

        verification_steps = subtask.get("verification_steps", [])
        if verification_steps and not isinstance(verification_steps, list):
            errors.append(
                f"Phase {phase_idx + 1}, Subtask {subtask_idx + 1}: "
                "verification_steps must be a list"
            )
        elif isinstance(verification_steps, list):
            for step_idx, step in enumerate(verification_steps, start=1):
                if not isinstance(step, dict) or "type" not in step:
                    errors.append(
                        f"Phase {phase_idx + 1}, Subtask {subtask_idx + 1}, "
                        f"Verification {step_idx}: missing 'type'"
                    )
                elif step["type"] not in ver_schema["verification_types"]:
                    errors.append(
                        f"Phase {phase_idx + 1}, Subtask {subtask_idx + 1}, "
                        f"Verification {step_idx}: invalid type '{step['type']}'"
                    )

        return errors

    def _validate_dependencies(self, phases: list[dict]) -> list[str]:
        """Check for circular dependencies.

        Supports both legacy numeric phase IDs and new string-based phase IDs.

        Args:
            phases: List of phase dictionaries

        Returns:
            List of error messages for invalid dependencies
        """
        errors = []

        # Build a map of phase identifiers (supports both "id" and "phase" fields)
        # and track their position/order for cycle detection
        phase_ids = set()
        phase_order = {}  # Maps phase id -> position index

        for i, p in enumerate(phases):
            # Support both "id" field (new format) and "phase" field (legacy format)
            phase_id = p.get("id") or p.get("phase", i + 1)
            phase_ids.add(phase_id)
            phase_order[phase_id] = i

        for i, phase in enumerate(phases):
            phase_id = phase.get("id") or phase.get("phase", i + 1)
            depends_on = phase.get("depends_on", [])

            for dep in depends_on:
                if dep not in phase_ids:
                    errors.append(
                        f"Phase {phase_id}: depends on non-existent phase {dep}"
                    )
                # Check for forward references (cycles) by comparing positions
                elif phase_order.get(dep, -1) >= i:
                    errors.append(
                        f"Phase {phase_id}: cannot depend on phase {dep} (would create cycle)"
                    )

        return errors
