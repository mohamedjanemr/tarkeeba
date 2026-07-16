"""
Azure DevOps Automation Orchestrator
====================================

Main coordinator for Azure DevOps automation workflows:
- PR Review: AI-powered pull request review
- Follow-up Review: Review changes since last review
"""

from __future__ import annotations

import json
import traceback
import urllib.error
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

try:
    from .azure_devops_client import AzureDevOpsClient, AzureDevOpsConfig
    from .models import (
        AzureDevOpsRunnerConfig,
        MergeVerdict,
        PRContext,
        PRReviewResult,
    )
    from .services import PRReviewEngine
except ImportError:
    # Fallback for direct script execution (not as a module)
    from azure_devops_client import AzureDevOpsClient, AzureDevOpsConfig
    from models import (
        AzureDevOpsRunnerConfig,
        MergeVerdict,
        PRContext,
        PRReviewResult,
    )
    from services import PRReviewEngine

# Import safe_print for BrokenPipeError handling
try:
    from core.io_utils import safe_print
except ImportError:
    # Fallback for direct script execution
    import sys
    from pathlib import Path

    sys.path.insert(0, str(Path(__file__).parent.parent.parent))
    from core.io_utils import safe_print


@dataclass
class ProgressCallback:
    """Callback for progress updates."""

    phase: str
    progress: int  # 0-100
    message: str
    pr_id: int | None = None


