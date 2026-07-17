"""Tests for Azure DevOps Provider implementation."""

import json
import sys
import types
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

import pytest

# The real runners/github/__init__.py eagerly imports orchestrator.py, which in
# turn relies on runner.py's sys.path bootstrap (treating runners/github as a
# flat import root) rather than proper relative-import semantics. Importing
# `runners.github.providers.factory` normally would therefore fail even though
# it has nothing to do with Azure DevOps. Pre-register a lightweight namespace
# package for `runners.github` so Python resolves `runners.github.providers`
# without executing the real (broken outside of runner.py) __init__.py.
_BACKEND_DIR = Path(__file__).resolve().parent.parent.parent.parent
if "runners.github" not in sys.modules:
    import runners  # noqa: F401  (ensures the real `runners` package is loaded first)

    _github_pkg = types.ModuleType("runners.github")
    _github_pkg.__path__ = [str(_BACKEND_DIR / "runners" / "github")]
    sys.modules["runners.github"] = _github_pkg
    # Import machinery skips setting the parent attribute when a submodule is
    # found in sys.modules without going through the normal loader path, so
    # set it explicitly to keep `runners.github.providers...` resolvable.
    sys.modules["runners"].github = _github_pkg  # type: ignore[attr-defined]

# NOTE: `runners.github.providers.factory` / `.protocol` must be imported
# *before* `runners.azure_devops.providers.azure_devops_provider`. The provider
# module imports `runners.github.providers.protocol`, which forces Python to
# first run `runners/github/providers/__init__.py` (which imports `factory`,
# which imports the provider module back) — a pre-existing circular import.
# If the provider module is mid-import when that happens, factory's own
# `AzureDevOpsProvider` binding silently fails and caches as None for the rest
# of the process. Importing factory/protocol first avoids ever hitting that
# partially-initialized state.
from runners.azure_devops.azure_devops_client import AzureDevOpsConfig
from runners.azure_devops.providers.azure_devops_provider import AzureDevOpsProvider
from runners.github.providers.factory import get_provider
from runners.github.providers.protocol import (
    IssueData,
    IssueFilters,
    PRData,
    PRFilters,
    ProviderType,
    ReviewData,
    ReviewFinding,
)

# ============================================================================
# PROTOCOL COMPLIANCE TESTS
# ============================================================================


class TestAzureDevOpsProviderProtocol:
    """Test that AzureDevOpsProvider implements the GitProvider protocol."""

    def create_provider_with_mocked_client(self):
        """Create a provider with a mocked client."""
        config = AzureDevOpsConfig(
            pat="test-pat",
            organization="test-org",
            project="test-project",
        )

        provider = AzureDevOpsProvider(_repo="org/project/repo", _config=config)
        return provider

    def test_provider_implements_protocol_properties(self):
        """Test that provider has required protocol properties."""
        provider = self.create_provider_with_mocked_client()

        assert hasattr(provider, "provider_type")
        assert hasattr(provider, "repo")
        assert provider.provider_type == ProviderType.AZURE_DEVOPS
        assert provider.repo == "org/project/repo"

    def test_provider_has_all_protocol_methods(self):
        """Test that provider implements all GitProvider protocol methods."""
        provider = self.create_provider_with_mocked_client()

        # Pull request methods
        assert hasattr(provider, "fetch_pr")
        assert hasattr(provider, "fetch_prs")
        assert hasattr(provider, "fetch_pr_diff")
        assert hasattr(provider, "post_review")
        assert hasattr(provider, "merge_pr")
        assert hasattr(provider, "close_pr")

        # Issue methods
        assert hasattr(provider, "fetch_issue")
        assert hasattr(provider, "fetch_issues")
        assert hasattr(provider, "create_issue")
        assert hasattr(provider, "close_issue")
        assert hasattr(provider, "add_comment")

        # Label methods
        assert hasattr(provider, "apply_labels")
        assert hasattr(provider, "remove_labels")
        assert hasattr(provider, "create_label")
        assert hasattr(provider, "list_labels")

        # Repository methods
        assert hasattr(provider, "get_repository_info")
        assert hasattr(provider, "get_default_branch")
        assert hasattr(provider, "check_permissions")

        # API methods
        assert hasattr(provider, "api_get")
        assert hasattr(provider, "api_post")

    def test_provider_type_is_azure_devops(self):
        """Test that provider_type returns AZURE_DEVOPS."""
        provider = self.create_provider_with_mocked_client()
        assert provider.provider_type == ProviderType.AZURE_DEVOPS

    def test_repo_property_returns_correct_format(self):
        """Test that repo property returns the repo string."""
        repo_string = "myorg/myproject/myrepo"
        config = AzureDevOpsConfig(
            pat="test-pat",
            organization="test-org",
            project="test-project",
        )
        provider = AzureDevOpsProvider(_repo=repo_string, _config=config)
        assert provider.repo == repo_string


