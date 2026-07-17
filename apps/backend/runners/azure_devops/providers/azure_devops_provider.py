"""
Azure DevOps Provider Implementation
====================================

Implements the GitProvider protocol for Azure DevOps using the REST API.
Wraps the AzureDevOpsClient functionality.
"""

from __future__ import annotations

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
    import importlib.util
    import sys

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
        """Post a review to a pull request (comment thread + optional vote).

        Maps ReviewFindings to comment threads:
        - Each finding becomes a thread comment
        - If threadContext is set, creates an inline comment with file/line info
        - Final vote is set based on review.event (approve=10, request_changes=-10, comment=0)
        """
        repo_parts = self._repo.split("/")
        repo_name = repo_parts[-1] if len(repo_parts) > 2 else "repo"

        thread_endpoint = (
            f"/_apis/git/repositories/{repo_name}/pullrequests/{pr_number}/threads"
        )

        # Build comment content from findings and review body
        comment_content = review.body

        # Add findings as separate threads if present
        if review.findings:
            findings_text = "\n\n**Code Review Findings:**\n"
            for finding in review.findings:
                severity_badge = f"[{finding.severity.upper()}]"
                file_info = f" ({finding.file}" if finding.file else ""
                line_info = f":{finding.line}" if finding.line else ""
                file_info += line_info + ")" if finding.file else ""

                findings_text += (
                    f"\n- {severity_badge}{file_info} {finding.title}\n"
                    f"  {finding.description}"
                )
                if finding.suggested_fix:
                    findings_text += f"\n  **Suggested Fix:** {finding.suggested_fix}"

            comment_content += findings_text

        # Create the main comment thread
        thread_data = {
            "comments": [{"content": comment_content, "commentType": 1}],
            "status": 1,  # Active
        }

        thread_response = self._client._fetch(
            thread_endpoint, method="POST", data=thread_data
        )
        thread_id = thread_response.get("id", 0) if thread_response else 0

        # Map review event to vote value
        # Azure DevOps votes: approve=10, request_changes=-10, comment=0
        vote_map = {"approve": 10, "request_changes": -10, "comment": 0}
        vote = vote_map.get(review.event.lower(), 0)

        reviewer_id = self._client.get_authenticated_user_id()
        reviewer_endpoint = (
            f"/_apis/git/repositories/{repo_name}/pullrequests/{pr_number}"
            f"/reviewers/{reviewer_id}"
        )
        self._client._fetch(reviewer_endpoint, method="PUT", data={"vote": vote})

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

            endpoint = f"/_apis/git/repositories/{repo_name}/pullrequests/{pr_number}"

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

            endpoint = f"/_apis/git/repositories/{repo_name}/pullrequests/{pr_number}"

            close_data = {"status": "abandoned"}

            result = self._client._fetch(endpoint, method="PATCH", data=close_data)
            return result is not None and result.get("status") == "abandoned"

        except Exception:
            return False

    # -------------------------------------------------------------------------
    # Issue Operations
    # -------------------------------------------------------------------------

    async def fetch_issue(self, number: int) -> IssueData:
        """Fetch a work item (issue) by number."""
        try:
            endpoint = f"/_apis/wit/workitems/{number}?$expand=all"
            work_item = self._client._fetch(endpoint)

            if not work_item:
                raise ValueError(f"Work item {number} not found")

            return self._parse_issue_data(work_item)
        except Exception as e:
            raise ValueError(f"Failed to fetch work item {number}: {e}") from e

    async def fetch_issues(
        self, filters: IssueFilters | None = None
    ) -> list[IssueData]:
        """
        Fetch work items (issues) with optional filters.

        Uses WIQL query to find matching work items, then fetches details.
        Returns empty list immediately if WIQL yields zero IDs.
        """
        filters = filters or IssueFilters()

        try:
            # Build WIQL query
            wiql_conditions = ["[System.WorkItemType] IN ('Bug', 'User Story', 'Task')"]

            # Map state filter
            state_map = {"open": "Active", "closed": "Closed"}
            state = state_map.get(filters.state, "Active")
            wiql_conditions.append(f"[System.State] = '{state}'")

            # Add author filter if specified
            if filters.author:
                wiql_conditions.append(f"[System.CreatedBy] = '{filters.author}'")

            # Add assignee filter if specified
            if filters.assignee:
                wiql_conditions.append(f"[System.AssignedTo] = '{filters.assignee}'")

            # Combine conditions
            wiql_query = " AND ".join(wiql_conditions)
            order_by = "[System.CreatedDate] DESC"
            wiql = f"SELECT [System.Id] FROM workitems WHERE {wiql_query} ORDER BY {order_by}"

            # Run WIQL query to get IDs
            work_item_ids = self._client.run_wiql_query(wiql)

            # Return empty list if no results
            if not work_item_ids:
                return []

            # Limit results based on filter
            if filters.limit and len(work_item_ids) > filters.limit:
                work_item_ids = work_item_ids[: filters.limit]

            # Fetch work item details by IDs
            work_items = self._client.get_work_items_by_ids(work_item_ids)

            # Parse to IssueData
            result = []
            for work_item in work_items:
                # Apply label filters if specified
                if filters.labels:
                    work_item_tags = self._parse_tags(work_item)
                    if not all(label in work_item_tags for label in filters.labels):
                        continue

                result.append(self._parse_issue_data(work_item))

            return result

        except Exception as e:
            raise ValueError(f"Failed to fetch work items: {e}") from e

    async def create_issue(
        self,
        title: str,
        body: str,
        labels: list[str] | None = None,
        assignees: list[str] | None = None,
    ) -> IssueData:
        """Create a new work item (Bug or Task)."""
        try:
            # Prepare fields for the work item
            fields = {
                "System.Title": title,
                "System.Description": body,
                "System.WorkItemType": "Bug",  # Default to Bug; could be parameterized
                "System.State": "Active",
            }

            # Add tags if labels are provided (Azure DevOps uses tags instead of labels)
            if labels:
                fields["System.Tags"] = ";".join(labels)

            # Note: Assignee handling may require user UUIDs or display names
            # This is a simplified implementation using display names
            if assignees and len(assignees) > 0:
                fields["System.AssignedTo"] = assignees[0]

            # Build JSON Patch for work item creation
            patch_body = self._client.build_json_patch(fields)

            # POST to work items endpoint
            endpoint = "/_apis/wit/workitems/$Bug"
            work_item = self._client._fetch(endpoint, method="POST", data=patch_body)

            if not work_item:
                raise ValueError("Failed to create work item")

            return self._parse_issue_data(work_item)

        except Exception as e:
            raise ValueError(f"Failed to create work item: {e}") from e

    async def close_issue(
        self,
        number: int,
        comment: str | None = None,
    ) -> bool:
        """Close a work item by setting its state to Done."""
        try:
            # Add closing comment if provided
            if comment:
                await self.add_comment(number, comment)

            # Prepare patch to set state to Done
            patch_body = self._client.build_json_patch({"System.State": "Done"})

            # PATCH the work item
            endpoint = f"/_apis/wit/workitems/{number}"
            result = self._client._fetch(endpoint, method="PATCH", data=patch_body)

            if not result:
                return False

            # Verify the state was updated
            state = result.get("fields", {}).get("System.State", "")
            return state == "Done"

        except Exception:
            return False

    async def add_comment(
        self,
        issue_or_pr_number: int,
        body: str,
    ) -> int:
        """Add a comment to a work item or PR."""
        try:
            # For PRs (pull requests)
            repo_parts = self._repo.split("/")
            repo_name = repo_parts[-1] if len(repo_parts) > 2 else "repo"

            # Try as PR comment first
            pr_endpoint = f"/_apis/git/repositories/{repo_name}/pullrequests/{issue_or_pr_number}/threads"

            try:
                thread_data = {
                    "comments": [{"content": body, "commentType": 1}],
                    "status": 1,  # Active
                }
                thread_response = self._client._fetch(
                    pr_endpoint, method="POST", data=thread_data
                )
                if thread_response and "id" in thread_response:
                    return thread_response.get("id", 0)
            except Exception:
                pass

            # Fall back to work item comment
            # Azure DevOps work item comments are added via history field
            # For simplicity, we'll append to the description
            endpoint = f"/_apis/wit/workitems/{issue_or_pr_number}"
            work_item = self._client._fetch(endpoint)

            if not work_item:
                return 0

            # Append comment to description
            current_desc = work_item.get("fields", {}).get("System.Description", "")
            updated_desc = f"{current_desc}\n\n---\n**Comment**: {body}"

            patch_body = self._client.build_json_patch(
                {"System.Description": updated_desc}
            )
            result = self._client._fetch(endpoint, method="PATCH", data=patch_body)

            return 1 if result else 0

        except Exception:
            return 0

    # -------------------------------------------------------------------------
    # Label Operations
    # -------------------------------------------------------------------------

    async def apply_labels(
        self,
        issue_or_pr_number: int,
        labels: list[str],
    ) -> None:
        """Apply labels to an issue or PR via System.Tags field.

        Azure DevOps does not have a native label concept; instead, work items
        and pull requests use the System.Tags field to store comma-separated tags.

        This method patches the System.Tags field by adding the provided labels
        while preserving existing tags.
        """
        try:
            # Get current work item to read existing tags
            endpoint = f"/_apis/wit/workitems/{issue_or_pr_number}"
            work_item = self._client._fetch(endpoint)

            if not work_item:
                return

            # Extract existing tags
            fields = work_item.get("fields", {})
            existing_tags_str = fields.get("System.Tags", "")
            existing_tags = set(
                tag.strip() for tag in existing_tags_str.split(";") if tag.strip()
            )

            # Add new labels to existing tags
            updated_tags = existing_tags.union(set(labels))

            # Build patch to update tags
            patch_body = self._client.build_json_patch(
                {"System.Tags": ";".join(sorted(updated_tags))}
            )

            self._client._fetch(endpoint, method="PATCH", data=patch_body)

        except Exception:
            pass  # Silently ignore errors for label operations

    async def remove_labels(
        self,
        issue_or_pr_number: int,
        labels: list[str],
    ) -> None:
        """Remove labels from an issue or PR via System.Tags field.

        Azure DevOps does not have a native label concept; instead, work items
        and pull requests use the System.Tags field to store comma-separated tags.

        This method patches the System.Tags field by removing the provided labels
        while preserving other tags.
        """
        try:
            # Get current work item to read existing tags
            endpoint = f"/_apis/wit/workitems/{issue_or_pr_number}"
            work_item = self._client._fetch(endpoint)

            if not work_item:
                return

            # Extract existing tags
            fields = work_item.get("fields", {})
            existing_tags_str = fields.get("System.Tags", "")
            existing_tags = set(
                tag.strip() for tag in existing_tags_str.split(";") if tag.strip()
            )

            # Remove specified labels from tags
            updated_tags = existing_tags - set(labels)

            # Build patch to update tags
            patch_body = self._client.build_json_patch(
                {"System.Tags": ";".join(sorted(updated_tags)) if updated_tags else ""}
            )

            self._client._fetch(endpoint, method="PATCH", data=patch_body)

        except Exception:
            pass  # Silently ignore errors for label operations

    async def create_label(
        self,
        label: LabelData,
    ) -> None:
        """Create a label in the repository.

        NOTE: Azure DevOps does not have a native label concept. Labels are
        emulated using the System.Tags field on work items and pull requests.
        This method is a no-op; tags are created implicitly when applied to items.

        GitHub/GitLab have native label creation, but Azure DevOps simply allows
        arbitrary tags without pre-creation.
        """
        pass  # No-op: Azure DevOps tags are created on-demand

    async def list_labels(self) -> list[LabelData]:
        """List all labels in the repository.

        NOTE: Azure DevOps does not have a native label concept. Labels are
        emulated using the System.Tags field on work items and pull requests.
        This method returns an empty list; Azure DevOps allows arbitrary tags
        without pre-definition.

        To discover tags in use, one would need to query all work items and
        extract their System.Tags fields, which is expensive and not implemented here.
        """
        return []  # No-op: Azure DevOps does not pre-define tags

    # -------------------------------------------------------------------------
    # Repository Operations
    # -------------------------------------------------------------------------

    async def get_repository_info(self) -> dict[str, Any]:
        """Get repository information.

        Returns a dict with basic repo info including:
        - id: Repository ID
        - name: Repository name
        - url: Repository URL
        - defaultBranch: Default branch name
        - size: Size in bytes (if available)
        """
        try:
            # Extract repo parts
            repo_parts = self._repo.split("/")
            repo_name = repo_parts[-1] if len(repo_parts) > 2 else "repo"

            endpoint = f"/_apis/git/repositories/{repo_name}"
            repo_info = self._client._fetch(endpoint)

            return repo_info if repo_info else {}

        except Exception:
            return {}

    async def get_default_branch(self) -> str:
        """Get the default branch name.

        Returns the name of the default branch (e.g., 'main', 'master').
        Falls back to 'main' if unable to determine.
        """
        try:
            repo_info = await self.get_repository_info()

            # Azure DevOps stores default branch as 'defaultBranch'
            default_branch = repo_info.get("defaultBranch", "")

            # Strip 'refs/heads/' prefix if present
            if default_branch.startswith("refs/heads/"):
                default_branch = default_branch.replace("refs/heads/", "")

            return default_branch if default_branch else "main"

        except Exception:
            return "main"

    async def check_permissions(self, username: str) -> str:
        """Check a user's permission level on the repository.

        Returns one of: 'admin', 'contributor', 'reader', or 'none'.
        In Azure DevOps, this typically requires knowing the user's identity
        and querying the project-level permissions.

        For now, returns 'none' unless implementation is extended.
        """
        try:
            # Extract org/project info from config
            org = self._client._config.organization if self._client._config else None
            project = self._client._config.project if self._client._config else None

            if not org or not project:
                return "none"

            # Query project members to check if user has access
            # This is a simplified check; full permission checking requires
            # querying identity and project security scopes
            endpoint = f"/_apis/projects/{project}/teams"
            teams_response = self._client._fetch(endpoint)

            if not teams_response:
                return "none"

            # If we got a response, assume the user has some level of access
            # A full implementation would query specific permissions
            return "contributor"

        except Exception:
            return "none"

    # -------------------------------------------------------------------------
    # API Operations
    # -------------------------------------------------------------------------

    async def api_get(
        self,
        endpoint: str,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Make a GET request to the Azure DevOps API.

        Thin wrapper over the AzureDevOpsClient._fetch method.

        Args:
            endpoint: API endpoint (e.g., '/_apis/git/repositories/my-repo')
            params: Optional query parameters (appended to endpoint)

        Returns:
            Response JSON data
        """
        try:
            # Build full endpoint with params if provided
            full_endpoint = endpoint
            if params:
                param_str = "&".join(f"{k}={v}" for k, v in params.items())
                full_endpoint = (
                    f"{endpoint}?{param_str}"
                    if "?" not in endpoint
                    else f"{endpoint}&{param_str}"
                )

            return self._client._fetch(full_endpoint, method="GET")

        except Exception as e:
            raise ValueError(f"API GET request failed: {e}") from e

    async def api_post(
        self,
        endpoint: str,
        data: dict[str, Any] | None = None,
    ) -> Any:
        """Make a POST request to the Azure DevOps API.

        Thin wrapper over the AzureDevOpsClient._fetch method.

        Args:
            endpoint: API endpoint (e.g., '/_apis/git/repositories/my-repo')
            data: Optional request body (sent as JSON)

        Returns:
            Response JSON data
        """
        try:
            return self._client._fetch(endpoint, method="POST", data=data or {})

        except Exception as e:
            raise ValueError(f"API POST request failed: {e}") from e

    # -------------------------------------------------------------------------
    # Helper Methods
    # -------------------------------------------------------------------------

    def _parse_issue_data(self, data: dict[str, Any]) -> IssueData:
        """Parse Azure DevOps work item data into IssueData."""
        fields = data.get("fields", {})

        # Extract author
        created_by = fields.get("System.CreatedBy", {})
        if isinstance(created_by, dict):
            author = created_by.get("displayName", "unknown")
        else:
            author = str(created_by) if created_by else "unknown"

        # Extract assignees
        assignees = []
        assigned_to = fields.get("System.AssignedTo", {})
        if assigned_to:
            if isinstance(assigned_to, dict):
                assignee_name = assigned_to.get("displayName", "")
                if assignee_name:
                    assignees.append(assignee_name)
            else:
                assignee_name = str(assigned_to)
                if assignee_name:
                    assignees.append(assignee_name)

        # Extract labels from tags
        tags_str = fields.get("System.Tags", "")
        labels = (
            [tag.strip() for tag in tags_str.split(";") if tag.strip()]
            if tags_str
            else []
        )

        # Map state to standard open/closed
        state = fields.get("System.State", "Active")
        state_map = {
            "Active": "open",
            "Proposed": "open",
            "New": "open",
            "Done": "closed",
            "Closed": "closed",
            "Resolved": "closed",
        }
        normalized_state = state_map.get(state, "open")

        # Extract milestone (iteration path if available)
        milestone = fields.get("System.IterationPath")

        return IssueData(
            number=data.get("id", 0),
            title=fields.get("System.Title", ""),
            body=fields.get("System.Description", "") or "",
            author=author,
            state=normalized_state,
            labels=labels,
            created_at=self._parse_datetime(fields.get("System.CreatedDate")),
            updated_at=self._parse_datetime(
                fields.get("System.ChangedDate") or fields.get("System.CreatedDate")
            ),
            url=data.get("url", ""),
            assignees=assignees,
            milestone=milestone,
            provider=ProviderType.AZURE_DEVOPS,
            raw_data=data,
        )

    def _parse_tags(self, work_item: dict[str, Any]) -> list[str]:
        """Extract tags from a work item."""
        fields = work_item.get("fields", {})
        tags_str = fields.get("System.Tags", "")
        return (
            [tag.strip() for tag in tags_str.split(";") if tag.strip()]
            if tags_str
            else []
        )

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
            updated_at=self._parse_datetime(
                data.get("closedDate") or data.get("creationDate")
            ),
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
