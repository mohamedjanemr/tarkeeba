"""
Persistent storage for structured per-session timing metrics.
"""

import json
import os
import sys
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path


class SessionTimingStorage:
    """Stores session timings independently from recovery attempt history."""

    METRICS_FILE = "session_metrics.json"

    def __init__(self, spec_dir: Path):
        self.spec_dir = Path(spec_dir)
        self.metrics_file = self.spec_dir / self.METRICS_FILE
        self._data = self._load_or_create()

    def _new_data(self) -> dict:
        now = self._timestamp()
        return {
            "spec_id": self.spec_dir.name,
            "created_at": now,
            "updated_at": now,
            "span_semantics": {
                "totals": [
                    "agent_execution_total",
                    "post_processing_total",
                    "qa_session_total",
                    "total_duration_ms",
                ],
                "components": [
                    "client_configuration",
                    "client_startup",
                    "context_build",
                    "graphiti_retrieval",
                    "verification",
                    "commit",
                    "verification_commit_mixed",
                    "commit_tracking",
                    "insight_extraction",
                    "memory_save",
                ],
                "estimates": ["implementation_estimate"],
                "note": (
                    "Totals overlap component spans. implementation_estimate is "
                    "agent execution minus classified verification and commit time. "
                    "Mixed Bash verification/commit time is kept unallocated."
                ),
            },
            "sessions": [],
        }

    def _load_or_create(self) -> dict:
        if self.metrics_file.exists():
            try:
                with open(self.metrics_file, encoding="utf-8") as file:
                    data = json.load(file)
                if isinstance(data, dict) and isinstance(data.get("sessions"), list):
                    return data
            except (OSError, json.JSONDecodeError, UnicodeDecodeError):
                pass

        return self._new_data()

    def _reload(self) -> None:
        """Reload the latest file before each read-modify-write mutation."""
        self._data = self._load_or_create()

    def _timestamp(self) -> str:
        return datetime.now(timezone.utc).isoformat()

    def _save(self) -> None:
        """Atomically replace the metrics file so readers never see partial JSON."""
        self._data["updated_at"] = self._timestamp()
        try:
            self.spec_dir.mkdir(parents=True, exist_ok=True)
            fd, tmp_path = tempfile.mkstemp(
                dir=self.spec_dir, prefix=".session_metrics_", suffix=".tmp"
            )
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as file:
                    json.dump(self._data, file, indent=2, ensure_ascii=False)
                os.replace(tmp_path, self.metrics_file)
            except Exception:
                if os.path.exists(tmp_path):
                    os.unlink(tmp_path)
                raise
        except OSError as exc:
            print(f"Warning: Failed to save session metrics: {exc}", file=sys.stderr)

    def _find_session(self, session_id: str) -> dict:
        for session in self._data["sessions"]:
            if session.get("id") == session_id:
                return session
        raise KeyError(f"Unknown session timing ID: {session_id}")

    def start_session(
        self,
        *,
        phase: str,
        session: int,
        subtask_id: str | None = None,
        label: str | None = None,
        started_at: str | None = None,
    ) -> str:
        """Append a new session timing record and return its UUID."""
        self._reload()
        now = started_at or self._timestamp()
        for existing in self._data["sessions"]:
            if existing.get("ended_at") is None:
                start_dt = datetime.fromisoformat(existing["started_at"])
                end_dt = datetime.fromisoformat(now)
                existing["ended_at"] = now
                existing["outcome"] = "interrupted"
                existing["total_duration_ms"] = max(
                    0, round((end_dt - start_dt).total_seconds() * 1000)
                )

        session_id = str(uuid.uuid4())
        self._data["sessions"].append(
            {
                "id": session_id,
                "phase": phase,
                "session": session,
                "subtask_id": subtask_id,
                "label": label,
                "started_at": now,
                "ended_at": None,
                "outcome": None,
                "total_duration_ms": None,
                "spans": {},
            }
        )
        self._save()
        return session_id

    def add_span(self, session_id: str, name: str, duration_ms: int | float) -> None:
        """Accumulate a named span's duration and invocation count."""
        if duration_ms < 0:
            raise ValueError("Span duration cannot be negative")

        self._reload()
        session = self._find_session(session_id)
        spans = session.setdefault("spans", {})
        span = spans.setdefault(name, {"duration_ms": 0, "count": 0})
        span["duration_ms"] += round(duration_ms)
        span["count"] += 1
        self._save()

    def end_session(
        self,
        session_id: str,
        *,
        outcome: str,
        ended_at: str | None = None,
    ) -> None:
        """Finish a session and calculate its total wall-clock duration."""
        self._reload()
        session = self._find_session(session_id)
        end = ended_at or self._timestamp()
        start_dt = datetime.fromisoformat(session["started_at"])
        end_dt = datetime.fromisoformat(end)
        session["ended_at"] = end
        session["outcome"] = outcome
        session["total_duration_ms"] = max(
            0, round((end_dt - start_dt).total_seconds() * 1000)
        )
        self._save()

    def get_data(self) -> dict:
        """Return the currently loaded metrics data."""
        return self._data

    def update_spec_id(self, new_spec_id: str) -> None:
        """Update the task identifier after a spec directory rename."""
        self._reload()
        self._data["spec_id"] = new_spec_id
        self._save()


def load_session_metrics(spec_dir: Path) -> dict | None:
    """Load session metrics, returning None when missing or unreadable."""
    metrics_file = Path(spec_dir) / SessionTimingStorage.METRICS_FILE
    if not metrics_file.exists():
        return None

    try:
        with open(metrics_file, encoding="utf-8") as file:
            data = json.load(file)
        if isinstance(data, dict) and isinstance(data.get("sessions"), list):
            return data
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        pass
    return None