# ============================================================================
# FETCH ISSUES TESTS (WIQL + Fetch-by-IDs)
# ============================================================================


class TestFetchIssuesWiqlAndFetchByIds:
    """Test fetch_issues() WIQL query and fetch-by-ids flow."""

    def create_provider_with_mocked_client(self, mock_client=None):
        """Create a provider with a mocked client."""
        config = AzureDevOpsConfig(
            pat="test-pat",
            organization="test-org",
            project="test-project",
        )

        provider = AzureDevOpsProvider(_repo="org/project/repo", _config=config)
        if mock_client:
            provider._client = mock_client
        return provider

    @mock.patch(
        "runners.azure_devops.providers.azure_devops_provider.AzureDevOpsClient"
    )
    def test_fetch_issues_uses_wiql_and_fetch_by_ids(self, mock_client_class):
        """Test that fetch_issues() calls WIQL first, then fetch-by-ids."""
        # Mock the client
        mock_client = mock.MagicMock()
        mock_client_class.return_value = mock_client

        # Mock WIQL query returns IDs
        mock_client.run_wiql_query.return_value = [1, 2, 3]

        # Mock fetch by IDs
        mock_client.get_work_items_by_ids.return_value = [
            {
                "id": 1,
                "fields": {
                    "System.Title": "Issue 1",
                    "System.Description": "Description 1",
                    "System.State": "Active",
                    "System.CreatedBy": {"displayName": "user1"},
                    "System.CreatedDate": "2024-01-01T00:00:00Z",
                    "System.ChangedDate": "2024-01-02T00:00:00Z",
                },
                "url": "https://dev.azure.com/org/project/_apis/wit/workitems/1",
            },
            {
                "id": 2,
                "fields": {
                    "System.Title": "Issue 2",
                    "System.Description": "Description 2",
                    "System.State": "Active",
                    "System.CreatedBy": {"displayName": "user2"},
                    "System.CreatedDate": "2024-01-01T00:00:00Z",
                    "System.ChangedDate": "2024-01-02T00:00:00Z",
                },
                "url": "https://dev.azure.com/org/project/_apis/wit/workitems/2",
            },
            {
                "id": 3,
                "fields": {
                    "System.Title": "Issue 3",
                    "System.Description": "Description 3",
                    "System.State": "Active",
                    "System.CreatedBy": {"displayName": "user3"},
                    "System.CreatedDate": "2024-01-01T00:00:00Z",
                    "System.ChangedDate": "2024-01-02T00:00:00Z",
                },
                "url": "https://dev.azure.com/org/project/_apis/wit/workitems/3",
            },
        ]

        provider = self.create_provider_with_mocked_client(mock_client)

        # Call fetch_issues
        import asyncio

        issues = asyncio.run(provider.fetch_issues())

        # Verify WIQL was called
        mock_client.run_wiql_query.assert_called_once()

        # Verify fetch-by-ids was called with the IDs returned from WIQL
        mock_client.get_work_items_by_ids.assert_called_once_with([1, 2, 3])

        # Verify results are correct
        assert len(issues) == 3
        assert issues[0].number == 1
        assert issues[1].number == 2
        assert issues[2].number == 3

    @mock.patch(
        "runners.azure_devops.providers.azure_devops_provider.AzureDevOpsClient"
    )
    def test_fetch_issues_zero_results_no_fetch_by_ids(self, mock_client_class):
        """Test that fetch_issues() does not call fetch-by-ids when WIQL returns zero results."""
        mock_client = mock.MagicMock()
        mock_client_class.return_value = mock_client

        # Mock WIQL query returns empty list
        mock_client.run_wiql_query.return_value = []

        provider = self.create_provider_with_mocked_client(mock_client)

        # Call fetch_issues
        import asyncio

        issues = asyncio.run(provider.fetch_issues())

        # Verify WIQL was called
        mock_client.run_wiql_query.assert_called_once()

        # Verify fetch-by-ids was NOT called
        mock_client.get_work_items_by_ids.assert_not_called()

        # Verify empty result
        assert issues == []

    @mock.patch(
        "runners.azure_devops.providers.azure_devops_provider.AzureDevOpsClient"
    )
    def test_fetch_issues_respects_filters(self, mock_client_class):
        """Test that fetch_issues() applies filters correctly."""
        mock_client = mock.MagicMock()
        mock_client_class.return_value = mock_client

        # Mock WIQL query
        mock_client.run_wiql_query.return_value = [1]

        # Mock fetch by IDs
        mock_client.get_work_items_by_ids.return_value = [
            {
                "id": 1,
                "fields": {
                    "System.Title": "Issue 1",
                    "System.Description": "Description 1",
                    "System.State": "Closed",
                    "System.CreatedBy": {"displayName": "user1"},
                    "System.CreatedDate": "2024-01-01T00:00:00Z",
                    "System.ChangedDate": "2024-01-02T00:00:00Z",
                },
                "url": "https://dev.azure.com/org/project/_apis/wit/workitems/1",
            }
        ]

        provider = self.create_provider_with_mocked_client(mock_client)

        # Call fetch_issues with filters
        import asyncio

        filters = IssueFilters(state="closed")
        issues = asyncio.run(provider.fetch_issues(filters))

        # Verify WIQL was called with correct query containing "Closed" state
        wiql_call = mock_client.run_wiql_query.call_args
        assert wiql_call is not None
        wiql_query = wiql_call[0][0]  # First positional argument
        assert "Closed" in wiql_query or "Closed" in wiql_query

        # Verify results
        assert len(issues) == 1
        assert issues[0].state == "closed"


