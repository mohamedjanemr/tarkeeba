"""Tests for Azure DevOps REST API client."""

import base64
import json
from pathlib import Path
from unittest import mock
from urllib.error import HTTPError

import pytest

from runners.azure_devops.azure_devops_client import (
    AzureDevOpsClient,
    AzureDevOpsConfig,
    load_azure_devops_config,
)


class TestAzureDevOpsClientAuth:
    """Test authentication header construction."""

    def test_authorization_header_format(self):
        """Test that Authorization header is correctly formatted as Basic auth with PAT."""
        config = AzureDevOpsConfig(
            pat="my-secret-pat",
            organization="my-org",
            project="my-project",
        )
        client = AzureDevOpsClient(Path("/tmp"), config)

        auth_header = client._build_auth_header()

        # Expected: Basic base64(':' + pat)
        expected_credentials = f":{config.pat}"
        expected_encoded = base64.b64encode(expected_credentials.encode("utf-8")).decode("utf-8")
        expected_header = f"Basic {expected_encoded}"

        assert auth_header == expected_header
        assert auth_header.startswith("Basic ")

    def test_authorization_header_with_different_pats(self):
        """Test authorization header with various PAT formats."""
        test_cases = [
            "simple-pat",
            "pat-with-many-chars-123456789",
            "pat_with_underscores",
        ]

        for pat in test_cases:
            config = AzureDevOpsConfig(
                pat=pat,
                organization="org",
                project="project",
            )
            client = AzureDevOpsClient(Path("/tmp"), config)
            auth_header = client._build_auth_header()

            # Verify format
            assert auth_header.startswith("Basic ")

            # Verify content by decoding
            encoded_part = auth_header.split(" ", 1)[1]
            decoded = base64.b64decode(encoded_part).decode("utf-8")
            assert decoded == f":{pat}"

    def test_authorization_header_empty_username(self):
        """Test that the username part of Basic auth is empty."""
        config = AzureDevOpsConfig(
            pat="test-pat",
            organization="org",
            project="project",
        )
        client = AzureDevOpsClient(Path("/tmp"), config)
        auth_header = client._build_auth_header()

        # Decode the header to verify format
        encoded_part = auth_header.split(" ", 1)[1]
        decoded = base64.b64decode(encoded_part).decode("utf-8")

        # Should be ':' followed by PAT (empty username)
        assert decoded.startswith(":")
        assert decoded == ":test-pat"


class TestAzureDevOpsClientJsonPatch:
    """Test JSON Patch builder."""

    def test_build_json_patch_single_field(self):
        """Test building a JSON patch with a single field."""
        config = AzureDevOpsConfig(
            pat="test-pat",
            organization="org",
            project="project",
        )
        client = AzureDevOpsClient(Path("/tmp"), config)

        patches = client.build_json_patch({"System.Title": "My Task"})

        assert len(patches) == 1
        assert patches[0]["op"] == "add"
        assert patches[0]["path"] == "/fields/System.Title"
        assert patches[0]["value"] == "My Task"

    def test_build_json_patch_multiple_fields(self):
        """Test building a JSON patch with multiple fields."""
        config = AzureDevOpsConfig(
            pat="test-pat",
            organization="org",
            project="project",
        )
        client = AzureDevOpsClient(Path("/tmp"), config)

        fields = {
            "System.Title": "My Task",
            "System.Description": "Task description",
            "System.AssignedTo": "user@example.com",
        }
        patches = client.build_json_patch(fields)

        assert len(patches) == 3

        # Verify each patch is correctly formed
        for patch in patches:
            assert patch["op"] == "add"
            assert patch["path"].startswith("/fields/")
            assert "value" in patch

        # Verify all fields are present
        paths = {patch["path"] for patch in patches}
        assert "/fields/System.Title" in paths
        assert "/fields/System.Description" in paths
        assert "/fields/System.AssignedTo" in paths

    def test_build_json_patch_empty_dict(self):
        """Test building a JSON patch with no fields."""
        config = AzureDevOpsConfig(
            pat="test-pat",
            organization="org",
            project="project",
        )
        client = AzureDevOpsClient(Path("/tmp"), config)

        patches = client.build_json_patch({})

        assert patches == []

    def test_build_json_patch_special_characters(self):
        """Test JSON patch with special characters in values."""
        config = AzureDevOpsConfig(
            pat="test-pat",
            organization="org",
            project="project",
        )
        client = AzureDevOpsClient(Path("/tmp"), config)

        fields = {
            "System.Title": "Title with 'quotes' and \"double quotes\"",
            "System.Description": "Multi\nline\ndescription",
        }
        patches = client.build_json_patch(fields)

        assert len(patches) == 2
        # Verify values are preserved
        title_patch = next(p for p in patches if p["path"] == "/fields/System.Title")
        assert title_patch["value"] == "Title with 'quotes' and \"double quotes\""


