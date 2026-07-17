"""
Azure DevOps API Client
=======================

Client for Azure DevOps API operations.
Uses direct API calls with HTTP Basic authentication (PAT-based).
"""

from __future__ import annotations

import base64
import json
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any


@dataclass
class AzureDevOpsConfig:
    """Azure DevOps configuration loaded from project."""

    pat: str
    organization: str
    project: str


# Azure DevOps API version
API_VERSION = "7.1"

# Valid Azure DevOps API endpoint patterns
VALID_ENDPOINT_PATTERNS = (
    "/_apis/connectionData",
    "/_apis/git/",
    "/_apis/pullrequestreview/",
    "/_apis/wit/",
    "/_apis/build/",
    "/_apis/release/",
)


def validate_endpoint(endpoint: str) -> None:
    """
    Validate that an endpoint is a legitimate Azure DevOps API path.
    Raises ValueError if the endpoint is suspicious.
    """
    if not endpoint:
        raise ValueError("Endpoint cannot be empty")

    # Must start with /
    if not endpoint.startswith("/"):
        raise ValueError("Endpoint must start with /")

    # Check for path traversal attempts
    if ".." in endpoint:
        raise ValueError("Endpoint contains path traversal sequence")

    # Check for null bytes
    if "\x00" in endpoint:
        raise ValueError("Endpoint contains null byte")

    # Validate against known patterns
    if not any(endpoint.startswith(pattern) for pattern in VALID_ENDPOINT_PATTERNS):
        raise ValueError(
            f"Endpoint does not match known Azure DevOps API patterns: {endpoint}"
        )