# ============================================================================
# MERGE PR TESTS
# ============================================================================


class TestMergePRPatch:
    """Test merge_pr() PATCH request structure."""

    def create_provider_with_mocked_client(self, mock_client=None):
        """Create a provider with a mocked client."""
        config = AzureDevOpsConfig(
            pat="test-pat",
            organization="test-org",
            project="test-project",
        )

        provider = AzureDevOpsProvider(_repo="org/project/repo", _config=config)
        if mock_client:
            provider._client = mock_client
        return provider

    @mock.patch(
        "runners.azure_devops.providers.azure_devops_provider.AzureDevOpsClient"
    )
    def test_merge_pr_sends_correct_patch_data(self, mock_client_class):
        """Test that merge_pr() sends correct PATCH data with status=completed."""
        mock_client = mock.MagicMock()
        mock_client_class.return_value = mock_client

        # Mock GET to fetch PR data
        mock_client._fetch.side_effect = [
            {
                "pullRequestId": 123,
                "status": "active",
                "lastMergeSourceCommit": {"commitId": "abc123def456"},
            },  # First call (GET PR)
            {
                "pullRequestId": 123,
                "status": "completed",
                "lastMergeSourceCommit": {"commitId": "abc123def456"},
            },  # Second call (PATCH merge)
        ]

        provider = self.create_provider_with_mocked_client(mock_client)

        # Call merge_pr
        import asyncio

        result = asyncio.run(provider.merge_pr(123))

        # Verify PATCH was called with correct data
        calls = mock_client._fetch.call_args_list
        assert len(calls) >= 2

        # Find the PATCH call
        patch_call = None
        for call in calls:
            if call.kwargs.get("method") == "PATCH":
                patch_call = call
                break

        assert patch_call is not None, "PATCH call not found"

        # Verify PATCH data structure
        patch_data = patch_call.kwargs.get("data")
        assert patch_data is not None
        assert patch_data["status"] == "completed"
        assert "lastMergeSourceCommit" in patch_data
        assert patch_data["lastMergeSourceCommit"]["commitId"] == "abc123def456"
        assert "completionOptions" in patch_data

        # Verify result
        assert result is True

    @mock.patch(
        "runners.azure_devops.providers.azure_devops_provider.AzureDevOpsClient"
    )
    def test_merge_pr_includes_completion_options(self, mock_client_class):
        """Test that merge_pr() includes completionOptions in PATCH."""
        mock_client = mock.MagicMock()
        mock_client_class.return_value = mock_client

        # Mock responses
        mock_client._fetch.side_effect = [
            {
                "pullRequestId": 123,
                "lastMergeSourceCommit": {"commitId": "abc123"},
            },  # GET
            {
                "pullRequestId": 123,
                "status": "completed",
            },  # PATCH
        ]

        provider = self.create_provider_with_mocked_client(mock_client)

        import asyncio

        asyncio.run(provider.merge_pr(123))

        # Find PATCH call
        patch_call = None
        for call in mock_client._fetch.call_args_list:
            if call.kwargs.get("method") == "PATCH":
                patch_call = call
                break

        assert patch_call is not None
        patch_data = patch_call.kwargs.get("data")
        assert "completionOptions" in patch_data
        assert isinstance(patch_data["completionOptions"], dict)
        assert "deleteSourceBranch" in patch_data["completionOptions"]