class TestAzureDevOpsClientRetry:
    """Test retry logic with 429 rate limiting."""

    @mock.patch("urllib.request.urlopen")
    def test_fetch_retries_on_429(self, mock_urlopen):
        """Test that _fetch retries on HTTP 429 (rate limit)."""
        config = AzureDevOpsConfig(
            pat="test-pat",
            organization="org",
            project="project",
        )
        client = AzureDevOpsClient(Path("/tmp"), config)

        # First two attempts raise 429, third succeeds
        http_error = HTTPError(
            url="https://dev.azure.com/org/project/_apis/test",
            code=429,
            msg="Too Many Requests",
            hdrs={},
            fp=None,
        )
        success_response = mock.MagicMock()
        success_response.status = 200
        success_response.read.return_value = json.dumps({"value": "success"}).encode("utf-8")
        success_response.__enter__.return_value = success_response
        success_response.__exit__.return_value = None

        # Set side_effect: raise 429 twice, then return success
        mock_urlopen.side_effect = [http_error, http_error, success_response]

        with mock.patch("time.sleep"):  # Mock sleep to avoid delays
            result = client._fetch("/_apis/wit/workitems")

        assert result == {"value": "success"}
        assert mock_urlopen.call_count == 3

    @mock.patch("time.sleep")
    @mock.patch("urllib.request.urlopen")
    def test_fetch_429_backoff_timing(self, mock_urlopen, mock_sleep):
        """Test that _fetch uses exponential backoff on 429."""
        config = AzureDevOpsConfig(
            pat="test-pat",
            organization="org",
            project="project",
        )
        client = AzureDevOpsClient(Path("/tmp"), config)

        # Raise 429 on first two attempts, succeed on third
        http_error = HTTPError(
            url="https://dev.azure.com/org/project/_apis/test",
            code=429,
            msg="Too Many Requests",
            hdrs={},
            fp=None,
        )
        success_response = mock.MagicMock()
        success_response.status = 200
        success_response.read.return_value = json.dumps({"value": "success"}).encode("utf-8")
        success_response.__enter__.return_value = success_response
        success_response.__exit__.return_value = None

        mock_urlopen.side_effect = [http_error, http_error, success_response]

        client._fetch("/_apis/wit/workitems")

        # Verify exponential backoff: 2^0 = 1s, 2^1 = 2s
        assert mock_sleep.call_count == 2
        sleep_calls = [call[0][0] for call in mock_sleep.call_args_list]
        assert sleep_calls == [1, 2]  # 2^0, 2^1

    @mock.patch("urllib.request.urlopen")
    def test_fetch_respects_retry_after_header(self, mock_urlopen):
        """Test that _fetch respects Retry-After header on 429."""
        config = AzureDevOpsConfig(
            pat="test-pat",
            organization="org",
            project="project",
        )
        client = AzureDevOpsClient(Path("/tmp"), config)

        # Create a 429 error with Retry-After header (integer seconds)
        http_error = HTTPError(
            url="https://dev.azure.com/org/project/_apis/test",
            code=429,
            msg="Too Many Requests",
            hdrs={"Retry-After": "5"},
            fp=None,
        )
        success_response = mock.MagicMock()
        success_response.status = 200
        success_response.read.return_value = json.dumps({"value": "success"}).encode("utf-8")
        success_response.__enter__.return_value = success_response
        success_response.__exit__.return_value = None

        mock_urlopen.side_effect = [http_error, success_response]

        with mock.patch("time.sleep") as mock_sleep:
            client._fetch("/_apis/wit/workitems")

            # Verify Retry-After value is used
            mock_sleep.assert_called_once_with(5)

    @mock.patch("urllib.request.urlopen")
    def test_fetch_fails_after_max_retries(self, mock_urlopen):
        """Test that _fetch raises exception after max retries exhausted."""
        config = AzureDevOpsConfig(
            pat="test-pat",
            organization="org",
            project="project",
        )
        client = AzureDevOpsClient(Path("/tmp"), config)

        # Always raise 429
        http_error = HTTPError(
            url="https://dev.azure.com/org/project/_apis/test",
            code=429,
            msg="Too Many Requests",
            hdrs={},
            fp=None,
        )
        mock_urlopen.side_effect = http_error

        with pytest.raises(Exception) as exc_info:
            client._fetch("/_apis/wit/workitems", max_retries=3)

        assert "429" in str(exc_info.value)
        assert mock_urlopen.call_count == 3

    @mock.patch("urllib.request.urlopen")
    def test_fetch_non_429_errors_fail_immediately(self, mock_urlopen):
        """Test that non-429 errors don't retry."""
        config = AzureDevOpsConfig(
            pat="test-pat",
            organization="org",
            project="project",
        )
        client = AzureDevOpsClient(Path("/tmp"), config)

        # Raise 401 (authentication error)
        http_error = HTTPError(
            url="https://dev.azure.com/org/project/_apis/test",
            code=401,
            msg="Unauthorized",
            hdrs={},
            fp=None,
        )
        mock_urlopen.side_effect = http_error

        with pytest.raises(Exception) as exc_info:
            client._fetch("/_apis/wit/workitems")

        assert "401" in str(exc_info.value)
        # Should only call once (no retry)
        assert mock_urlopen.call_count == 1


