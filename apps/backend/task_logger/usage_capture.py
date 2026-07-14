"""
Shared helper for capturing usage/cost data from Claude Agent SDK results.

Used by every message loop that consumes `client.receive_response()` output
(coder, planner, QA reviewer/fixer sessions, etc.) to avoid duplicating
ResultMessage-parsing logic in each caller.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .logger import TaskLogger


def capture_usage_from_result(
    msg,
    task_logger: "TaskLogger | None",
    model: str,
    account: str | None = None,
) -> None:
    """
    Extract usage/cost info from a `ResultMessage` and record it via TaskLogger.

    No-ops for any other message type, or when `task_logger` is None.

    Args:
        msg: A message yielded from `client.receive_response()`
        task_logger: The TaskLogger instance to record usage on, or None
        model: Model identifier used for the request (for pricing/labeling)
        account: Profile/config-dir identifier for the account used
    """
    if task_logger is None:
        return

    if type(msg).__name__ != "ResultMessage":
        return

    usage = getattr(msg, "usage", None) or {}
    cost_usd = getattr(msg, "total_cost_usd", None)

    input_tokens = usage.get("input_tokens", 0) or 0
    output_tokens = usage.get("output_tokens", 0) or 0
    cache_read_tokens = usage.get("cache_read_input_tokens", 0) or 0
    cache_creation_tokens = usage.get("cache_creation_input_tokens", 0) or 0

    kwargs = {}
    if account is not None:
        kwargs["account"] = account

    source = "sdk_reported" if cost_usd is not None else "estimated"

    task_logger.record_usage(
        model=model,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cache_read_tokens=cache_read_tokens,
        cache_creation_tokens=cache_creation_tokens,
        cost_usd=cost_usd,
        source=source,
        **kwargs,
    )
