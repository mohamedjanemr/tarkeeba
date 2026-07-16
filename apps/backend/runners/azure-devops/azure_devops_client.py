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