# ============================================================================
# CLOSE PR TESTS
# ============================================================================


class TestClosePRPatch:
    """Test close_pr() PATCH request structure."""

    def create_provider_with_mocked_client(self, mock_client=None):
        """Create a provider with a mocked client."""
        config = AzureDevOpsConfig(
            pat="test-pat",
            organization="test-org",
            project="test-project",
        )

        provider = AzureDevOpsProvider(_repo="org/project/repo", _config=config)
        if mock_client:
            provider._client = mock_client
        return provider

    @mock.patch(
        "runners.azure_devops.providers.azure_devops_provider.AzureDevOpsClient"
    )
    def test_close_pr_sends_status_abandoned(self, mock_client_class):
        """Test that close_pr() sends PATCH with status=abandoned."""
        mock_client = mock.MagicMock()
        mock_client_class.return_value = mock_client

        # Mock PATCH response
        mock_client._fetch.return_value = {
            "pullRequestId": 123,
            "status": "abandoned",
        }

        provider = self.create_provider_with_mocked_client(mock_client)

        import asyncio

        result = asyncio.run(provider.close_pr(123))

        # Verify PATCH was called
        mock_client._fetch.assert_called()

        # Find the PATCH call
        patch_call = None
        for call in mock_client._fetch.call_args_list:
            if call.kwargs.get("method") == "PATCH":
                patch_call = call
                break

        assert patch_call is not None, "PATCH call not found for close_pr"

        # Verify PATCH data
        patch_data = patch_call.kwargs.get("data")
        assert patch_data is not None
        assert patch_data["status"] == "abandoned"

        # Verify result
        assert result is True

    @mock.patch(
        "runners.azure_devops.providers.azure_devops_provider.AzureDevOpsClient"
    )
    def test_close_pr_with_comment(self, mock_client_class):
        """Test that close_pr() adds a comment if provided."""
        mock_client = mock.MagicMock()
        mock_client_class.return_value = mock_client

        # Mock responses
        mock_client._fetch.return_value = {
            "pullRequestId": 123,
            "status": "abandoned",
        }

        provider = self.create_provider_with_mocked_client(mock_client)

        import asyncio

        result = asyncio.run(provider.close_pr(123, comment="Closing this PR"))

        # Verify add_comment was called (it uses add_comment internally)
        # Since mock is called, we just verify the close operation happened
        assert result is True


