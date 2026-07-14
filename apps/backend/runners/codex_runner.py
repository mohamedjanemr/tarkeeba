#!/usr/bin/env python3
"""Codex-backed MVP runner for Tarkeeba's spec/build/QA pipeline.

This intentionally runs beside the Claude Agent SDK pipeline. It uses the
official Codex CLI JSONL automation interface and preserves Tarkeeba's
existing spec directory and implementation-plan contracts.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from agents.utils import sync_spec_to_source
from core.phase_event import ExecutionPhase, emit_phase
from workspace import WorkspaceMode, setup_workspace

DEFAULT_CODEX_MODEL = "gpt-5.6-sol"
VALID_EFFORT_LEVELS = {"low", "medium", "high", "xhigh"}


def _load_json(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def _metadata_config(spec_dir: Path) -> tuple[str, str]:
    metadata = _load_json(spec_dir / "task_metadata.json")
    model = str(metadata.get("codexModel") or DEFAULT_CODEX_MODEL)
    effort = str(metadata.get("codexReasoningEffort") or "high").lower()
    if effort not in VALID_EFFORT_LEVELS:
        effort = "high"
    return model, effort


def _item_summary(item: dict[str, Any]) -> str | None:
    item_type = item.get("type")
    if item_type == "agent_message":
        return str(item.get("text") or "").strip() or None
    if item_type == "command_execution":
        command = item.get("command") or item.get("aggregated_output")
        return f"[Codex command] {command}" if command else "[Codex command]"
    if item_type == "file_change":
        changes = item.get("changes") or []
        return f"[Codex files] {len(changes)} change(s)"
    if item_type == "mcp_tool_call":
        return f"[Codex tool] {item.get('tool') or item.get('name') or 'MCP'}"
    return None


def _run_codex(
    *,
    prompt: str,
    cwd: Path,
    model: str,
    effort: str,
    writable_dirs: list[Path] | None = None,
) -> None:
    codex_bin = os.environ.get("CODEX_CLI_PATH") or shutil.which("codex")
    if not codex_bin:
        raise RuntimeError("Codex CLI not found. Install Codex and run `codex login`.")

    auth = subprocess.run(
        [codex_bin, "login", "status"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=15,
        check=False,
    )
    if auth.returncode != 0:
        detail = (auth.stderr or auth.stdout).strip()
        raise RuntimeError(
            f"Codex authentication required. Run `codex login`. {detail}".strip()
        )

    command = [
        codex_bin,
        "exec",
        "--json",
        "--color",
        "never",
        "--model",
        model,
        "--sandbox",
        "workspace-write",
        "--cd",
        str(cwd),
        "--config",
        f'model_reasoning_effort="{effort}"',
    ]
    for directory in writable_dirs or []:
        command.extend(["--add-dir", str(directory)])
    command.append("-")

    # Do not expose Claude/Anthropic credentials to the Codex subprocess.
    codex_env = {
        key: value
        for key, value in os.environ.items()
        if not key.startswith("CLAUDE_") and not key.startswith("ANTHROPIC_")
    }

    process = subprocess.Popen(
        command,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        env=codex_env,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
    )
    assert process.stdin is not None
    assert process.stdout is not None
    process.stdin.write(prompt)
    process.stdin.close()

    for line in process.stdout:
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            print(line.rstrip(), flush=True)
            continue
        event_type = event.get("type")
        if event_type in {"item.started", "item.completed"}:
            summary = _item_summary(event.get("item") or {})
            if summary:
                print(summary, flush=True)
        elif event_type == "turn.failed":
            print(f"Codex turn failed: {event.get('error') or event}", flush=True)
        elif event_type == "error":
            print(f"Codex error: {event.get('message') or event}", flush=True)

    return_code = process.wait()
    if return_code != 0:
        raise RuntimeError(f"Codex execution failed with exit code {return_code}")


def _spec_prompt(project_dir: Path, spec_dir: Path, task: str) -> str:
    return f"""You are the specification and implementation-planning agent for Tarkeeba.

Project root: {project_dir}
Spec directory: {spec_dir}
Task: {task}

Inspect the repository and any requirements.json or task_metadata.json in the spec directory.
Create these two files:
1. {spec_dir / "spec.md"} — clear requirements, scope, architecture, acceptance criteria, and validation strategy.
2. {spec_dir / "implementation_plan.json"} — valid JSON using this shape:
   {{"feature": string, "description": string, "status": "pending", "phases": [{{"id": string, "name": string, "subtasks": [{{"id": string, "description": string, "status": "pending", "files_to_modify": [string], "files_to_create": [string], "verification": {{"type": "command", "command": string}}}}]}}]}}

Do not implement code in this turn. Do not alter files outside the spec directory.
Read AGENTS.md and repository guidance before planning. Ensure the plan is executable and sufficiently granular.
"""


def _build_prompt(project_dir: Path, spec_dir: Path) -> str:
    return f"""You are the coding agent for Tarkeeba.

