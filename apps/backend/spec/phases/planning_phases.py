"""
Planning and Validation Phase Implementations
==============================================

Phases for implementation planning and final validation.
"""

from typing import TYPE_CHECKING

from execution_budget import get_execution_budget
from task_logger import LogEntryType, LogPhase

from .. import writer
from .models import PhaseResult

if TYPE_CHECKING:
    pass


class PlanningPhaseMixin:
    """Mixin for planning and validation phase methods."""

    async def phase_planning(self) -> PhaseResult:
        """Create the implementation plan."""
        from ..validate_pkg.auto_fix import auto_fix_plan

        plan_file = self.spec_dir / "implementation_plan.json"

        if plan_file.exists():
            result = self.spec_validator.validate_implementation_plan()
            if result.valid:
                self.ui.print_status(
                    "implementation_plan.json already exists and is valid", "success"
                )
                return PhaseResult("planning", True, [str(plan_file)], [], 0)
            self.ui.print_status("Plan exists but invalid, regenerating...", "warning")

        errors = []
        budget = get_execution_budget(self.spec_dir)

        # Try the in-process Python planner first (deterministic).
        self.ui.print_status("Trying deterministic planner...", "progress")
        try:
            from planner_lib.main import generate_implementation_plan

            generate_implementation_plan(self.spec_dir)
            success, output = True, "Deterministic plan generated"
        except Exception as exc:
            success, output = False, str(exc)

        if success and plan_file.exists():
            auto_fix_plan(self.spec_dir)
            result = self.spec_validator.validate_implementation_plan()
            if result.valid:
                self.ui.print_status(
                    "Created valid implementation_plan.json via script", "success"
                )
                stats = writer.get_plan_stats(self.spec_dir)
                if stats:
                    self.task_logger.log(
                        f"Implementation plan created with {stats.get('total_subtasks', 0)} subtasks",
                        LogEntryType.SUCCESS,
                        LogPhase.PLANNING,
                    )
                return PhaseResult("planning", True, [str(plan_file)], [], 0)
            else:
                if auto_fix_plan(self.spec_dir):
                    result = self.spec_validator.validate_implementation_plan()
                    if result.valid:
                        self.ui.print_status(
                            "Auto-fixed implementation_plan.json", "success"
                        )
                        return PhaseResult("planning", True, [str(plan_file)], [], 0)
                errors.append(f"Script output invalid: {result.errors}")

        # Fall back to agent
        self.ui.print_status("Falling back to planner agent...", "progress")
        validation_feedback = ""
        for attempt in range(budget.max_spec_attempts):
            self.ui.print_status(
                f"Running planner agent (attempt {attempt + 1})...", "progress"
            )

            budget_context = (
                f"\n## EXECUTION BUDGET\n\nCreate no more than "
                f"{budget.max_subtasks} vertical subtasks total. Group related "
                "file changes into one subtask and keep each subtask independently "
                "verifiable.\n"
                if budget.max_subtasks is not None
                else ""
            )
            repair_context = (
                "\n## PLAN VALIDATION FEEDBACK\n\n"
                "The previous plan was rejected. Repair every issue below before "
                "finishing. If a file is needed by multiple slices, merge those "
                "slices or assign all edits for that file to exactly one slice.\n\n"
                f"{validation_feedback}\n"
                if validation_feedback
                else ""
            )

            success, output = await self.run_agent_fn(
                "planner.md",
                additional_context=budget_context + repair_context,
                phase_name="planning",
            )

            if success and plan_file.exists():
                auto_fix_plan(self.spec_dir)
                result = self.spec_validator.validate_implementation_plan()
                if result.valid:
                    self.ui.print_status(
                        "Created valid implementation_plan.json via agent", "success"
                    )
                    return PhaseResult("planning", True, [str(plan_file)], [], attempt)
                else:
                    if auto_fix_plan(self.spec_dir):
                        result = self.spec_validator.validate_implementation_plan()
                        if result.valid:
                            self.ui.print_status(
                                "Auto-fixed implementation_plan.json", "success"
                            )
                            return PhaseResult(
                                "planning", True, [str(plan_file)], [], attempt
                            )
                    validation_feedback = "\n".join(
                        [
                            *(f"ERROR: {error}" for error in result.errors),
                            *(f"FIX: {fix}" for fix in result.fixes),
                        ]
                    )
                    errors.append(f"Agent attempt {attempt + 1}: {result.errors}")
                    self.ui.print_status("Plan created but invalid", "error")
            else:
                errors.append(f"Agent attempt {attempt + 1}: Did not create plan file")

        return PhaseResult("planning", False, [], errors, budget.max_spec_attempts)

    async def phase_validation(self) -> PhaseResult:
        """Final validation of all spec files with auto-fix retry."""
        budget = get_execution_budget(self.spec_dir)
        for attempt in range(budget.max_spec_attempts):
            results = self.spec_validator.validate_all()
            all_valid = all(r.valid for r in results)

            for result in results:
                if result.valid:
                    self.ui.print_status(f"{result.checkpoint}: PASS", "success")
                else:
                    self.ui.print_status(f"{result.checkpoint}: FAIL", "error")
                for err in result.errors:
                    print(f"    {self.ui.muted('Error:')} {err}")

            if all_valid:
                print()
                self.ui.print_status("All validation checks passed", "success")
                return PhaseResult("validation", True, [], [], attempt)

            # If not valid, try to auto-fix with AI agent
            if attempt < budget.max_spec_attempts - 1:
                print()
                self.ui.print_status(
                    f"Attempting auto-fix (attempt {attempt + 1}/{budget.max_spec_attempts - 1})...",
                    "progress",
                )

                # Collect all errors for the fixer agent
                error_details = []
                for result in results:
                    if not result.valid:
                        error_details.append(
                            f"**{result.checkpoint}** validation failed:"
                        )
                        for err in result.errors:
                            error_details.append(f"  - {err}")
                        if result.fixes:
                            error_details.append("  Suggested fixes:")
                            for fix in result.fixes:
                                error_details.append(f"    - {fix}")

                context_str = f"""
**Spec Directory**: {self.spec_dir}

## Validation Errors to Fix

{chr(10).join(error_details)}

## Files in Spec Directory

The following files exist in the spec directory:
- context.json
- requirements.json
- spec.md
- implementation_plan.json
- project_index.json (if exists)

Read the failed files, understand the errors, and fix them.
"""
                success, output = await self.run_agent_fn(
                    "validation_fixer.md",
                    additional_context=context_str,
                    phase_name="validation",
                )

                if not success:
                    self.ui.print_status("Auto-fix agent failed", "warning")

        # All retries exhausted
        errors = [f"{r.checkpoint}: {err}" for r in results for err in r.errors]
        return PhaseResult("validation", False, [], errors, budget.max_spec_attempts)