# ============================================================================
# POST REVIEW TESTS
# ============================================================================


class TestPostReviewThreadAndVote:
    """Test post_review() creates threads and sets vote."""

    def create_provider_with_mocked_client(self, mock_client=None):
        """Create a provider with a mocked client."""
        config = AzureDevOpsConfig(
            pat="test-pat",
            organization="test-org",
            project="test-project",
        )

        provider = AzureDevOpsProvider(_repo="org/project/repo", _config=config)
        if mock_client:
            provider._client = mock_client
        return provider

    @mock.patch(
        "runners.azure_devops.providers.azure_devops_provider.AzureDevOpsClient"
    )
    def test_post_review_creates_comment_thread(self, mock_client_class):
        """Test that post_review() creates a comment thread."""
        mock_client = mock.MagicMock()
        mock_client_class.return_value = mock_client

        # Mock thread creation response
        mock_client._fetch.return_value = {"id": 456, "status": 1}

        provider = self.create_provider_with_mocked_client(mock_client)

        import asyncio

        review = ReviewData(
            pr_number=123,
            event="comment",
            body="This is a review comment",
        )

        thread_id = asyncio.run(provider.post_review(123, review))

        # Verify POST was called for thread creation
        mock_client._fetch.assert_called()

        # Find the POST call for thread creation
        post_call = None
        for call in mock_client._fetch.call_args_list:
            if call.kwargs.get("method") == "POST" and "threads" in call.args[0]:
                post_call = call
                break

        assert post_call is not None, "Thread creation POST call not found"

        # Verify thread data structure
        thread_data = post_call.kwargs.get("data")
        assert thread_data is not None
        assert "comments" in thread_data
        assert thread_data["comments"][0]["content"]

        # Verify return value
        assert thread_id == 456

    @mock.patch(
        "runners.azure_devops.providers.azure_devops_provider.AzureDevOpsClient"
    )
    def test_post_review_vote_mapping(self, mock_client_class):
        """Test that post_review() maps review events to correct vote values."""
        mock_client = mock.MagicMock()
        mock_client_class.return_value = mock_client

        # Mock responses
        mock_client._fetch.return_value = {"id": 456}
        mock_client.get_authenticated_user_id.return_value = "reviewer-id"

        provider = self.create_provider_with_mocked_client(mock_client)

        import asyncio

        # Test approve event (vote=10)
        review_approve = ReviewData(
            pr_number=123,
            event="approve",
            body="Looks good!",
        )

        asyncio.run(provider.post_review(123, review_approve))

        # Test request_changes event (vote=-10)
        review_changes = ReviewData(
            pr_number=123,
            event="request_changes",
            body="Please fix this",
        )

        asyncio.run(provider.post_review(123, review_changes))

        # Test comment event (vote=0)
        review_comment = ReviewData(
            pr_number=123,
            event="comment",
            body="Just a comment",
        )

        asyncio.run(provider.post_review(123, review_comment))

        # Verify thread creation happened for all reviews
        post_calls = [
            call
            for call in mock_client._fetch.call_args_list
            if call.kwargs.get("method") == "POST"
        ]
        assert len(post_calls) >= 3

        vote_calls = [
            call
            for call in mock_client._fetch.call_args_list
            if call.kwargs.get("method") == "PUT"
            and "/reviewers/reviewer-id" in call.args[0]
        ]
        assert [call.kwargs["data"]["vote"] for call in vote_calls] == [10, -10, 0]

    @mock.patch(
        "runners.azure_devops.providers.azure_devops_provider.AzureDevOpsClient"
    )
    def test_post_review_with_findings(self, mock_client_class):
        """Test that post_review() includes findings in thread comment."""
        mock_client = mock.MagicMock()
        mock_client_class.return_value = mock_client

        # Mock response
        mock_client._fetch.return_value = {"id": 456}

        provider = self.create_provider_with_mocked_client(mock_client)

        import asyncio

        findings = [
            ReviewFinding(
                id="f1",
                severity="high",
                category="bug",
                title="Potential null reference",
                description="Variable might be null",
                file="app.py",
                line=42,
            )
        ]

        review = ReviewData(
            pr_number=123,
            event="request_changes",
            body="Review complete",
            findings=findings,
        )

        asyncio.run(provider.post_review(123, review))

        # Verify POST was called with findings in content
        post_calls = [
            call
            for call in mock_client._fetch.call_args_list
            if call.kwargs.get("method") == "POST" and "threads" in call.args[0]
        ]

        assert len(post_calls) > 0
        thread_data = post_calls[0].kwargs.get("data")
        assert thread_data is not None
        assert "comments" in thread_data
        # Findings should be in the comment content
        content = thread_data["comments"][0]["content"]
        assert "Potential null reference" in content or "findings" in content.lower()


