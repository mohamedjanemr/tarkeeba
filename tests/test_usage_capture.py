"""
Usage Capture Tests

Tests for:
- task_logger.usage_storage.UsageStorage (round-trip write/read of totals)
- task_logger.logger.TaskLogger.record_usage() (pricing fallback vs.
  SDK-reported cost_usd)
- task_logger.usage_capture.capture_usage_from_result() (extracting fields
  from ResultMessage-like objects, no-op for other message types)
"""

import os
import sys
from types import SimpleNamespace

# Add backend to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'apps', 'backend'))

from core.pricing import calculate_cost
from task_logger.logger import TaskLogger
from task_logger.models import LogPhase, UsageEntry
from task_logger.usage_capture import capture_usage_from_result
from task_logger.usage_storage import UsageStorage, load_usage


# ============================================================================
# Unit Tests for UsageStorage
# ============================================================================

class TestUsageStorageRoundTrip:
    """Round-trip tests: write entries, then read back totals."""

    def test_new_storage_has_zeroed_totals(self, tmp_path):
        """A freshly created UsageStorage should start with zeroed totals."""
        storage = UsageStorage(tmp_path)
        data = storage.get_data()

        assert data["totals"] == {
            "input_tokens": 0,
            "output_tokens": 0,
            "cost_usd": 0.0,
        }
        assert data["entries"] == []

    def test_add_entry_updates_totals(self, tmp_path):
        """Adding an entry should accumulate input/output tokens and cost."""
        storage = UsageStorage(tmp_path)
        entry = UsageEntry(
            timestamp="2026-01-01T00:00:00+00:00",
            phase="coding",
            subtask_id="subtask-1-1",
            session=1,
            model="claude-sonnet-4-5-20250929",
            account="default",
            input_tokens=1000,
            output_tokens=500,
            cache_read_tokens=0,
            cache_creation_tokens=0,
            cost_usd=0.0105,
            source="sdk_reported",
        )

        storage.add_entry(entry)
        data = storage.get_data()

        assert data["totals"]["input_tokens"] == 1000
        assert data["totals"]["output_tokens"] == 500
        assert data["totals"]["cost_usd"] == 0.0105
        assert len(data["entries"]) == 1
        assert data["entries"][0]["model"] == "claude-sonnet-4-5-20250929"

    def test_add_multiple_entries_accumulates_totals(self, tmp_path):
        """Multiple entries should sum together in the totals."""
        storage = UsageStorage(tmp_path)

        for i in range(3):
            entry = UsageEntry(
                timestamp="2026-01-01T00:00:00+00:00",
                phase="coding",
                subtask_id=f"subtask-1-{i}",
                session=1,
                model="claude-sonnet-4-5-20250929",
                account="default",
                input_tokens=100,
                output_tokens=50,
                cache_read_tokens=0,
                cache_creation_tokens=0,
                cost_usd=0.001,
                source="sdk_reported",
            )
            storage.add_entry(entry)

        data = storage.get_data()
        assert data["totals"]["input_tokens"] == 300
        assert data["totals"]["output_tokens"] == 150
        assert data["totals"]["cost_usd"] == 0.003
        assert len(data["entries"]) == 3

    def test_round_trip_persists_to_disk_and_reloads(self, tmp_path):
        """Writing entries with one UsageStorage instance and reading back
        with load_usage() should reflect the same totals."""
        storage = UsageStorage(tmp_path)
        entry = UsageEntry(
            timestamp="2026-01-01T00:00:00+00:00",
            phase="coding",
            subtask_id="subtask-1-1",
            session=1,
            model="claude-opus-4-5-20251101",
            account="default",
            input_tokens=2000,
            output_tokens=1000,
            cache_read_tokens=100,
            cache_creation_tokens=50,
            cost_usd=0.12,
            source="estimated",
        )
        storage.add_entry(entry)

        reloaded = load_usage(tmp_path)

        assert reloaded is not None
        assert reloaded["totals"]["input_tokens"] == 2000
        assert reloaded["totals"]["output_tokens"] == 1000
        assert reloaded["totals"]["cost_usd"] == 0.12
        assert len(reloaded["entries"]) == 1
        assert reloaded["entries"][0]["source"] == "estimated"

    def test_load_usage_returns_none_when_missing(self, tmp_path):
        """load_usage() should return None when no usage.json file exists."""
        assert load_usage(tmp_path) is None

    def test_new_storage_instance_picks_up_prior_writes(self, tmp_path):
        """A new UsageStorage instance pointed at the same dir should see
        entries written by a prior instance (simulating separate processes)."""
        first = UsageStorage(tmp_path)
        entry = UsageEntry(
            timestamp="2026-01-01T00:00:00+00:00",
            phase="coding",
            subtask_id="subtask-1-1",
            session=1,
            model="claude-sonnet-4-5-20250929",
            account="default",
            input_tokens=10,
            output_tokens=5,
            cache_read_tokens=0,
            cache_creation_tokens=0,
            cost_usd=0.0001,
            source="sdk_reported",
        )
        first.add_entry(entry)

        second = UsageStorage(tmp_path)
        data = second.get_data()
        assert data["totals"]["input_tokens"] == 10
        assert len(data["entries"]) == 1


