#!/usr/bin/env python3
"""
Azure DevOps Automation Runner
==============================

CLI interface for Azure DevOps automation features:
- PR Review: AI-powered pull request review
- Follow-up Review: Review changes since last review

Usage:
    # Review a specific PR
    python runner.py review-pr 123

    # Follow-up review after new commits
    python runner.py followup-review-pr 123
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

# Validate platform-specific dependencies BEFORE any imports that might
# trigger graphiti_core -> real_ladybug -> pywintypes import chain (ACS-253)
from core.dependency_validator import validate_platform_dependencies

validate_platform_dependencies()

# Load .env file with centralized error handling
from cli.utils import import_dotenv

load_dotenv = import_dotenv()

env_file = Path(__file__).parent.parent.parent / ".env"
if env_file.exists():
    load_dotenv(env_file)

# Add azure-devops runner directory to path for direct imports
sys.path.insert(0, str(Path(__file__).parent))

from core.io_utils import safe_print
from models import AzureDevOpsRunnerConfig
from orchestrator import AzureDevOpsOrchestrator, ProgressCallback
from phase_config import sanitize_thinking_level


def print_progress(callback: ProgressCallback) -> None:
    """Print progress updates to console."""
    prefix = ""
    if callback.pr_id:
        prefix = f"[PR {callback.pr_id}] "

    safe_print(f"{prefix}[{callback.progress:3d}%] {callback.message}")


def get_config(args) -> AzureDevOpsRunnerConfig:
    """Build config from CLI args and environment."""
    pat = args.pat or os.environ.get("AZURE_DEVOPS_PAT", "")
    organization = args.organization or os.environ.get("AZURE_DEVOPS_ORG", "")
    project = args.project or os.environ.get("AZURE_DEVOPS_PROJECT", "")

    # Project detection priority:
    # 1. Explicit --organization/--project flags (highest priority)
    # 2. Auto-detect from .auto-claude/azure-devops/config.json (primary for multi-project setups)
    # 3. Environment variables (fallback only)

    # Auto-detect from project config (takes priority over env var)
    if not organization or not project:
        config_path = (
            Path(args.project_dir) / ".auto-claude" / "azure-devops" / "config.json"
        )
        if config_path.exists():
            try:
                with open(config_path, encoding="utf-8") as f:
                    data = json.load(f)
                    if not organization:
                        organization = data.get("organization", "")
                    if not project:
                        project = data.get("project", "")
                    if not pat:
                        pat = data.get("pat", "")
            except Exception as exc:
                print(
                    f"Warning: Failed to read Azure DevOps config: {exc}",
                    file=sys.stderr,
                )

    if not pat:
        print(
            "Error: No Azure DevOps PAT found. Set AZURE_DEVOPS_PAT or configure in project settings."
        )
        sys.exit(1)

    if not organization:
        print(
            "Error: No Azure DevOps organization found. Set AZURE_DEVOPS_ORG or configure in project settings."
        )
        sys.exit(1)

    if not project:
        print(
            "Error: No Azure DevOps project found. Set AZURE_DEVOPS_PROJECT or configure in project settings."
        )
        sys.exit(1)

    return AzureDevOpsRunnerConfig(
        pat=pat,
        organization=organization,
        project=project,
        model=args.model,
        thinking_level=args.thinking_level,
    )


async def cmd_review_pr(args) -> int:
    """Review a pull request."""
    import sys

    # Force unbuffered output so Electron sees it in real-time
    sys.stdout.reconfigure(line_buffering=True)
    sys.stderr.reconfigure(line_buffering=True)

    safe_print(f"[DEBUG] Starting PR review for PR {args.pr_id}")
    safe_print(f"[DEBUG] Project directory: {args.project_dir}")

    safe_print("[DEBUG] Building config...")
    config = get_config(args)
    safe_print(
        f"[DEBUG] Config built: organization={config.organization}, project={config.project}, model={config.model}"
    )

    safe_print("[DEBUG] Creating orchestrator...")
    orchestrator = AzureDevOpsOrchestrator(
        project_dir=args.project_dir,
        config=config,
        progress_callback=print_progress,
    )
    safe_print("[DEBUG] Orchestrator created")

    safe_print(f"[DEBUG] Calling orchestrator.review_pr({args.pr_id})...")
    result = await orchestrator.review_pr(args.pr_id)
    safe_print(f"[DEBUG] review_pr returned, success={result.success}")

    if result.success:
        print(f"\n{'=' * 60}")
        print(f"PR {result.pr_id} Review Complete")
        print(f"{'=' * 60}")
        print(f"Status: {result.overall_status}")
        print(f"Verdict: {result.verdict.value}")
        print(f"Findings: {len(result.findings)}")

        if result.findings:
            print("\nFindings by severity:")
            for f in result.findings:
                emoji = {"critical": "!", "high": "*", "medium": "-", "low": "."}
                print(
                    f"  {emoji.get(f.severity.value, '?')} [{f.severity.value.upper()}] {f.title}"
                )
                print(f"    File: {f.file}:{f.line}")
        return 0
    else:
        print(f"\nReview failed: {result.error}")
        return 1


async def cmd_followup_review_pr(args) -> int:
    """Perform a follow-up review of a pull request."""
    import sys

    # Force unbuffered output
    sys.stdout.reconfigure(line_buffering=True)
    sys.stderr.reconfigure(line_buffering=True)

    safe_print(f"[DEBUG] Starting follow-up review for PR {args.pr_id}")
    safe_print(f"[DEBUG] Project directory: {args.project_dir}")

    safe_print("[DEBUG] Building config...")
    config = get_config(args)
    safe_print(
        f"[DEBUG] Config built: organization={config.organization}, project={config.project}, model={config.model}"
    )

    safe_print("[DEBUG] Creating orchestrator...")
    orchestrator = AzureDevOpsOrchestrator(
        project_dir=args.project_dir,
        config=config,
        progress_callback=print_progress,
    )
    safe_print("[DEBUG] Orchestrator created")

    safe_print(f"[DEBUG] Calling orchestrator.followup_review_pr({args.pr_id})...")

    try:
        result = await orchestrator.followup_review_pr(args.pr_id)
    except ValueError as e:
        print(f"\nFollow-up review failed: {e}")
        return 1

    safe_print(f"[DEBUG] followup_review_pr returned, success={result.success}")

    if result.success:
        print(f"\n{'=' * 60}")
        print(f"PR {result.pr_id} Follow-up Review Complete")
        print(f"{'=' * 60}")
        print(f"Status: {result.overall_status}")
        print(f"Is Follow-up: {result.is_followup_review}")

        if result.resolved_findings:
            print(f"Resolved: {len(result.resolved_findings)} finding(s)")
        if result.unresolved_findings:
            print(f"Still Open: {len(result.unresolved_findings)} finding(s)")
        if result.new_findings_since_last_review:
            print(
                f"New Issues: {len(result.new_findings_since_last_review)} finding(s)"
            )

        print(f"\nSummary:\n{result.summary[:500]}...")

        if result.findings:
            print("\nRemaining Findings:")
            for f in result.findings:
                emoji = {"critical": "!", "high": "*", "medium": "-", "low": "."}
                print(
                    f"  {emoji.get(f.severity.value, '?')} [{f.severity.value.upper()}] {f.title}"
                )
                print(f"    File: {f.file}:{f.line}")
        return 0
    else:
        print(f"\nFollow-up review failed: {result.error}")
        return 1


def main():
    """CLI entry point."""
    import argparse

    parser = argparse.ArgumentParser(
        description="Azure DevOps automation CLI",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )

    # Global options
    parser.add_argument(
        "--project-dir",
        type=Path,
        default=Path.cwd(),
        help="Project directory (default: current)",
    )
    parser.add_argument(
        "--pat",
        type=str,
        help="Azure DevOps PAT (or set AZURE_DEVOPS_PAT)",
    )
    parser.add_argument(
        "--organization",
        type=str,
        help="Azure DevOps organization or auto-detect",
    )
    parser.add_argument(
        "--project",
        type=str,
        help="Azure DevOps project or auto-detect",
    )
    parser.add_argument(
        "--model",
        type=str,
        default="claude-sonnet-4-5-20250929",
        help="AI model to use",
    )
    parser.add_argument(
        "--thinking-level",
        type=str,
        default="medium",
        help="Thinking level for extended reasoning (low, medium, high)",
    )

    subparsers = parser.add_subparsers(dest="command", help="Command to run")

    # review-pr command
    review_parser = subparsers.add_parser("review-pr", help="Review a pull request")
    review_parser.add_argument("pr_id", type=int, help="PR ID to review")

    # followup-review-pr command
    followup_parser = subparsers.add_parser(
        "followup-review-pr",
        help="Follow-up review of a PR (after new commits)",
    )
    followup_parser.add_argument("pr_id", type=int, help="PR ID to review")

    args = parser.parse_args()

    # Validate and sanitize thinking level (handles legacy values like 'ultrathink')
    args.thinking_level = sanitize_thinking_level(args.thinking_level)

    if not args.command:
        parser.print_help()
        sys.exit(1)

    # Route to command handler
    commands = {
        "review-pr": cmd_review_pr,
        "followup-review-pr": cmd_followup_review_pr,
    }

    handler = commands.get(args.command)
    if not handler:
        print(f"Unknown command: {args.command}")
        sys.exit(1)

    try:
        exit_code = asyncio.run(handler(args))
        sys.exit(exit_code)
    except KeyboardInterrupt:
        print("\nInterrupted.")
        sys.exit(1)
    except Exception as e:
        import traceback

        print(f"Error: {e}")
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