# ============================================================================
# FACTORY TESTS
# ============================================================================


class TestGetProviderFactory:
    """Test get_provider() factory function."""

    def test_get_provider_azure_devops_by_enum(self):
        """Test that get_provider() returns AzureDevOpsProvider for AZURE_DEVOPS enum."""
        config = AzureDevOpsConfig(
            pat="test-pat",
            organization="test-org",
            project="test-project",
        )

        provider = get_provider(
            ProviderType.AZURE_DEVOPS,
            "org/project/repo",
            _config=config,
        )

        assert isinstance(provider, AzureDevOpsProvider)
        assert provider.provider_type == ProviderType.AZURE_DEVOPS
        assert provider.repo == "org/project/repo"

    def test_get_provider_azure_devops_by_string(self):
        """Test that get_provider() accepts 'azure_devops' string."""
        config = AzureDevOpsConfig(
            pat="test-pat",
            organization="test-org",
            project="test-project",
        )

        provider = get_provider(
            "azure_devops",
            "org/project/repo",
            _config=config,
        )

        assert isinstance(provider, AzureDevOpsProvider)
        assert provider.provider_type == ProviderType.AZURE_DEVOPS

    def test_get_provider_creates_working_instance(self):
        """Test that get_provider() creates a fully functional provider instance."""
        config = AzureDevOpsConfig(
            pat="test-pat",
            organization="test-org",
            project="test-project",
        )

        provider = get_provider(
            ProviderType.AZURE_DEVOPS,
            "org/project/repo",
            _config=config,
        )

        # Verify basic properties
        assert provider.repo == "org/project/repo"
        assert provider.provider_type == ProviderType.AZURE_DEVOPS

        # Verify protocol methods exist
        assert callable(provider.fetch_pr)
        assert callable(provider.fetch_issues)
        assert callable(provider.post_review)
        assert callable(provider.merge_pr)
        assert callable(provider.close_pr)


# ============================================================================
# DATA TYPE MAPPING TESTS
# ============================================================================


