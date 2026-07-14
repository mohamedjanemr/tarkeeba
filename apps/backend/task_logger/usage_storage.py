"""
Storage functionality for usage/cost tracking.
"""

import json
import os
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from .models import UsageEntry


class UsageStorage:
    """Handles persistent storage of usage/cost tracking data."""

    USAGE_FILE = "usage.json"

    def __init__(self, spec_dir: Path):
        """
        Initialize usage storage.

        Args:
            spec_dir: Path to the spec directory
        """
        self.spec_dir = Path(spec_dir)
        self.usage_file = self.spec_dir / self.USAGE_FILE
        self._data: dict = self._load_or_create()

    def _load_or_create(self) -> dict:
        """Load existing usage data or create new structure."""
        if self.usage_file.exists():
            try:
                with open(self.usage_file, encoding="utf-8") as f:
                    return json.load(f)
            except (OSError, json.JSONDecodeError, UnicodeDecodeError):
                pass

        return {
            "spec_id": self.spec_dir.name,
            "created_at": self._timestamp(),
            "updated_at": self._timestamp(),
            "entries": [],
            "totals": {
                "input_tokens": 0,
                "output_tokens": 0,
                "cost_usd": 0.0,
            },
        }

    def save(self) -> None:
        """Save usage data to file atomically to prevent corruption from concurrent reads."""
        self._data["updated_at"] = self._timestamp()
        try:
            self.spec_dir.mkdir(parents=True, exist_ok=True)
            # Write to temp file first, then atomic rename to prevent corruption
            # when the UI reads mid-write
            fd, tmp_path = tempfile.mkstemp(
                dir=self.spec_dir, prefix=".usage_", suffix=".tmp"
            )
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as f:
                    json.dump(self._data, f, indent=2, ensure_ascii=False)
                # Atomic rename (on POSIX systems, rename is atomic)
                os.replace(tmp_path, self.usage_file)
            except Exception:
                # Clean up temp file on failure
                if os.path.exists(tmp_path):
                    os.unlink(tmp_path)
                raise
        except OSError as e:
            print(f"Warning: Failed to save usage data: {e}", file=sys.stderr)

    def _timestamp(self) -> str:
        """Get current timestamp in ISO format."""
        return datetime.now(timezone.utc).isoformat()

    def add_entry(self, entry: UsageEntry) -> None:
        """
        Add a usage entry and update totals.

        Re-reads the file before writing to reduce the chance of losing
        concurrent writes from other processes/phases.

        Args:
            entry: The usage entry to add
        """
        # Re-load latest data in case another process has written since init,
        # to minimize lost updates from concurrent phases.
        self._data = self._load_or_create()

        self._data["entries"].append(entry.to_dict())

        totals = self._data.setdefault(
            "totals", {"input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0}
        )
        totals["input_tokens"] = totals.get("input_tokens", 0) + entry.input_tokens
        totals["output_tokens"] = totals.get("output_tokens", 0) + entry.output_tokens
        totals["cost_usd"] = round(totals.get("cost_usd", 0.0) + entry.cost_usd, 6)

        self.save()

    def get_data(self) -> dict:
        """Get all usage data."""
        return self._data

    def update_spec_id(self, new_spec_id: str) -> None:
        """
        Update the spec ID in the data.

        Args:
            new_spec_id: New spec ID
        """
        self._data["spec_id"] = new_spec_id


def load_usage(spec_dir: Path) -> dict | None:
    """
    Load usage data from a spec directory.

    Args:
        spec_dir: Path to the spec directory

    Returns:
        Usage dictionary or None if not found
    """
    usage_file = spec_dir / UsageStorage.USAGE_FILE
    if not usage_file.exists():
        return None

    try:
        with open(usage_file, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return None