# ============================================================================
# Unit Tests for TaskLogger.record_usage()
# ============================================================================

class TestTaskLoggerRecordUsage:
    """Tests covering cost computation via pricing vs. SDK-reported cost."""

    def test_record_usage_computes_cost_via_pricing_when_omitted(self, tmp_path):
        """When cost_usd is omitted, record_usage() should compute it via
        core.pricing.calculate_cost()."""
        logger = TaskLogger(tmp_path, emit_markers=False)
        logger.current_phase = LogPhase.CODING

        logger.record_usage(
            model="claude-sonnet-4-5-20250929",
            input_tokens=1_000_000,
            output_tokens=1_000_000,
        )

        expected_cost = calculate_cost(
            model="claude-sonnet-4-5-20250929",
            input_tokens=1_000_000,
            output_tokens=1_000_000,
        )

        data = load_usage(tmp_path)
        assert data is not None
        assert len(data["entries"]) == 1
        entry = data["entries"][0]
        assert entry["cost_usd"] == expected_cost
        assert entry["source"] == "sdk_reported"

    def test_record_usage_uses_sdk_reported_cost_directly(self, tmp_path):
        """When cost_usd is explicitly provided (SDK-reported), record_usage()
        should use it as-is rather than recomputing via pricing."""
        logger = TaskLogger(tmp_path, emit_markers=False)
        logger.current_phase = LogPhase.CODING

        sdk_reported_cost = 0.04242

        logger.record_usage(
            model="claude-sonnet-4-5-20250929",
            input_tokens=1_000_000,
            output_tokens=1_000_000,
            cost_usd=sdk_reported_cost,
        )

        data = load_usage(tmp_path)
        entry = data["entries"][0]
        assert entry["cost_usd"] == sdk_reported_cost

        # Sanity check: the SDK-reported cost differs from the pricing-based
        # estimate, proving the pricing fallback was NOT used.
        estimated_cost = calculate_cost(
            model="claude-sonnet-4-5-20250929",
            input_tokens=1_000_000,
            output_tokens=1_000_000,
        )
        assert sdk_reported_cost != estimated_cost

    def test_record_usage_defaults_account_and_source(self, tmp_path):
        """record_usage() should default account to 'default' and source to
        'sdk_reported' when not specified."""
        logger = TaskLogger(tmp_path, emit_markers=False)

        logger.record_usage(
            model="claude-haiku-4-5-20251001",
            input_tokens=100,
            output_tokens=50,
        )

        data = load_usage(tmp_path)
        entry = data["entries"][0]
        assert entry["account"] == "default"
        assert entry["source"] == "sdk_reported"

    def test_record_usage_with_estimated_source(self, tmp_path):
        """record_usage() should honor an explicit 'estimated' source."""
        logger = TaskLogger(tmp_path, emit_markers=False)

        logger.record_usage(
            model="claude-haiku-4-5-20251001",
            input_tokens=100,
            output_tokens=50,
            source="estimated",
        )

        data = load_usage(tmp_path)
        entry = data["entries"][0]
        assert entry["source"] == "estimated"


# ============================================================================
# Unit Tests for capture_usage_from_result()
# ============================================================================