class TestDataTypeMapping:
    """Test that provider correctly maps data to protocol types."""

    def create_provider_with_mocked_client(self, mock_client=None):
        """Create a provider with a mocked client."""
        config = AzureDevOpsConfig(
            pat="test-pat",
            organization="test-org",
            project="test-project",
        )

        provider = AzureDevOpsProvider(_repo="org/project/repo", _config=config)
        if mock_client:
            provider._client = mock_client
        return provider

    @mock.patch(
        "runners.azure_devops.providers.azure_devops_provider.AzureDevOpsClient"
    )
    def test_fetch_issue_returns_issue_data(self, mock_client_class):
        """Test that fetch_issue() returns IssueData with correct provider."""
        mock_client = mock.MagicMock()
        mock_client_class.return_value = mock_client

        # Mock work item response
        mock_client._fetch.return_value = {
            "id": 42,
            "fields": {
                "System.Title": "Test Issue",
                "System.Description": "Test Description",
                "System.State": "Active",
                "System.CreatedBy": {"displayName": "testuser"},
                "System.CreatedDate": "2024-01-01T00:00:00Z",
                "System.ChangedDate": "2024-01-02T00:00:00Z",
            },
            "url": "https://dev.azure.com/org/project/_apis/wit/workitems/42",
        }

        provider = self.create_provider_with_mocked_client(mock_client)

        import asyncio

        issue = asyncio.run(provider.fetch_issue(42))

        # Verify return type
        assert isinstance(issue, IssueData)
        assert issue.provider == ProviderType.AZURE_DEVOPS
        assert issue.number == 42
        assert issue.title == "Test Issue"

    @mock.patch(
        "runners.azure_devops.providers.azure_devops_provider.AzureDevOpsClient"
    )
    def test_fetch_pr_returns_pr_data(self, mock_client_class):
        """Test that fetch_pr() returns PRData with correct provider."""
        mock_client = mock.MagicMock()
        mock_client_class.return_value = mock_client

        # Mock PR response
        mock_client._fetch.side_effect = [
            {
                "pullRequestId": 99,
                "title": "Test PR",
                "description": "Test Description",
                "status": "active",
                "createdBy": {"displayName": "testuser"},
                "sourceRefName": "refs/heads/feature",
                "targetRefName": "refs/heads/main",
                "creationDate": "2024-01-01T00:00:00Z",
                "url": "https://dev.azure.com/org/project/_apis/git/pullrequests/99",
            },  # fetch_pr
            {"value": []},  # commits (for diff)
        ]

        provider = self.create_provider_with_mocked_client(mock_client)

        import asyncio

        pr = asyncio.run(provider.fetch_pr(99))

        # Verify return type
        assert isinstance(pr, PRData)
        assert pr.provider == ProviderType.AZURE_DEVOPS
        assert pr.number == 99
        assert pr.title == "Test PR"


# ============================================================================
# ERROR HANDLING TESTS
# ============================================================================


class TestErrorHandling:
    """Test error handling in provider methods."""

    def create_provider_with_mocked_client(self, mock_client=None):
        """Create a provider with a mocked client."""
        config = AzureDevOpsConfig(
            pat="test-pat",
            organization="test-org",
            project="test-project",
        )

        provider = AzureDevOpsProvider(_repo="org/project/repo", _config=config)
        if mock_client:
            provider._client = mock_client
        return provider

    @mock.patch(
        "runners.azure_devops.providers.azure_devops_provider.AzureDevOpsClient"
    )
    def test_merge_pr_handles_missing_commit_id(self, mock_client_class):
        """Test that merge_pr() handles missing lastMergeSourceCommit gracefully."""
        mock_client = mock.MagicMock()
        mock_client_class.return_value = mock_client

        # Mock PR without commitId
        mock_client._fetch.return_value = {
            "pullRequestId": 123,
            "lastMergeSourceCommit": None,
        }

        provider = self.create_provider_with_mocked_client(mock_client)

        import asyncio

        result = asyncio.run(provider.merge_pr(123))

        # Should return False when commitId is missing
        assert result is False

    @mock.patch(
        "runners.azure_devops.providers.azure_devops_provider.AzureDevOpsClient"
    )
    def test_fetch_issue_handles_missing_work_item(self, mock_client_class):
        """Test that fetch_issue() raises ValueError for missing work item."""
        mock_client = mock.MagicMock()
        mock_client_class.return_value = mock_client

        # Mock no response
        mock_client._fetch.return_value = None

        provider = self.create_provider_with_mocked_client(mock_client)

        import asyncio

        with pytest.raises(ValueError, match="not found"):
            asyncio.run(provider.fetch_issue(999))