class AzureDevOpsOrchestrator:
    """
    Orchestrates Azure DevOps automation workflows.

    Usage:
        orchestrator = AzureDevOpsOrchestrator(
            project_dir=Path("/path/to/project"),
            config=config,
        )

        # Review a PR
        result = await orchestrator.review_pr(pr_id=123)
    """

    def __init__(
        self,
        project_dir: Path,
        config: AzureDevOpsRunnerConfig,
        progress_callback: Callable[[ProgressCallback], None] | None = None,
    ):
        self.project_dir = Path(project_dir)
        self.config = config
        self.progress_callback = progress_callback

        # Azure DevOps directory for storing state
        self.azure_devops_dir = self.project_dir / ".auto-claude" / "azure-devops"
        self.azure_devops_dir.mkdir(parents=True, exist_ok=True)

        # Load Azure DevOps config
        self.azure_devops_config = AzureDevOpsConfig(
            pat=config.pat,
            organization=config.organization,
            project=config.project,
        )

        # Initialize client
        self.client = AzureDevOpsClient(
            project_dir=self.project_dir,
            config=self.azure_devops_config,
        )

        # Initialize review engine
        self.review_engine = PRReviewEngine(
            project_dir=self.project_dir,
            azure_devops_dir=self.azure_devops_dir,
            config=self.config,
            progress_callback=self._forward_progress,
        )

    def _report_progress(
        self,
        phase: str,
        progress: int,
        message: str,
        pr_id: int | None = None,
    ) -> None:
        """Report progress to callback if set."""
        if self.progress_callback:
            self.progress_callback(
                ProgressCallback(
                    phase=phase,
                    progress=progress,
                    message=message,
                    pr_id=pr_id,
                )
            )

    def _forward_progress(self, callback) -> None:
        """Forward progress from engine to orchestrator callback."""
        if self.progress_callback:
            self.progress_callback(callback)

    async def _gather_pr_context(self, pr_id: int) -> PRContext:
        """Gather context for a PR."""
        safe_print(f"[Azure DevOps] Fetching PR {pr_id} data...")

        # Get PR details
        pr_data = self.client.get_pr(pr_id)

        # Get changes
        changes_data = self.client.get_pr_changes(pr_id)

        # Get commits
        commits = self.client.get_pr_commits(pr_id)

        # Build diff from changes
        diffs = []
        total_additions = 0
        total_deletions = 0
        changed_files = []

        for change in changes_data.get("changes", []):
            diff = change.get("diff", "")
            if diff:
                diffs.append(diff)

            # Count lines
            for line in diff.split("\n"):
                if line.startswith("+") and not line.startswith("+++"):
                    total_additions += 1
                elif line.startswith("-") and not line.startswith("---"):
                    total_deletions += 1

            changed_files.append(
                {
                    "new_path": change.get("new_path"),
                    "old_path": change.get("old_path"),
                    "diff": diff,
                }
            )

        # Get head SHA
        head_sha = pr_data.get("lastMergeSourceCommit", {}).get("commitId")

        return PRContext(
            pr_id=pr_id,
            title=pr_data.get("title", ""),
            description=pr_data.get("description", ""),
            author=pr_data.get("createdBy", {}).get("displayName", "unknown"),
            source_branch=pr_data.get("sourceRefName", ""),
            target_branch=pr_data.get("targetRefName", ""),
            state=pr_data.get("status", "active"),
            changed_files=changed_files,
            diff="\n".join(diffs),
            total_additions=total_additions,
            total_deletions=total_deletions,
            commits=commits,
            head_sha=head_sha,
        )

    async def review_pr(self, pr_id: int) -> PRReviewResult:
        """
        Perform AI-powered review of a pull request.

        Args:
            pr_id: The PR ID to review

        Returns:
            PRReviewResult with findings and overall assessment
        """
        safe_print(f"[Azure DevOps] Starting review for PR {pr_id}")

        self._report_progress(
            "gathering_context",
            10,
            f"Gathering context for PR {pr_id}...",
            pr_id=pr_id,
        )

        try:
            # Gather PR context
            context = await self._gather_pr_context(pr_id)
            safe_print(
                f"[Azure DevOps] Context gathered: {context.title} "
                f"({len(context.changed_files)} files, {context.total_additions}+/{context.total_deletions}-)"
            )

            self._report_progress(
                "analyzing", 30, "Running AI review...", pr_id=pr_id
            )

            # Run review
            findings, verdict, summary, blockers = await self.review_engine.run_review(
                context
            )
            safe_print(f"[Azure DevOps] Review complete: {len(findings)} findings")

            # Map verdict to overall_status
            if verdict == MergeVerdict.BLOCKED:
                overall_status = "request_changes"
            elif verdict == MergeVerdict.NEEDS_REVISION:
                overall_status = "request_changes"
            elif verdict == MergeVerdict.MERGE_WITH_CHANGES:
                overall_status = "comment"
            else:
                overall_status = "approve"

            # Generate summary
            full_summary = self.review_engine.generate_summary(
                findings=findings,
                verdict=verdict,
                verdict_reasoning=summary,
                blockers=blockers,
            )

            # Create result
            result = PRReviewResult(
                pr_id=pr_id,
                project=self.config.project,
                success=True,
                findings=findings,
                summary=full_summary,
                overall_status=overall_status,
                verdict=verdict,
                verdict_reasoning=summary,
                blockers=blockers,
                reviewed_commit_sha=context.head_sha,
            )

            # Save result
            result.save(self.azure_devops_dir)

            self._report_progress("complete", 100, "Review complete!", pr_id=pr_id)

            return result

        except urllib.error.HTTPError as e:
            error_msg = f"Azure DevOps API error {e.code}"
            if e.code == 401:
                error_msg = "Azure DevOps authentication failed. Check your PAT."
            elif e.code == 403:
                error_msg = "Azure DevOps access forbidden. Check your permissions."
            elif e.code == 404:
                error_msg = f"PR {pr_id} not found in Azure DevOps."
            elif e.code == 429:
                error_msg = "Azure DevOps rate limit exceeded. Please try again later."
            safe_print(f"[Azure DevOps] Review failed for {pr_id}: {error_msg}")
            result = PRReviewResult(
                pr_id=pr_id,
                project=self.config.project,
                success=False,
                error=error_msg,
            )
            result.save(self.azure_devops_dir)
            return result

        except json.JSONDecodeError as e:
            error_msg = f"Invalid JSON response from Azure DevOps: {e}"
            safe_print(f"[Azure DevOps] Review failed for {pr_id}: {error_msg}")
            result = PRReviewResult(
                pr_id=pr_id,
                project=self.config.project,
                success=False,
                error=error_msg,
            )
            result.save(self.azure_devops_dir)
            return result

        except OSError as e:
            error_msg = f"File system error: {e}"
            safe_print(f"[Azure DevOps] Review failed for {pr_id}: {error_msg}")
            result = PRReviewResult(
                pr_id=pr_id,
                project=self.config.project,
                success=False,
                error=error_msg,
            )
            result.save(self.azure_devops_dir)
            return result

        except Exception as e:
            # Catch-all for unexpected errors, with full traceback for debugging
            error_details = f"{type(e).__name__}: {e}"
            full_traceback = traceback.format_exc()
            safe_print(f"[Azure DevOps] Review failed for {pr_id}: {error_details}")
            safe_print(f"[Azure DevOps] Traceback:\n{full_traceback}")

            result = PRReviewResult(
                pr_id=pr_id,
                project=self.config.project,
                success=False,
                error=f"{error_details}\n\nTraceback:\n{full_traceback}",
            )
            result.save(self.azure_devops_dir)
            return result

    async def followup_review_pr(self, pr_id: int) -> PRReviewResult:
        """
        Perform a follow-up review of a PR.

        Only reviews changes since the last review.

        Args:
            pr_id: The PR ID to review

        Returns:
            PRReviewResult with follow-up analysis
        """
        safe_print(f"[Azure DevOps] Starting follow-up review for PR {pr_id}")

        # Load previous review
        previous_review = PRReviewResult.load(self.azure_devops_dir, pr_id)

        if not previous_review:
            raise ValueError(
                f"No previous review found for PR {pr_id}. Run initial review first."
            )

        if not previous_review.reviewed_commit_sha:
            raise ValueError(
                f"Previous review for PR {pr_id} doesn't have commit SHA. "
                "Re-run initial review."
            )

        self._report_progress(
            "gathering_context",
            10,
            f"Gathering follow-up context for PR {pr_id}...",
            pr_id=pr_id,
        )

        try:
            # Get current PR state
            context = await self._gather_pr_context(pr_id)

            # Check if there are new commits
            if context.head_sha == previous_review.reviewed_commit_sha:
                safe_print(
                    f"[Azure DevOps] No new commits since last review at {previous_review.reviewed_commit_sha[:8]}"
                )
                result = PRReviewResult(
                    pr_id=pr_id,
                    project=self.config.project,
                    success=True,
                    findings=previous_review.findings,
                    summary="No new commits since last review. Previous findings still apply.",
                    overall_status=previous_review.overall_status,
                    verdict=previous_review.verdict,
                    verdict_reasoning="No changes since last review.",
                    reviewed_commit_sha=context.head_sha,
                    is_followup_review=True,
                    unresolved_findings=[f.id for f in previous_review.findings],
                )
                result.save(self.azure_devops_dir)
                return result

            self._report_progress(
                "analyzing",
                30,
                "Analyzing changes since last review...",
                pr_id=pr_id,
            )

            # Run full review on current state
            findings, verdict, summary, blockers = await self.review_engine.run_review(
                context
            )

            # Compare with previous findings
            previous_finding_titles = {f.title for f in previous_review.findings}
            current_finding_titles = {f.title for f in findings}

            resolved = previous_finding_titles - current_finding_titles
            unresolved = previous_finding_titles & current_finding_titles
            new_findings = current_finding_titles - previous_finding_titles

            # Map verdict to overall_status
            if verdict == MergeVerdict.BLOCKED:
                overall_status = "request_changes"
            elif verdict == MergeVerdict.NEEDS_REVISION:
                overall_status = "request_changes"
            elif verdict == MergeVerdict.MERGE_WITH_CHANGES:
                overall_status = "comment"
            else:
                overall_status = "approve"

            # Generate summary
            full_summary = self.review_engine.generate_summary(
                findings=findings,
                verdict=verdict,
                verdict_reasoning=summary,
                blockers=blockers,
            )

            # Add follow-up info
            full_summary = f"""### Follow-up Review

**Resolved**: {len(resolved)} finding(s)
**Still Open**: {len(unresolved)} finding(s)
**New Issues**: {len(new_findings)} finding(s)

---

{full_summary}"""

            result = PRReviewResult(
                pr_id=pr_id,
                project=self.config.project,
                success=True,
                findings=findings,
                summary=full_summary,
                overall_status=overall_status,
                verdict=verdict,
                verdict_reasoning=summary,
                blockers=blockers,
                reviewed_commit_sha=context.head_sha,
                is_followup_review=True,
                resolved_findings=list(resolved),
                unresolved_findings=list(unresolved),
                new_findings_since_last_review=list(new_findings),
            )

            result.save(self.azure_devops_dir)

            self._report_progress(
                "complete", 100, "Follow-up review complete!", pr_id=pr_id
            )

            return result

        except urllib.error.HTTPError as e:
            error_msg = f"Azure DevOps API error {e.code}"
            if e.code == 401:
                error_msg = "Azure DevOps authentication failed. Check your PAT."
            elif e.code == 403:
                error_msg = "Azure DevOps access forbidden. Check your permissions."
            elif e.code == 404:
                error_msg = f"PR {pr_id} not found in Azure DevOps."
            elif e.code == 429:
                error_msg = "Azure DevOps rate limit exceeded. Please try again later."
            safe_print(
                f"[Azure DevOps] Follow-up review failed for {pr_id}: {error_msg}"
            )
            result = PRReviewResult(
                pr_id=pr_id,
                project=self.config.project,
                success=False,
                error=error_msg,
                is_followup_review=True,
            )
            result.save(self.azure_devops_dir)
            return result

        except json.JSONDecodeError as e:
            error_msg = f"Invalid JSON response from Azure DevOps: {e}"
            safe_print(
                f"[Azure DevOps] Follow-up review failed for {pr_id}: {error_msg}"
            )
            result = PRReviewResult(
                pr_id=pr_id,
                project=self.config.project,
                success=False,
                error=error_msg,
                is_followup_review=True,
            )
            result.save(self.azure_devops_dir)
            return result

        except Exception as e:
            # Catch-all for unexpected errors
            error_details = f"{type(e).__name__}: {e}"
            safe_print(
                f"[Azure DevOps] Follow-up review failed for {pr_id}: {error_details}"
            )
            result = PRReviewResult(
                pr_id=pr_id,
                project=self.config.project,
                success=False,
                error=error_details,
                is_followup_review=True,
            )
            result.save(self.azure_devops_dir)
            return result