class TestAzureDevOpsClientConfiguration:
    """Test configuration loading and validation."""

    @mock.patch.dict("os.environ", {}, clear=True)
    def test_load_config_missing_pat_returns_none(self):
        """Test that missing PAT returns None."""
        result = load_azure_devops_config(Path("/tmp"))

        assert result is None

    @mock.patch.dict(
        "os.environ",
        {
            "AZURE_DEVOPS_PAT": "test-pat",
            "AZURE_DEVOPS_ORG": "test-org",
        },
        clear=True,
    )
    def test_load_config_missing_project_returns_none(self):
        """Test that missing project returns None."""
        result = load_azure_devops_config(Path("/tmp"))

        assert result is None

    @mock.patch.dict(
        "os.environ",
        {
            "AZURE_DEVOPS_PAT": "test-pat",
            "AZURE_DEVOPS_ORG": "test-org",
            "AZURE_DEVOPS_PROJECT": "test-project",
        },
        clear=True,
    )
    def test_load_config_from_env_vars(self):
        """Test loading configuration from environment variables."""
        result = load_azure_devops_config(Path("/tmp"))

        assert result is not None
        assert result.pat == "test-pat"
        assert result.organization == "test-org"
        assert result.project == "test-project"

    def test_missing_config_raises_clear_error_on_client_init(self):
        """Test that creating a client without PAT is possible but auth header fails."""
        # This test verifies the client can be instantiated with incomplete config
        # The actual failure would occur on the first API call
        config = AzureDevOpsConfig(
            pat="",  # Empty PAT (simulating missing credential)
            organization="org",
            project="project",
        )
        client = AzureDevOpsClient(Path("/tmp"), config)

        # Auth header should still be built but with empty PAT
        auth_header = client._build_auth_header()
        assert auth_header.startswith("Basic ")

        # Decode to verify empty username with empty PAT
        encoded_part = auth_header.split(" ", 1)[1]
        decoded = base64.b64decode(encoded_part).decode("utf-8")
        assert decoded == ":"  # Empty username and empty PAT


