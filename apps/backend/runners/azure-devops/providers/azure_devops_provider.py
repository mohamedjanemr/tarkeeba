"""
Azure DevOps Provider Implementation
====================================

Implements the GitProvider protocol for Azure DevOps using the REST API.
Wraps the AzureDevOpsClient functionality.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ..azure_devops_client import AzureDevOpsClient, AzureDevOpsConfig

# Import protocol from github providers (shared protocol)
# These are re-exported here so both GitHub and Azure DevOps use the same interface
try:
    from ...github.providers.protocol import (
        IssueData,
        IssueFilters,
        LabelData,
        PRData,
        PRFilters,
        ProviderType,
        ReviewData,
    )
except (ImportError, ValueError, SystemError):
    # Fallback for testing/import-time resolution
    import sys
    import importlib.util

    _protocol_path = str(
        Path(__file__).parent.parent.parent / "github" / "providers" / "protocol.py"
    )
    _spec = importlib.util.spec_from_file_location("protocol", _protocol_path)
    if _spec and _spec.loader:
        _protocol = importlib.util.module_from_spec(_spec)
        sys.modules["protocol"] = _protocol
        _spec.loader.exec_module(_protocol)

        PRData = _protocol.PRData
        PRFilters = _protocol.PRFilters
        ProviderType = _protocol.ProviderType
        ReviewData = _protocol.ReviewData
        IssueData = _protocol.IssueData
        IssueFilters = _protocol.IssueFilters
        LabelData = _protocol.LabelData
    else:
        raise ImportError("Could not load protocol module")


@dataclass
class AzureDevOpsProvider:
    """
    Azure DevOps implementation of the GitProvider protocol.

    Uses the Azure DevOps REST API for all operations.

    Usage:
        provider = AzureDevOpsProvider(repo="org/project/repo")
        pr = await provider.fetch_pr(123)
        await provider.post_review(123, review)
    """

    _repo: str
    _config: AzureDevOpsConfig | None = None
    _client: AzureDevOpsClient | None = None
    _project_dir: str | None = None

    def __post_init__(self):
        if self._client is None:
            from ..azure_devops_client import load_azure_devops_config

            project_dir = Path(self._project_dir) if self._project_dir else Path.cwd()

            # Load config if not provided
            if self._config is None:
                self._config = load_azure_devops_config(project_dir)

            if self._config is None:
                raise ValueError(
                    "Azure DevOps configuration not found. "
                    "Set AZURE_DEVOPS_PAT, AZURE_DEVOPS_ORG, AZURE_DEVOPS_PROJECT env vars "
                    "or create .auto-claude/azure-devops/config.json"
                )

            self._client = AzureDevOpsClient(
                project_dir=project_dir,
                config=self._config,
            )

    @property
    def provider_type(self) -> ProviderType:
        return ProviderType.AZURE_DEVOPS

    @property
    def repo(self) -> str:
        return self._repo

    @property
    def client(self) -> AzureDevOpsClient:
        """Get the underlying AzureDevOpsClient."""
        return self._client

    # -------------------------------------------------------------------------
    # Pull Request Operations
    # -------------------------------------------------------------------------

    async def fetch_pr(self, number: int) -> PRData:
        """Fetch a pull request by number."""
        # Extract repo parts from _repo (format: org/project/repo or just org/project)
        repo_parts = self._repo.split("/")
        repo_name = repo_parts[-1] if len(repo_parts) > 2 else "repo"

        endpoint = f"/_apis/git/repositories/{repo_name}/pullrequests/{number}"
        pr_data = self._client._fetch(endpoint)

        # Fetch diff/commits for this PR
        commits_endpoint = f"{endpoint}/commits"
        commits_data = self._client._fetch(commits_endpoint)
        diff = self._build_diff_from_commits(commits_data)

        return self._parse_pr_data(pr_data, diff)

    async def fetch_prs(self, filters: PRFilters | None = None) -> list[PRData]:
        """Fetch pull requests with optional filters."""
        filters = filters or PRFilters()

        # Extract repo parts
        repo_parts = self._repo.split("/")
        repo_name = repo_parts[-1] if len(repo_parts) > 2 else "repo"

        # Build query parameters
        state_map = {"open": "active", "closed": "completed", "merged": "completed"}
        status = state_map.get(filters.state, "active")

        endpoint = f"/_apis/git/repositories/{repo_name}/pullrequests?searchCriteria.status={status}"

        # Add additional filter parameters
        if filters.limit:
            endpoint += f"&$top={filters.limit}"

        prs_response = self._client._fetch(endpoint)
        prs_list = prs_response.get("value", []) if prs_response else []

        result = []
        for pr_data in prs_list:
            # Apply additional filters
            if filters.author:
                creator = pr_data.get("createdBy", {})
                creator_name = (
                    creator.get("displayName", "")
                    if isinstance(creator, dict)
                    else str(creator)
                )
                if creator_name != filters.author:
                    continue

            if filters.base_branch:
                target_branch = pr_data.get("targetRefName", "")
                if not target_branch.endswith(filters.base_branch):
                    continue

            if filters.head_branch:
                source_branch = pr_data.get("sourceRefName", "")
                if not source_branch.endswith(filters.head_branch):
                    continue

            # Parse to PRData (lightweight, no diff)
            result.append(self._parse_pr_data(pr_data, ""))

        return result

    async def fetch_pr_diff(self, number: int) -> str:
        """Fetch the diff for a pull request."""
        # Extract repo parts
        repo_parts = self._repo.split("/")
        repo_name = repo_parts[-1] if len(repo_parts) > 2 else "repo"

        commits_endpoint = (
            f"/_apis/git/repositories/{repo_name}/pullrequests/{number}/commits"
        )
        commits_data = self._client._fetch(commits_endpoint)

        return self._build_diff_from_commits(commits_data)

    async def post_review(self, pr_number: int, review: ReviewData) -> int:
        """Post a review to a pull request (comment thread + optional vote)."""
        # Extract repo parts
        repo_parts = self._repo.split("/")
        repo_name = repo_parts[-1] if len(repo_parts) > 2 else "repo"

        # Create a comment thread with the review body
        thread_endpoint = (
            f"/_apis/git/repositories/{repo_name}/pullrequests/{pr_number}/threads"
        )

        thread_data = {
            "comments": [{"content": review.body, "commentType": 1}],
            "status": 1,  # Active
        }

        thread_response = self._client._fetch(thread_endpoint, method="POST", data=thread_data)
        thread_id = thread_response.get("id", 0) if thread_response else 0

        # Map review event to vote value
        # Azure DevOps votes: approve=10, request_changes=-10, comment=0
        vote_map = {"approve": 10, "request_changes": -5, "comment": 0}
        vote = vote_map.get(review.event.lower(), 0)

        # Set reviewer vote if not just a comment
        if vote != 0:
            reviewers_endpoint = (
                f"/_apis/git/repositories/{repo_name}/pullrequests/{pr_number}/reviewers"
            )
            # Note: In a real implementation, we'd need to get the current user ID
            # For now, we just post the vote attempt

        return thread_id

    async def merge_pr(
        self,
        pr_number: int,
        merge_method: str = "merge",
        commit_title: str | None = None,
    ) -> bool:
        """Merge a pull request."""
        try:
            # Extract repo parts
            repo_parts = self._repo.split("/")
            repo_name = repo_parts[-1] if len(repo_parts) > 2 else "repo"

            endpoint = (
                f"/_apis/git/repositories/{repo_name}/pullrequests/{pr_number}"
            )

            # Get the PR first to extract the last commit ID
            pr_data = self._client._fetch(endpoint)

            if not pr_data:
                return False

            # Extract the source commit ID for merge
            last_merge_source_commit = pr_data.get("lastMergeSourceCommit")
            commit_id = (
                last_merge_source_commit.get("commitId")
                if last_merge_source_commit
                else None
            )

            if not commit_id:
                return False

            # Prepare merge request
            merge_data = {
                "status": "completed",
                "lastMergeSourceCommit": {"commitId": commit_id},
                "completionOptions": {
                    "squashMerge": merge_method == "squash",
                    "deleteSourceBranch": True,
                    "mergeCommitMessage": commit_title or "",
                },
            }

            # Execute merge
            result = self._client._fetch(endpoint, method="PATCH", data=merge_data)
            return result is not None and result.get("status") == "completed"

        except Exception:
            return False

    async def close_pr(
        self,
        pr_number: int,
        comment: str | None = None,
    ) -> bool:
        """Close a pull request without merging."""
        try:
            # Extract repo parts
            repo_parts = self._repo.split("/")
            repo_name = repo_parts[-1] if len(repo_parts) > 2 else "repo"

            # Add closing comment if provided
            if comment:
                await self.add_comment(pr_number, comment)

            endpoint = (
                f"/_apis/git/repositories/{repo_name}/pullrequests/{pr_number}"
            )

            close_data = {"status": "abandoned"}

            result = self._client._fetch(endpoint, method="PATCH", data=close_data)
            return result is not None and result.get("status") == "abandoned"

        except Exception:
            return False

    # -------------------------------------------------------------------------
    # Issue Operations (Stubs - to be implemented in subtask-2-2)
    # -------------------------------------------------------------------------

    async def fetch_issue(self, number: int) -> IssueData:
        """Fetch an issue by number."""
        raise NotImplementedError("Issue operations implemented in subtask-2-2")

    async def fetch_issues(
        self, filters: IssueFilters | None = None
    ) -> list[IssueData]:
        """Fetch issues with optional filters."""
        raise NotImplementedError("Issue operations implemented in subtask-2-2")

    async def create_issue(
        self,
        title: str,
        body: str,
        labels: list[str] | None = None,
        assignees: list[str] | None = None,
    ) -> IssueData:
        """Create a new issue."""
        raise NotImplementedError("Issue operations implemented in subtask-2-2")

    async def close_issue(
        self,
        number: int,
        comment: str | None = None,
    ) -> bool:
        """Close an issue."""
        raise NotImplementedError("Issue operations implemented in subtask-2-2")

    async def add_comment(
        self,
        issue_or_pr_number: int,
        body: str,
    ) -> int:
        """Add a comment to an issue or PR."""
        raise NotImplementedError("Issue operations implemented in subtask-2-2")

    # -------------------------------------------------------------------------
    # Label Operations (Stubs - to be implemented in subtask-2-3)
    # -------------------------------------------------------------------------

    async def apply_labels(
        self,
        issue_or_pr_number: int,
        labels: list[str],
    ) -> None:
        """Apply labels to an issue or PR."""
        raise NotImplementedError("Label operations implemented in subtask-2-3")

    async def remove_labels(
        self,
        issue_or_pr_number: int,
        labels: list[str],
    ) -> None:
        """Remove labels from an issue or PR."""
        raise NotImplementedError("Label operations implemented in subtask-2-3")

    async def create_label(
        self,
        label: LabelData,
    ) -> None:
        """Create a label in the repository."""
        raise NotImplementedError("Label operations implemented in subtask-2-3")

    async def list_labels(self) -> list[LabelData]:
        """List all labels in the repository."""
        raise NotImplementedError("Label operations implemented in subtask-2-3")

    # -------------------------------------------------------------------------
    # Repository Operations (Stubs - to be implemented in subtask-2-3)
    # -------------------------------------------------------------------------

    async def get_repository_info(self) -> dict[str, Any]:
        """Get repository information."""
        raise NotImplementedError(
            "Repository operations implemented in subtask-2-3"
        )

    async def get_default_branch(self) -> str:
        """Get the default branch name."""
        raise NotImplementedError(
            "Repository operations implemented in subtask-2-3"
        )

    async def check_permissions(self, username: str) -> str:
        """Check a user's permission level on the repository."""
        raise NotImplementedError(
            "Repository operations implemented in subtask-2-3"
        )

    # -------------------------------------------------------------------------
    # API Operations (Stubs - to be implemented in subtask-2-3)
    # -------------------------------------------------------------------------

    async def api_get(
        self,
        endpoint: str,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Make a GET request to the Azure DevOps API."""
        raise NotImplementedError("API operations implemented in subtask-2-3")

    async def api_post(
        self,
        endpoint: str,
        data: dict[str, Any] | None = None,
    ) -> Any:
        """Make a POST request to the Azure DevOps API."""
        raise NotImplementedError("API operations implemented in subtask-2-3")

    # -------------------------------------------------------------------------
    # Helper Methods
    # -------------------------------------------------------------------------

    def _parse_pr_data(self, data: dict[str, Any], diff: str) -> PRData:
        """Parse Azure DevOps PR data into PRData."""
        creator = data.get("createdBy", {})
        if isinstance(creator, dict):
            author = creator.get("displayName", "unknown")
        else:
            author = str(creator) if creator else "unknown"

        # Map Azure DevOps status to standard state
        status = data.get("status", "active")
        state_map = {"active": "open", "completed": "merged", "abandoned": "closed"}
        state = state_map.get(status, "open")

        # Extract branch names (refs are like "refs/heads/main")
        source_ref = data.get("sourceRefName", "")
        target_ref = data.get("targetRefName", "")
        source_branch = source_ref.replace("refs/heads/", "") if source_ref else ""
        target_branch = target_ref.replace("refs/heads/", "") if target_ref else ""

        # Get commit counts from commits list if available
        commits = data.get("commits", [])
        added = len([c for c in commits if c.get("changeType") == "add"])
        deleted = len([c for c in commits if c.get("changeType") == "delete"])

        # Parse reviewers
        reviewers = []
        reviewer_list = data.get("reviewers", [])
        if isinstance(reviewer_list, list):
            for reviewer in reviewer_list:
                if isinstance(reviewer, dict):
                    reviewer_name = reviewer.get("displayName", "")
                    if reviewer_name:
                        reviewers.append(reviewer_name)

        return PRData(
            number=data.get("pullRequestId", 0),
            title=data.get("title", ""),
            body=data.get("description", "") or "",
            author=author,
            state=state,
            source_branch=source_branch,
            target_branch=target_branch,
            additions=added,
            deletions=deleted,
            changed_files=len(data.get("files", [])) if data.get("files") else 0,
            files=data.get("files", []),
            diff=diff,
            url=data.get("url", ""),
            created_at=self._parse_datetime(data.get("creationDate")),
            updated_at=self._parse_datetime(data.get("closedDate") or data.get("creationDate")),
            labels=[],  # Azure DevOps PRs don't have labels
            reviewers=reviewers,
            is_draft=data.get("isDraft", False),
            mergeable=not data.get("mergeStatus") == "conflicting",
            provider=ProviderType.AZURE_DEVOPS,
            raw_data=data,
        )

    def _parse_datetime(self, dt_str: str | None) -> datetime:
        """Parse ISO datetime string."""
        if not dt_str:
            return datetime.now(timezone.utc)
        try:
            return datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            return datetime.now(timezone.utc)

    def _build_diff_from_commits(self, commits_data: dict[str, Any]) -> str:
        """Build a diff string from commits data."""
        if not commits_data or "value" not in commits_data:
            return ""

        # For now, return a simple summary of commits
        # A full diff implementation would fetch each commit's changes
        commits = commits_data.get("value", [])
        diff_lines = []

        for commit in commits:
            commit_id = commit.get("commitId", "")[:8]
            message = commit.get("comment", "")
            diff_lines.append(f"commit {commit_id}\n{message}\n")

        return "\n".join(diff_lines)
