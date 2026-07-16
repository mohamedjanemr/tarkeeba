"""
Requirements Gathering Module
==============================

Interactive and automated requirements collection from users.
"""

import json
import os
import re
import shlex
import subprocess
import tempfile
from datetime import datetime
from pathlib import Path

SCOPE_FIELDS = (
    "must_have",
    "required_parity",
    "deferred",
    "reuse_existing",
    "non_goals",
)
DEFAULT_NON_GOAL = "Capabilities not explicitly required by the task description"
SCOPE_CONTRACT_VERSION = 1

_DESCRIPTION_SECTION_FIELDS = {
    "requirements": "must_have",
    "must have": "must_have",
    "required parity": "required_parity",
    "deferred": "deferred",
    "reuse existing": "reuse_existing",
    "non goals": "non_goals",
    "acceptance criteria": "acceptance_criteria",
    "constraints": "constraints",
}


def _description_heading(line: str) -> str | None:
    """Map a Markdown/plain-text task section heading to a scope field."""
    match = re.fullmatch(r"\s*(?:#{1,6}\s*)?([^:]+?)\s*:?[ \t]*", line)
    if not match:
        return None
    label = re.sub(r"[_-]+", " ", match.group(1).strip().lower())
    label = re.sub(r"\s+", " ", label)
    return _DESCRIPTION_SECTION_FIELDS.get(label)


def _description_item(line: str) -> str:
    """Strip common Markdown list syntax from a task-description item."""
    item = re.sub(r"^\s*(?:[-*+]|\d+[.)])\s+", "", line)
    item = re.sub(r"^\[[ xX]\]\s*", "", item)
    return item.strip()


def extract_scope_from_task_description(task_description: str) -> dict[str, list[str]]:
    """Extract explicit scope sections embedded in a non-interactive task.

    Task creation commonly supplies one Markdown description rather than separate
    scope fields. Preserve its introductory outcome as a must-have, then map
    recognized sections such as Requirements, Non-goals, and Acceptance criteria
    into the structured scope contract used by the spec validator.
    """
    extracted = {
        field: [] for field in {*SCOPE_FIELDS, "acceptance_criteria", "constraints"}
    }
    preamble: list[str] = []
    current_field: str | None = None
    found_section = False

    for line in task_description.splitlines():
        heading = _description_heading(line)
        if heading:
            current_field = heading
            found_section = True
            continue

        item = _description_item(line)
        if not item:
            continue
        if current_field:
            extracted[current_field].append(item)
        elif not found_section:
            preamble.append(item)

    if not found_section:
        return extracted

    intro = " ".join(preamble).strip()
    if intro:
        extracted["must_have"].insert(0, intro)
    return extracted


def _string_list(value) -> list[str]:
    """Normalize a user-provided value into a clean list of strings."""
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, list):
        return []
    return [item.strip() for item in value if isinstance(item, str) and item.strip()]


