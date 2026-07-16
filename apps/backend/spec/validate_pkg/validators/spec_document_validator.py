"""
Spec Document Validator
========================

Validates spec.md document structure and required sections.
"""

import json
import re
from pathlib import Path

from ..models import ValidationResult
from ..schemas import (
    REQUIREMENTS_SCOPE_FIELDS,
    SPEC_RECOMMENDED_SECTIONS,
    SPEC_REQUIRED_SECTIONS,
)


def _section_content(content: str, section: str) -> str:
    """Return markdown content under a level-one or level-two heading."""
    match = re.search(
        rf"^##?\s+{re.escape(section)}\s*$",
        content,
        re.MULTILINE | re.IGNORECASE,
    )
    if not match:
        return ""
    remainder = content[match.end() :]
    next_heading = re.search(r"^##?\s+", remainder, re.MULTILINE)
    return remainder[: next_heading.start()] if next_heading else remainder


def _normalized_text(value: str) -> str:
    value = value.replace("’", "'").replace("“", '"').replace("”", '"')
    return re.sub(r"\s+", " ", value).strip().lower()


def _scope_tokens(value: str) -> set[str]:
    """Return meaningful tokens for conservative paraphrase matching."""
    stop_words = {
        "a",
        "an",
        "and",
        "as",
        "at",
        "be",
        "by",
        "do",
        "for",
        "from",
        "in",
        "is",
        "it",
        "of",
        "on",
        "or",
        "the",
        "to",
        "with",
    }
    return {
        token
        for token in re.findall(r"[a-z0-9]+", _normalized_text(value))
        if token not in stop_words
    }


def _scope_item_is_covered(item: str, subsection: str) -> bool:
    """Accept exact copies or conservative wording-only paraphrases."""
    normalized_item = _normalized_text(item)
    normalized_subsection = _normalized_text(subsection)
    if normalized_item in normalized_subsection:
        return True

    item_tokens = _scope_tokens(item)
    if len(item_tokens) < 3:
        return False
    for line in subsection.splitlines():
        candidate_tokens = _scope_tokens(re.sub(r"^\s*[-*+]\s+", "", line))
        overlap = item_tokens & candidate_tokens
        if len(overlap) >= 2 and len(overlap) / len(item_tokens) >= 2 / 3:
            return True
    return False


def _subsection_content(content: str, subsection: str) -> str:
    match = re.search(
        rf"^###\s+{re.escape(subsection)}\s*$",
        content,
        re.MULTILINE | re.IGNORECASE,
    )
    if not match:
        return ""
    remainder = content[match.end() :]
    next_heading = re.search(r"^###\s+", remainder, re.MULTILINE)
    return remainder[: next_heading.start()] if next_heading else remainder


