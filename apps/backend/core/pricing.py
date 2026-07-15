"""
Model Pricing & Cost Calculation
=================================

Fallback cost calculation for AI API usage when the Claude Agent SDK's
`ResultMessage.total_cost_usd` is not populated (e.g. some providers/z.ai
routes may not report cost).

Pricing figures mirror `apps/backend/runners/github/rate_limiter.py`'s
`AI_PRICING` dict for consistency across the codebase. That file is owned by
a separate feature (GitHub PR automation) and is intentionally not imported
from or modified here to keep this module dependency-free.

Usage:
    from core.pricing import calculate_cost

    cost = calculate_cost(
        model="claude-sonnet-4-5-20250929",
        input_tokens=1000,
        output_tokens=500,
        cache_read_tokens=200,
        cache_creation_tokens=100,
    )
"""

from __future__ import annotations

# Per-model pricing in USD per 1M tokens.
# Cache read tokens are billed at a discount vs. regular input tokens;
# cache creation tokens are billed at a premium vs. regular input tokens.
# When a model entry omits "cache_read"/"cache_creation", we fall back to
# the model's own "input" rate (i.e. no discount/premium applied).
MODEL_PRICING = {
    # Claude 4.5 models (current)
    "claude-sonnet-4-5-20250929": {
        "input": 3.00,
        "output": 15.00,
        "cache_read": 0.30,
        "cache_creation": 3.75,
    },
    "claude-opus-4-5-20251101": {
        "input": 15.00,
        "output": 75.00,
        "cache_read": 1.50,
        "cache_creation": 18.75,
    },
    "claude-opus-4-6": {
        "input": 15.00,
        "output": 75.00,
        "cache_read": 1.50,
        "cache_creation": 18.75,
    },
    # Note: Opus 4.6 with 1M context (opus-1m) uses the same model ID with a beta
    # header, so it shares the same pricing key. Requests >200K tokens incur premium
    # rates (2x input, 1.5x output) automatically on the API side.
    "claude-haiku-4-5-20251001": {
        "input": 0.80,
        "output": 4.00,
        "cache_read": 0.08,
        "cache_creation": 1.00,
    },
    # Extended thinking models (higher output costs)
    "claude-sonnet-4-5-20250929-thinking": {
        "input": 3.00,
        "output": 15.00,
        "cache_read": 0.30,
        "cache_creation": 3.75,
    },
    # Default fallback for unrecognized/future model identifiers
    "default": {
        "input": 3.00,
        "output": 15.00,
        "cache_read": 0.30,
        "cache_creation": 3.75,
    },
}


def calculate_cost(
    model: str,
    input_tokens: int,
    output_tokens: int,
    cache_read_tokens: int = 0,
    cache_creation_tokens: int = 0,
) -> float:
    """
    Calculate the estimated USD cost of an AI API call.

    Used as a fallback when the SDK's `ResultMessage.total_cost_usd` is
    `None` (e.g. some providers/z.ai routes may not report cost).

    Args:
        model: Model identifier (e.g. "claude-sonnet-4-5-20250929"). Falls
            back to the "default" pricing tier if unrecognized.
        input_tokens: Number of (non-cached) input tokens.
        output_tokens: Number of output tokens.
        cache_read_tokens: Number of tokens read from prompt cache.
        cache_creation_tokens: Number of tokens written to prompt cache.

    Returns:
        Estimated cost in USD (>= 0.0).
    """
    pricing = MODEL_PRICING.get(model, MODEL_PRICING["default"])

    input_rate = pricing["input"]
    output_rate = pricing["output"]
    cache_read_rate = pricing.get("cache_read", input_rate)
    cache_creation_rate = pricing.get("cache_creation", input_rate)

    cost = (
        (max(input_tokens, 0) / 1_000_000) * input_rate
        + (max(output_tokens, 0) / 1_000_000) * output_rate
        + (max(cache_read_tokens, 0) / 1_000_000) * cache_read_rate
        + (max(cache_creation_tokens, 0) / 1_000_000) * cache_creation_rate
    )

    return cost
