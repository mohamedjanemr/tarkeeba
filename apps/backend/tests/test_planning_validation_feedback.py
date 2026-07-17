import json
import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from spec.phases.planning_phases import PlanningPhaseMixin  # noqa: E402
from spec.validate_pkg.models import ValidationResult  # noqa: E402


class _UI:
    def print_status(self, *_args):
        pass


class _Logger:
    def log(self, *_args):
        pass


class _Validator:
    def __init__(self):
        self.calls = 0

    def validate_implementation_plan(self):
        self.calls += 1
        if self.calls == 1:
            return ValidationResult(
                valid=False,
                checkpoint="implementation_plan",
                errors=["File owned by multiple capability slices: 'poller.ts'"],
                warnings=[],
                fixes=["Assign 'poller.ts' to exactly one capability slice"],
            )
        return ValidationResult(True, "implementation_plan", [], [], [])


class _PlanningHarness(PlanningPhaseMixin):
    def __init__(self, spec_dir):
        self.spec_dir = spec_dir
        self.spec_validator = _Validator()
        self.ui = _UI()
        self.task_logger = _Logger()
        self.contexts = []

    async def run_agent_fn(self, _prompt, *, additional_context, phase_name):
        self.contexts.append(additional_context)
        (self.spec_dir / "implementation_plan.json").write_text(
            json.dumps({"feature": "test", "workflow_type": "feature", "phases": []}),
            encoding="utf-8",
        )
        return True, "ok"


@pytest.mark.asyncio
async def test_planner_retry_receives_validator_errors(tmp_path, monkeypatch):
    (tmp_path / "task_metadata.json").write_text(
        json.dumps({"executionMode": "efficient"}), encoding="utf-8"
    )

    def fail_deterministic(_spec_dir):
        raise RuntimeError("use agent fallback")

    monkeypatch.setattr(
        "planner_lib.main.generate_implementation_plan", fail_deterministic
    )
    monkeypatch.setattr("spec.validate_pkg.auto_fix.auto_fix_plan", lambda _path: False)

    harness = _PlanningHarness(tmp_path)
    result = await harness.phase_planning()

    assert result.success is True
    assert len(harness.contexts) == 2
    assert "PLAN VALIDATION FEEDBACK" in harness.contexts[1]
    assert "poller.ts" in harness.contexts[1]
    assert "Assign 'poller.ts' to exactly one capability slice" in harness.contexts[1]