Project root: {project_dir}
Spec directory: {spec_dir}

Read AGENTS.md, {spec_dir / "spec.md"}, and {spec_dir / "implementation_plan.json"}.
Implement the complete plan in the project root. Work through every pending subtask, run its verification,
and update each subtask status in implementation_plan.json to completed only after it is verified.
Keep changes scoped to the specification. Do not merely describe changes: edit files and run tests.
At the end set the top-level plan status to completed when all subtasks are complete.
"""


def _qa_prompt(project_dir: Path, spec_dir: Path) -> str:
    return f"""You are the QA reviewer and fixer for Tarkeeba.

Project root: {project_dir}
Spec directory: {spec_dir}

Review the implementation against spec.md and implementation_plan.json. Inspect the git diff, run the
most relevant tests, and fix defects you find. Then write {spec_dir / "qa_report.md"} with the checks run,
findings, fixes, and final result. Update implementation_plan.json with:
"qa_signoff": {{"status": "approved" or "rejected", "report_file": "qa_report.md", "summary": string}}.
Approve only when validation passes. Do not leave known defects unfixed unless they are documented and
make approval impossible.
"""


def _task_description(spec_dir: Path, fallback: str | None) -> str:
    if fallback:
        return fallback
    requirements = _load_json(spec_dir / "requirements.json")
    return str(
        requirements.get("task_description")
        or requirements.get("description")
        or spec_dir.name
    )


def _prepare_workspace(project_dir: Path, source_spec_dir: Path) -> tuple[Path, Path]:
    metadata = _load_json(source_spec_dir / "task_metadata.json")
    mode = (
        WorkspaceMode.DIRECT
        if metadata.get("useWorktree") is False
        else WorkspaceMode.ISOLATED
    )
    working_dir, _manager, localized_spec_dir = setup_workspace(
        project_dir,
        source_spec_dir.name,
        mode,
        source_spec_dir=source_spec_dir,
        base_branch=metadata.get("baseBranch"),
        use_local_branch=bool(metadata.get("useLocalBranch", False)),
    )
    return working_dir, localized_spec_dir or source_spec_dir


def main() -> int:
    parser = argparse.ArgumentParser(description="Run Tarkeeba tasks with Codex")
    parser.add_argument(
        "--stage", choices=("spec", "full", "build", "qa"), required=True
    )
    parser.add_argument("--project-dir", type=Path, required=True)
    parser.add_argument("--spec-dir", type=Path, required=True)
    parser.add_argument("--task")
    args = parser.parse_args()

    project_dir = args.project_dir.resolve()
    spec_dir = args.spec_dir.resolve()
    spec_dir.mkdir(parents=True, exist_ok=True)
    model, effort = _metadata_config(spec_dir)

    print(f"Codex provider: model={model}, reasoning_effort={effort}", flush=True)
    try:
        if args.stage in {"spec", "full"}:
            emit_phase(
                ExecutionPhase.PLANNING, "Creating specification with Codex", progress=5
            )
            _run_codex(
                prompt=_spec_prompt(
                    project_dir, spec_dir, _task_description(spec_dir, args.task)
                ),
                cwd=project_dir,
                model=model,
                effort=effort,
                writable_dirs=[spec_dir],
            )
            print("Specification complete", flush=True)
            if args.stage == "spec":
                emit_phase(
                    ExecutionPhase.PLANNING,
                    "Specification ready for review",
                    progress=100,
                )
                return 0

        source_spec_dir = spec_dir
        working_dir, spec_dir = _prepare_workspace(project_dir, source_spec_dir)

        if args.stage in {"full", "build"}:
            emit_phase(ExecutionPhase.CODING, "Implementing with Codex", progress=35)
            _run_codex(
                prompt=_build_prompt(working_dir, spec_dir),
                cwd=working_dir,
                model=model,
                effort=effort,
                writable_dirs=[spec_dir],
            )
            sync_spec_to_source(spec_dir, source_spec_dir)
            print("Codex build complete", flush=True)

        emit_phase(ExecutionPhase.QA_REVIEW, "Running Codex QA", progress=80)
        _run_codex(
            prompt=_qa_prompt(working_dir, spec_dir),
            cwd=working_dir,
            model=model,
            effort=effort,
            writable_dirs=[spec_dir],
        )
        sync_spec_to_source(spec_dir, source_spec_dir)
        plan = _load_json(spec_dir / "implementation_plan.json")
        approved = (plan.get("qa_signoff") or {}).get("status") == "approved"
        if not approved:
            emit_phase(ExecutionPhase.FAILED, "Codex QA did not approve the build")
            return 1
        emit_phase(ExecutionPhase.COMPLETE, "Codex pipeline completed", progress=100)
        return 0
    except (OSError, RuntimeError) as error:
        emit_phase(ExecutionPhase.FAILED, str(error))
        print(f"Fatal error: {error}", file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