class AzureDevOpsClient:
    """Client for Azure DevOps API operations."""

    def __init__(
        self,
        project_dir: Path,
        config: AzureDevOpsConfig,
        default_timeout: float = 30.0,
    ):
        self.project_dir = Path(project_dir)
        self.config = config
        self.default_timeout = default_timeout

    def _build_auth_header(self) -> str:
        """Build HTTP Basic auth header from PAT."""
        # Azure DevOps uses username:PAT format, where username is empty
        credentials = f":{self.config.pat}"
        encoded = base64.b64encode(credentials.encode("utf-8")).decode("utf-8")
        return f"Basic {encoded}"

    def get_authenticated_user_id(self) -> str:
        """Return the Azure DevOps identity ID associated with the PAT."""
        connection_data = self._fetch("/_apis/connectionData")
        authenticated_user = (
            connection_data.get("authenticatedUser", {})
            if isinstance(connection_data, dict)
            else {}
        )
        user_id = authenticated_user.get("id")
        if not isinstance(user_id, str) or not user_id.strip():
            raise ValueError("Azure DevOps did not return an authenticated user ID")
        return user_id

    def _api_url(self, endpoint: str) -> str:
        """Build full API URL."""
        base = f"https://dev.azure.com/{self.config.organization}/{self.config.project}"
        if not endpoint.startswith("/"):
            endpoint = f"/{endpoint}"
        return f"{base}{endpoint}"

    def _fetch(
        self,
        endpoint: str,
        method: str = "GET",
        data: dict | None = None,
        timeout: float | None = None,
        max_retries: int = 3,
    ) -> Any:
        """Make an API request to Azure DevOps with rate limit handling."""
        validate_endpoint(endpoint)

        # Add API version to endpoint
        separator = "&" if "?" in endpoint else "?"
        endpoint_with_version = f"{endpoint}{separator}api-version={API_VERSION}"

        url = self._api_url(endpoint_with_version)
        headers = {
            "Authorization": self._build_auth_header(),
            "Content-Type": "application/json",
        }

        request_data = None
        if data:
            request_data = json.dumps(data).encode("utf-8")

        last_error = None
        for attempt in range(max_retries):
            req = urllib.request.Request(
                url,
                data=request_data,
                headers=headers,
                method=method,
            )

            try:
                with urllib.request.urlopen(
                    req, timeout=timeout or self.default_timeout
                ) as response:
                    if response.status == 204:
                        return None
                    response_body = response.read().decode("utf-8")
                    try:
                        return json.loads(response_body)
                    except json.JSONDecodeError as e:
                        raise Exception(
                            f"Invalid JSON response from Azure DevOps: {e}"
                        ) from e
            except urllib.error.HTTPError as e:
                error_body = e.read().decode("utf-8") if e.fp else ""
                last_error = e

                # Handle rate limit (429) with exponential backoff
                if e.code == 429:
                    # Default to exponential backoff: 1s, 2s, 4s
                    wait_time = 2**attempt

                    # Check for Retry-After header (can be integer seconds or HTTP-date)
                    retry_after = e.headers.get("Retry-After")
                    if retry_after:
                        try:
                            # Try parsing as integer seconds first
                            wait_time = int(retry_after)
                        except ValueError:
                            # Try parsing as HTTP-date (e.g., "Wed, 21 Oct 2015 07:28:00 GMT")
                            try:
                                retry_date = parsedate_to_datetime(retry_after)
                                now = datetime.now(timezone.utc)
                                delta = (retry_date - now).total_seconds()
                                wait_time = max(1, int(delta))  # At least 1 second
                            except (ValueError, TypeError):
                                # Parsing failed, keep exponential backoff default
                                pass

                    if attempt < max_retries - 1:
                        print(
                            f"[Azure DevOps] Rate limited (429). Retrying in {wait_time}s "
                            f"(attempt {attempt + 1}/{max_retries})...",
                            flush=True,
                        )
                        time.sleep(wait_time)
                        continue

                raise Exception(f"Azure DevOps API error {e.code}: {error_body}") from e

        # Should not reach here, but just in case
        raise Exception(
            f"Azure DevOps API error after {max_retries} retries"
        ) from last_error

    def build_json_patch(self, fields: dict) -> list[dict]:
        """
        Build JSON Patch operations (RFC 6902) for work item create/update.

        Converts a fields dict into an array of add/replace operations.
        Used for PATCH requests to work item endpoints.

        Args:
            fields: Dictionary mapping field names to values
                   (e.g., {'System.Title': 'My Title'})

        Returns:
            List of JSON Patch operation dicts
            (e.g., [{'op': 'add', 'path': '/fields/System.Title', 'value': 'x'}])
        """
        patches = []
        for field_name, value in fields.items():
            patches.append(
                {
                    "op": "add",
                    "path": f"/fields/{field_name}",
                    "value": value,
                }
            )
        return patches

    def run_wiql_query(self, wiql: str) -> list[int]:
        """
        Run a WIQL (Work Item Query Language) query and return work item IDs.

        Posts to /_apis/wit/wiql and extracts the list of work item IDs
        from the results.

        Args:
            wiql: WIQL query string

        Returns:
            List of work item IDs matching the query
        """
        data = {"query": wiql}
        result = self._fetch("/_apis/wit/wiql", method="POST", data=data)

        if not result or "workItems" not in result:
            return []

        # Extract IDs from workItems list
        return [item["id"] for item in result.get("workItems", [])]

    def get_work_items_by_ids(self, ids: list[int]) -> list[dict]:
        """
        Get work item details by IDs.

        GET /_apis/wit/workitems with ids parameter.
        Returns [] immediately if ids is empty without calling the API.

        Args:
            ids: List of work item IDs

        Returns:
            List of work item details dicts
        """
        # Handle empty IDs edge case
        if not ids:
            return []

        # Build comma-separated ID list for query parameter
        ids_str = ",".join(str(id_) for id_ in ids)
        endpoint = f"/_apis/wit/workitems?ids={ids_str}"

        result = self._fetch(endpoint)

        if not result or "value" not in result:
            return []

        return result.get("value", [])


def load_azure_devops_config(project_dir: Path) -> AzureDevOpsConfig | None:
    """Load Azure DevOps config from project's .auto-claude/azure-devops/config.json or env vars."""
    # First try environment variables
    import os

    pat = os.getenv("AZURE_DEVOPS_PAT")
    organization = os.getenv("AZURE_DEVOPS_ORG")
    project = os.getenv("AZURE_DEVOPS_PROJECT")

    # Fall back to config file
    if not pat or not organization or not project:
        config_path = project_dir / ".auto-claude" / "azure-devops" / "config.json"

        if config_path.exists():
            try:
                with open(config_path, encoding="utf-8") as f:
                    data = json.load(f)

                pat = pat or data.get("pat")
                organization = organization or data.get("organization")
                project = project or data.get("project")
            except Exception:
                pass

    if not pat or not organization or not project:
        return None

    return AzureDevOpsConfig(
        pat=pat,
        organization=organization,
        project=project,
    )