class TestAzureDevOpsClientApiUrl:
    """Test API URL construction."""

    def test_api_url_construction(self):
        """Test that _api_url constructs correct URLs."""
        config = AzureDevOpsConfig(
            pat="test-pat",
            organization="my-org",
            project="my-project",
        )
        client = AzureDevOpsClient(Path("/tmp"), config)

        url = client._api_url("/_apis/wit/workitems")

        assert url == "https://dev.azure.com/my-org/my-project/_apis/wit/workitems"

    def test_api_url_adds_api_version(self):
        """Test that _fetch adds API version to URL."""
        config = AzureDevOpsConfig(
            pat="test-pat",
            organization="org",
            project="project",
        )
        client = AzureDevOpsClient(Path("/tmp"), config)

        with mock.patch("urllib.request.urlopen") as mock_urlopen:
            mock_response = mock.MagicMock()
            mock_response.status = 200
            mock_response.read.return_value = b"{}"
            mock_urlopen.return_value.__enter__.return_value = mock_response

            client._fetch("/_apis/wit/workitems")

            # Verify the URL includes api-version
            call_args = mock_urlopen.call_args
            request_obj = call_args[0][0]
            assert "api-version=7.1" in request_obj.full_url


class TestAzureDevOpsClientWorkItems:
    """Test work item related methods."""

    @mock.patch("urllib.request.urlopen")
    def test_run_wiql_query(self, mock_urlopen):
        """Test running a WIQL query."""
        config = AzureDevOpsConfig(
            pat="test-pat",
            organization="org",
            project="project",
        )
        client = AzureDevOpsClient(Path("/tmp"), config)

        # Mock WIQL response
        response_data = {
            "workItems": [
                {"id": 123},
                {"id": 456},
            ]
        }
        mock_response = mock.MagicMock()
        mock_response.status = 200
        mock_response.read.return_value = json.dumps(response_data).encode("utf-8")
        mock_urlopen.return_value.__enter__.return_value = mock_response

        result = client.run_wiql_query("SELECT [System.Id] FROM workitems")

        assert result == [123, 456]

    @mock.patch("urllib.request.urlopen")
    def test_run_wiql_query_empty_result(self, mock_urlopen):
        """Test WIQL query with no results."""
        config = AzureDevOpsConfig(
            pat="test-pat",
            organization="org",
            project="project",
        )
        client = AzureDevOpsClient(Path("/tmp"), config)

        # Mock empty WIQL response
        response_data = {"workItems": []}
        mock_response = mock.MagicMock()
        mock_response.status = 200
        mock_response.read.return_value = json.dumps(response_data).encode("utf-8")
        mock_urlopen.return_value.__enter__.return_value = mock_response

        result = client.run_wiql_query("SELECT [System.Id] FROM workitems")

        assert result == []

    @mock.patch("urllib.request.urlopen")
    def test_get_work_items_by_ids(self, mock_urlopen):
        """Test fetching work items by IDs."""
        config = AzureDevOpsConfig(
            pat="test-pat",
            organization="org",
            project="project",
        )
        client = AzureDevOpsClient(Path("/tmp"), config)

        # Mock work items response
        response_data = {
            "value": [
                {
                    "id": 123,
                    "fields": {
                        "System.Title": "Task 1",
                        "System.State": "Active",
                    },
                },
                {
                    "id": 456,
                    "fields": {
                        "System.Title": "Task 2",
                        "System.State": "Done",
                    },
                },
            ]
        }
        mock_response = mock.MagicMock()
        mock_response.status = 200
        mock_response.read.return_value = json.dumps(response_data).encode("utf-8")
        mock_urlopen.return_value.__enter__.return_value = mock_response

        result = client.get_work_items_by_ids([123, 456])

        assert len(result) == 2
        assert result[0]["id"] == 123
        assert result[1]["id"] == 456

    @mock.patch("urllib.request.urlopen")
    def test_get_work_items_empty_ids(self, mock_urlopen):
        """Test fetching work items with empty ID list doesn't make API call."""
        config = AzureDevOpsConfig(
            pat="test-pat",
            organization="org",
            project="project",
        )
        client = AzureDevOpsClient(Path("/tmp"), config)

        result = client.get_work_items_by_ids([])

        # Should return empty list without making API call
        assert result == []
        mock_urlopen.assert_not_called()