class TestCaptureUsageFromResult:
    """Tests for capture_usage_from_result()'s message-type dispatch and
    field extraction."""

    def test_noop_for_non_result_message(self, tmp_path):
        """Non-ResultMessage message types should be ignored entirely."""
        logger = TaskLogger(tmp_path, emit_markers=False)

        other_msg = SimpleNamespace(subtype="text", content="hello")

        capture_usage_from_result(
            other_msg,
            task_logger=logger,
            model="claude-sonnet-4-5-20250929",
        )

        data = load_usage(tmp_path)
        assert data is None

    def test_noop_when_task_logger_is_none(self, tmp_path):
        """capture_usage_from_result() should no-op when task_logger is None,
        without raising."""
        result_msg = SimpleNamespace(
            __class__=type("ResultMessage", (), {}),
            subtype="success",
            total_cost_usd=0.05,
            usage={"input_tokens": 100, "output_tokens": 50},
        )

        # Should not raise even though task_logger is None.
        capture_usage_from_result(
            result_msg,
            task_logger=None,
            model="claude-sonnet-4-5-20250929",
        )

    def test_extracts_fields_from_result_message(self, tmp_path):
        """A ResultMessage-like object should have its usage/cost fields
        extracted and recorded via TaskLogger.record_usage()."""
        logger = TaskLogger(tmp_path, emit_markers=False)

        ResultMessage = type("ResultMessage", (), {})
        result_msg = ResultMessage()
        result_msg.subtype = "success"
        result_msg.total_cost_usd = 0.0987
        result_msg.usage = {
            "input_tokens": 1500,
            "output_tokens": 750,
            "cache_read_input_tokens": 200,
            "cache_creation_input_tokens": 100,
        }

        capture_usage_from_result(
            result_msg,
            task_logger=logger,
            model="claude-opus-4-5-20251101",
            account="profile-a",
        )

        data = load_usage(tmp_path)
        assert data is not None
        assert len(data["entries"]) == 1
        entry = data["entries"][0]
        assert entry["model"] == "claude-opus-4-5-20251101"
        assert entry["account"] == "profile-a"
        assert entry["input_tokens"] == 1500
        assert entry["output_tokens"] == 750
        assert entry["cache_read_tokens"] == 200
        assert entry["cache_creation_tokens"] == 100
        assert entry["cost_usd"] == 0.0987
        assert entry["source"] == "sdk_reported"

    def test_handles_missing_usage_dict(self, tmp_path):
        """A ResultMessage with no usage attribute should default token
        counts to zero instead of raising."""
        logger = TaskLogger(tmp_path, emit_markers=False)

        ResultMessage = type("ResultMessage", (), {})
        result_msg = ResultMessage()
        result_msg.subtype = "success"
        result_msg.total_cost_usd = None

        capture_usage_from_result(
            result_msg,
            task_logger=logger,
            model="claude-sonnet-4-5-20250929",
        )

        data = load_usage(tmp_path)
        entry = data["entries"][0]
        assert entry["input_tokens"] == 0
        assert entry["output_tokens"] == 0
        assert entry["cache_read_tokens"] == 0
        assert entry["cache_creation_tokens"] == 0
        # cost_usd falls back to the pricing calculation since
        # total_cost_usd was None.
        assert entry["cost_usd"] == calculate_cost(
            model="claude-sonnet-4-5-20250929",
            input_tokens=0,
            output_tokens=0,
        )

    def test_account_omitted_when_not_provided(self, tmp_path):
        """When account is not passed, record_usage() should fall back to
        its own default rather than receiving an explicit None/empty value."""
        logger = TaskLogger(tmp_path, emit_markers=False)

        ResultMessage = type("ResultMessage", (), {})
        result_msg = ResultMessage()
        result_msg.subtype = "success"
        result_msg.total_cost_usd = 0.01
        result_msg.usage = {"input_tokens": 10, "output_tokens": 5}

        capture_usage_from_result(
            result_msg,
            task_logger=logger,
            model="claude-sonnet-4-5-20250929",
        )

        data = load_usage(tmp_path)
        entry = data["entries"][0]
        assert entry["account"] == "default"