def normalize_requirements(
    requirements: dict,
    *,
    fallback_task_description: str | None = None,
    acceptance_criteria: list[str] | None = None,
    enforce_scope_contract: bool = True,
) -> dict:
    """Return a backward-compatible requirements document with scope controls."""
    normalized = dict(requirements) if isinstance(requirements, dict) else {}
    task_description = str(
        normalized.get("task_description")
        or fallback_task_description
        or "Unknown task"
    ).strip()
    description_scope = extract_scope_from_task_description(task_description)

    normalized["task_description"] = task_description
    normalized["workflow_type"] = str(
        normalized.get("workflow_type") or "feature"
    ).strip()
    normalized["services_involved"] = _string_list(
        normalized.get("services_involved", [])
    )

    existing_must_have = _string_list(normalized.get("must_have", []))
    generated_must_have = not existing_must_have or existing_must_have == [
        task_description
    ]
    if generated_must_have and description_scope["must_have"]:
        normalized["must_have"] = description_scope["must_have"]
    else:
        normalized["must_have"] = existing_must_have or (
            [task_description] if task_description else []
        )

    for field in ("required_parity", "deferred", "reuse_existing"):
        existing = _string_list(normalized.get(field, []))
        normalized[field] = existing or description_scope[field]

    non_goals_present = "non_goals" in normalized
    existing_non_goals = _string_list(normalized.get("non_goals", []))
    generated_non_goals = existing_non_goals == [DEFAULT_NON_GOAL]
    if existing_non_goals and not generated_non_goals:
        normalized["non_goals"] = existing_non_goals
    elif description_scope["non_goals"]:
        normalized["non_goals"] = description_scope["non_goals"]
    elif non_goals_present and not generated_non_goals:
        normalized["non_goals"] = []
    else:
        normalized["non_goals"] = [DEFAULT_NON_GOAL]

    existing_criteria = _string_list(normalized.get("acceptance_criteria", []))
    normalized["acceptance_criteria"] = (
        existing_criteria
        or description_scope["acceptance_criteria"]
        or _string_list(acceptance_criteria or [])
    )
    normalized["constraints"] = (
        _string_list(normalized.get("constraints", []))
        or description_scope["constraints"]
    )
    normalized.setdefault(
        "scope_contract_version",
        SCOPE_CONTRACT_VERSION if enforce_scope_contract else 0,
    )
    normalized.setdefault("created_at", datetime.now().isoformat())
    return normalized


def _prompt_scope_list(ui_module, label: str, hint: str) -> list[str]:
    """Collect a comma-separated optional scope list from the interactive CLI."""
    print(f"     {ui_module.bold(label)}")
    print(f"     {ui_module.muted(hint)}")
    value = input("     > ").strip()
    return [item.strip() for item in value.split(",") if item.strip()]


def open_editor_for_input(field_name: str) -> str:
    """Open the user's editor for long-form text input."""
    editor = os.environ.get("EDITOR", os.environ.get("VISUAL", "nano"))

    # Create temp file with helpful instructions
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".md", delete=False, encoding="utf-8"
    ) as f:
        f.write(f"# Enter your {field_name.replace('_', ' ')} below\n")
        f.write("# Lines starting with # will be ignored\n")
        f.write("# Save and close the editor when done\n\n")
        temp_path = f.name

    try:
        # Parse editor command (handles "code --wait" etc.)
        editor_cmd = shlex.split(editor)
        editor_cmd.append(temp_path)

        # Open editor
        result = subprocess.run(editor_cmd)

        if result.returncode != 0:
            return ""

        # Read the content
        with open(temp_path, encoding="utf-8") as f:
            lines = f.readlines()

        # Filter out comment lines and join
        content_lines = [
            line.rstrip() for line in lines if not line.strip().startswith("#")
        ]
        return "\n".join(content_lines).strip()

    finally:
        # Clean up temp file
        try:
            os.unlink(temp_path)
        except OSError:
            pass