class SpecDocumentValidator:
    """Validates spec.md exists and has required sections."""

    def __init__(self, spec_dir: Path):
        """Initialize the spec document validator.

        Args:
            spec_dir: Path to the spec directory
        """
        self.spec_dir = Path(spec_dir)

    def validate(self) -> ValidationResult:
        """Validate spec.md exists and has required sections.

        Returns:
            ValidationResult with errors, warnings, and suggested fixes
        """
        errors = []
        warnings = []
        fixes = []

        spec_file = self.spec_dir / "spec.md"

        if not spec_file.exists():
            errors.append("spec.md not found")
            fixes.append("Create spec.md with required sections")
            return ValidationResult(False, "spec", errors, warnings, fixes)

        content = spec_file.read_text(encoding="utf-8")

        # Check for required sections
        for section in SPEC_REQUIRED_SECTIONS:
            # Look for ## Section or # Section
            pattern = rf"^##?\s+{re.escape(section)}"
            if not re.search(pattern, content, re.MULTILINE | re.IGNORECASE):
                errors.append(f"Missing required section: '{section}'")
                fixes.append(f"Add '## {section}' section to spec.md")

        # Check for recommended sections
        for section in SPEC_RECOMMENDED_SECTIONS:
            pattern = rf"^##?\s+{re.escape(section)}"
            if not re.search(pattern, content, re.MULTILINE | re.IGNORECASE):
                warnings.append(f"Missing recommended section: '{section}'")

        self._validate_scope_contract(content, errors, fixes)

        # Check minimum content length
        if len(content) < 500:
            warnings.append("spec.md seems too short (< 500 chars)")

        return ValidationResult(
            valid=len(errors) == 0,
            checkpoint="spec",
            errors=errors,
            warnings=warnings,
            fixes=fixes,
        )

    def _validate_scope_contract(
        self, content: str, errors: list[str], fixes: list[str]
    ) -> None:
        """Enforce scope boundaries for requirements created with Phase 1 fields."""
        requirements_file = self.spec_dir / "requirements.json"
        try:
            requirements = json.loads(requirements_file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError, UnicodeDecodeError):
            return
        if (
            not isinstance(requirements, dict)
            or requirements.get("scope_contract_version") != 1
            or not all(field in requirements for field in REQUIREMENTS_SCOPE_FIELDS)
        ):
            return

        for section in ("MVP Boundary", "Parity Matrix"):
            if not re.search(
                rf"^##?\s+{re.escape(section)}\s*$",
                content,
                re.MULTILINE | re.IGNORECASE,
            ):
                errors.append(f"Missing required scope section: '{section}'")
                fixes.append(f"Add '## {section}' section to spec.md")

        boundary = _section_content(content, "MVP Boundary")
        if not boundary.strip():
            errors.append("MVP Boundary section is empty")
            fixes.append("Populate all required MVP Boundary subsections")
        for label in (
            "Must Have",
            "Required Parity",
            "Reuse Existing",
            "Deferred",
            "Non-Goals",
        ):
            if boundary and not re.search(
                rf"^###\s+{re.escape(label)}\s*$",
                boundary,
                re.MULTILINE | re.IGNORECASE,
            ):
                errors.append(f"MVP Boundary is missing subsection: '{label}'")
                fixes.append(f"Add '### {label}' under '## MVP Boundary'")

        parity = _section_content(content, "Parity Matrix")
        if not parity.strip():
            errors.append("Parity Matrix section is empty")
            fixes.append("Add the required parity table or an explicit N/A row")
        elif not re.search(
            r"\|\s*Capability\s*\|\s*Disposition\s*\|\s*Driving Acceptance Criterion\s*\|",
            parity,
            re.IGNORECASE,
        ):
            errors.append("Parity Matrix has an invalid or missing header")
            fixes.append(
                "Use columns: Capability | Disposition | Driving Acceptance Criterion"
            )

        scope_subsections = {
            "must_have": "Must Have",
            "required_parity": "Required Parity",
            "reuse_existing": "Reuse Existing",
            "deferred": "Deferred",
            "non_goals": "Non-Goals",
        }
        for field, label in scope_subsections.items():
            expected_items = requirements.get(field, [])
            subsection = _subsection_content(boundary, label)
            if not isinstance(expected_items, list):
                continue
            if expected_items:
                for item in expected_items:
                    if not _scope_item_is_covered(str(item), subsection):
                        errors.append(
                            f"MVP Boundary '{label}' does not include scope item: "
                            f"'{item}'"
                        )
                        fixes.append(f"Copy '{item}' into the '{label}' subsection")
            elif subsection and "n/a" not in subsection.lower():
                errors.append(
                    f"MVP Boundary '{label}' must explicitly state N/A when empty"
                )
                fixes.append(f"Add '- N/A' under '### {label}'")

        parity_rows = [
            line
            for line in parity.splitlines()
            if line.strip().startswith("|")
            and "capability" not in line.lower()
            and not re.fullmatch(r"[\s|:-]+", line)
        ]
        required_rows = [
            row for row in parity_rows if re.search(r"\|\s*required\s*\|", row, re.I)
        ]
        success_refs = {
            match.upper()
            for match in re.findall(
                r"\bAC-\d+\b",
                _section_content(content, "Success Criteria"),
                re.IGNORECASE,
            )
        }
        required_parity = requirements.get("required_parity", [])
        normalized_required_parity = (
            [
                _normalized_text(str(capability))
                for capability in required_parity
                if str(capability).strip()
            ]
            if isinstance(required_parity, list)
            else []
        )

        for row in required_rows:
            row_refs = {
                match.upper() for match in re.findall(r"\bAC-\d+\b", row, re.IGNORECASE)
            }
            if not row_refs:
                errors.append(
                    "Each required parity row must cite a driving acceptance criterion"
                )
                fixes.append("Add an AC-N reference to every required parity row")
            elif row_refs - success_refs:
                errors.append(
                    "Required parity row cites an acceptance criterion that is not "
                    "defined under Success Criteria"
                )
                fixes.append(
                    "Use an AC-N identifier defined under '## Success Criteria'"
                )

            cells = [cell.strip() for cell in row.strip().strip("|").split("|")]
            capability = cells[0] if cells else ""
            if not any(
                required in _normalized_text(capability)
                for required in normalized_required_parity
            ):
                errors.append(
                    f"Parity Matrix marks an unapproved capability as required: "
                    f"'{capability}'"
                )
                fixes.append(
                    "Move the capability to Deferred or add it explicitly to "
                    "requirements.json.required_parity"
                )

        for capability in required_parity if isinstance(required_parity, list) else []:
            normalized_capability = _normalized_text(str(capability))
            matching_rows = [
                row
                for row in required_rows
                if normalized_capability in _normalized_text(row)
            ]
            if not matching_rows:
                errors.append(
                    f"Required parity capability is not mapped in the Parity Matrix: "
                    f"'{capability}'"
                )
                fixes.append(
                    f"Add a required parity row for '{capability}' with an AC-N reference"
                )

        if (
            not required_parity
            and parity
            and not any("n/a" in row.lower() for row in parity_rows)
        ):
            errors.append(
                "Parity Matrix must explicitly state N/A when no parity is required"
            )
            fixes.append("Add an N/A row to the Parity Matrix")
