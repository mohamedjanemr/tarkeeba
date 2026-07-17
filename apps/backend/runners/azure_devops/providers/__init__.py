"""
Azure DevOps Git Provider Abstraction
======================================

Implements the GitProvider protocol for Azure DevOps.

Usage:
    from providers import get_provider

    # Get provider based on config
    provider = get_provider("azure_devops", repo)

    # Fetch PR data
    pr = await provider.fetch_pr(123)

    # Post review
    await provider.post_review(123, review)
"""

from .azure_devops_provider import AzureDevOpsProvider

__all__ = [
    "AzureDevOpsProvider",
]