def gather_requirements_interactively(ui_module) -> dict:
    """Gather requirements interactively from the user via CLI prompts.

    Args:
        ui_module: UI module with formatting functions (bold, muted, etc.)
    """
    print()
    print(f"  {ui_module.muted('Answer the following questions to define your task:')}")
    print()

    # Task description - multi-line support with editor option
    print(f"  {ui_module.bold('1. What do you want to build or fix?')}")
    print(f"     {ui_module.muted('(Describe the feature, bug fix, or change)')}")
    edit_hint = 'Type "edit" to open in your editor, or enter text below'
    print(f"     {ui_module.muted(edit_hint)}")
    print(
        f"     {ui_module.muted('(Press Enter often for new lines, blank line = done)')}"
    )

    task = ""
    task_lines = []
    while True:
        try:
            line = input("     > " if not task_lines else "       ")

            # Check for editor command on first line
            if not task_lines and line.strip().lower() == "edit":
                task = open_editor_for_input("task_description")
                if task:
                    print(
                        f"     {ui_module.muted(f'Got {len(task)} chars from editor')}"
                    )
                break

            if not line and task_lines:  # Blank line and we have content = done
                break
            if line:
                task_lines.append(line)
        except EOFError:
            break

    # If we collected lines (not from editor)
    if task_lines:
        task = " ".join(task_lines).strip()

    if not task:
        task = "No task description provided"
    print()

    # Workflow type
    print(f"  {ui_module.bold('2. What type of work is this?')}")
    print(f"     {ui_module.muted('[1] feature  - New functionality')}")
    print(f"     {ui_module.muted('[2] bugfix   - Fix existing issue')}")
    print(f"     {ui_module.muted('[3] refactor - Improve code structure')}")
    print(f"     {ui_module.muted('[4] docs     - Documentation changes')}")
    print(f"     {ui_module.muted('[5] test     - Add or improve tests')}")
    workflow_choice = input("     > ").strip()
    workflow_map = {
        "1": "feature",
        "feature": "feature",
        "2": "bugfix",
        "bugfix": "bugfix",
        "3": "refactor",
        "refactor": "refactor",
        "4": "docs",
        "docs": "docs",
        "5": "test",
        "test": "test",
    }
    workflow_type = workflow_map.get(workflow_choice.lower(), "feature")
    print()

    # Additional context (optional) - multi-line support
    print(f"  {ui_module.bold('3. Any additional context or constraints?')}")
    print(
        f"     {ui_module.muted('(Press Enter to skip, or enter a blank line when done)')}"
    )

    context_lines = []
    while True:
        try:
            line = input("     > " if not context_lines else "       ")
            if not line:  # Blank line = done (allows skip on first empty)
                break
            context_lines.append(line)
        except EOFError:
            break

    additional_context = " ".join(context_lines).strip()
    print()

    print(f"  {ui_module.bold('4. Define the MVP boundary')}")
    print(
        f"     {ui_module.muted('Use comma-separated items. Press Enter to leave an optional list empty.')}"
    )
    must_have = _prompt_scope_list(
        ui_module,
        "Must have",
        "Explicit outcomes required in this task (defaults to the task description)",
    )
    required_parity = _prompt_scope_list(
        ui_module,
        "Required parity",
        "Only named capabilities that must match an existing provider or feature",
    )
    reuse_existing = _prompt_scope_list(
        ui_module,
        "Reuse existing",
        "Existing components, services, or patterns that must be reused",
    )
    deferred = _prompt_scope_list(
        ui_module,
        "Deferred",
        "Useful work to preserve as a follow-up instead of implementing now",
    )
    non_goals = _prompt_scope_list(
        ui_module,
        "Non-goals",
        "Capabilities explicitly excluded from this task",
    )
    print()

    return normalize_requirements(
        {
            "task_description": task,
            "workflow_type": workflow_type,
            "services_involved": [],  # AI will discover this during planning and context fetching
            "additional_context": additional_context if additional_context else None,
            "must_have": must_have or [task],
            "required_parity": required_parity,
            "deferred": deferred,
            "reuse_existing": reuse_existing,
            "non_goals": non_goals or [DEFAULT_NON_GOAL],
            "created_at": datetime.now().isoformat(),
        }
    )


def create_requirements_from_task(task_description: str) -> dict:
    """Create minimal requirements dictionary from task description."""
    return normalize_requirements(
        {
            "task_description": task_description,
            "workflow_type": "feature",  # Default, agent will refine
            "services_involved": [],  # AI will discover during planning and context fetching
            "created_at": datetime.now().isoformat(),
        }
    )


def save_requirements(spec_dir: Path, requirements: dict) -> Path:
    """Save requirements to file."""
    requirements_file = spec_dir / "requirements.json"
    requirements = normalize_requirements(requirements)
    with open(requirements_file, "w", encoding="utf-8") as f:
        json.dump(requirements, f, indent=2)
    return requirements_file


def load_requirements(spec_dir: Path) -> dict | None:
    """Load requirements from file if it exists."""
    requirements_file = spec_dir / "requirements.json"
    if not requirements_file.exists():
        return None

    with open(requirements_file, encoding="utf-8") as f:
        return json.load(f)
