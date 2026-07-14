"""
Usage Pricing Tests

Tests for core.pricing.calculate_cost() covering each pricing tier and the
'default'/unknown-model fallback.
"""

import os
import sys

# Add backend to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'apps', 'backend'))

from core.pricing import MODEL_PRICING, calculate_cost


class TestCalculateCostKnownModels:
    """Unit tests for calculate_cost() across each known pricing tier."""

    def test_sonnet_4_5_input_only(self):
        """Sonnet 4.5 input tokens are billed at $3.00 / 1M tokens."""
        cost = calculate_cost(
            model="claude-sonnet-4-5-20250929",
            input_tokens=1_000_000,
            output_tokens=0,
        )
        assert cost == 3.00

    def test_sonnet_4_5_output_only(self):
        """Sonnet 4.5 output tokens are billed at $15.00 / 1M tokens."""
        cost = calculate_cost(
            model="claude-sonnet-4-5-20250929",
            input_tokens=0,
            output_tokens=1_000_000,
        )
        assert cost == 15.00

    def test_sonnet_4_5_full_breakdown(self):
        """Sonnet 4.5 cost combines input, output, cache read, and cache creation."""
        cost = calculate_cost(
            model="claude-sonnet-4-5-20250929",
            input_tokens=1_000_000,
            output_tokens=1_000_000,
            cache_read_tokens=1_000_000,
            cache_creation_tokens=1_000_000,
        )
        expected = 3.00 + 15.00 + 0.30 + 3.75
        assert cost == expected

    def test_opus_4_5_pricing(self):
        """Opus 4.5 pricing tier applies its own rates."""
        cost = calculate_cost(
            model="claude-opus-4-5-20251101",
            input_tokens=1_000_000,
            output_tokens=1_000_000,
        )
        assert cost == 15.00 + 75.00

    def test_opus_4_6_pricing(self):
        """Opus 4.6 pricing tier applies its own rates."""
        cost = calculate_cost(
            model="claude-opus-4-6",
            input_tokens=1_000_000,
            output_tokens=1_000_000,
        )
        assert cost == 15.00 + 75.00

    def test_haiku_4_5_pricing(self):
        """Haiku 4.5 pricing tier applies its own (cheaper) rates."""
        cost = calculate_cost(
            model="claude-haiku-4-5-20251001",
            input_tokens=1_000_000,
            output_tokens=1_000_000,
            cache_read_tokens=1_000_000,
            cache_creation_tokens=1_000_000,
        )
        expected = 0.80 + 4.00 + 0.08 + 1.00
        assert cost == expected

    def test_sonnet_4_5_thinking_pricing(self):
        """Extended-thinking Sonnet variant uses its dedicated pricing tier."""
        cost = calculate_cost(
            model="claude-sonnet-4-5-20250929-thinking",
            input_tokens=1_000_000,
            output_tokens=1_000_000,
        )
        assert cost == 3.00 + 15.00

    def test_zero_tokens_is_zero_cost(self):
        """No tokens used should always result in zero cost."""
        cost = calculate_cost(
            model="claude-sonnet-4-5-20250929",
            input_tokens=0,
            output_tokens=0,
        )
        assert cost == 0.0

    def test_partial_tokens_scaled_correctly(self):
        """Sub-1M token counts should be scaled proportionally."""
        cost = calculate_cost(
            model="claude-sonnet-4-5-20250929",
            input_tokens=500_000,
            output_tokens=0,
        )
        assert cost == 1.50


class TestCalculateCostDefaultFallback:
    """Unit tests for the 'default'/unknown-model fallback tier."""

    def test_unknown_model_uses_default_pricing(self):
        """An unrecognized model identifier falls back to the 'default' tier."""
        cost = calculate_cost(
            model="some-future-model-not-yet-defined",
            input_tokens=1_000_000,
            output_tokens=1_000_000,
        )
        default_pricing = MODEL_PRICING["default"]
        expected = default_pricing["input"] + default_pricing["output"]
        assert cost == expected

    def test_empty_model_string_uses_default_pricing(self):
        """An empty model string is treated as unrecognized and falls back."""
        cost = calculate_cost(
            model="",
            input_tokens=1_000_000,
            output_tokens=0,
        )
        assert cost == MODEL_PRICING["default"]["input"]

    def test_default_tier_matches_sonnet_4_5_rates(self):
        """The 'default' fallback tier currently mirrors Sonnet 4.5 pricing."""
        assert MODEL_PRICING["default"] == {
            "input": 3.00,
            "output": 15.00,
            "cache_read": 0.30,
            "cache_creation": 3.75,
        }


class TestCalculateCostEdgeCases:
    """Edge case handling for calculate_cost()."""

    def test_negative_tokens_are_clamped_to_zero(self):
        """Negative token counts (bad input) should not produce negative cost."""
        cost = calculate_cost(
            model="claude-sonnet-4-5-20250929",
            input_tokens=-100,
            output_tokens=-100,
            cache_read_tokens=-100,
            cache_creation_tokens=-100,
        )
        assert cost == 0.0

    def test_cost_is_never_negative(self):
        """calculate_cost() should always return a non-negative value."""
        cost = calculate_cost(
            model="claude-sonnet-4-5-20250929",
            input_tokens=100,
            output_tokens=100,
        )
        assert cost >= 0.0
