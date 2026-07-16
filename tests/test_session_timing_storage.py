"""Tests for structured per-session timing storage."""

import os
import sys
import uuid

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "apps", "backend"))

from task_logger.logger import TaskLogger
from task_logger.models import LogPhase
from task_logger.timing_storage import SessionTimingStorage, load_session_metrics


def test_start_session_persists_structured_record(tmp_path):
    storage = SessionTimingStorage(tmp_path)

    session_id = storage.start_session(
        phase="coding",
        session=3,
        subtask_id="subtask-2-1",
        label="coder",
        started_at="2026-07-16T10:00:00+00:00",
    )

    assert str(uuid.UUID(session_id)) == session_id
    data = load_session_metrics(tmp_path)
    assert data is not None
    assert data["spec_id"] == tmp_path.name
    assert data["sessions"] == [
        {
            "id": session_id,
            "phase": "coding",
            "session": 3,
            "subtask_id": "subtask-2-1",
            "label": "coder",
            "started_at": "2026-07-16T10:00:00+00:00",
            "ended_at": None,
            "outcome": None,
            "total_duration_ms": None,
            "spans": {},
        }
    ]


def test_named_spans_accumulate_duration_and_count(tmp_path):
    storage = SessionTimingStorage(tmp_path)
    session_id = storage.start_session(phase="coding", session=1)

    storage.add_span(session_id, "graphiti_retrieval", 12)
    storage.add_span(session_id, "graphiti_retrieval", 8.4)
    storage.add_span(session_id, "client_startup", 4)

    data = load_session_metrics(tmp_path)
    assert data is not None
    spans = data["sessions"][0]["spans"]
    assert spans["graphiti_retrieval"] == {"duration_ms": 20, "count": 2}
    assert spans["client_startup"] == {"duration_ms": 4, "count": 1}


def test_end_session_records_outcome_and_total_duration(tmp_path):
    storage = SessionTimingStorage(tmp_path)
    session_id = storage.start_session(
        phase="coding",
        session=1,
        started_at="2026-07-16T10:00:00+00:00",
    )

    storage.end_session(
        session_id,
        outcome="completed",
        ended_at="2026-07-16T10:00:01.250000+00:00",
    )

    data = load_session_metrics(tmp_path)
    assert data is not None
    session = data["sessions"][0]
    assert session["ended_at"] == "2026-07-16T10:00:01.250000+00:00"
    assert session["outcome"] == "completed"
    assert session["total_duration_ms"] == 1250


def test_each_mutation_reloads_prior_writes(tmp_path):
    first = SessionTimingStorage(tmp_path)
    second = SessionTimingStorage(tmp_path)
    first_id = first.start_session(phase="planning", session=1)
    second_id = second.start_session(phase="coding", session=2)

    first.add_span(first_id, "context_build", 10)
    second.end_session(second_id, outcome="failed")

    data = load_session_metrics(tmp_path)
    assert data is not None
    assert {session["id"] for session in data["sessions"]} == {first_id, second_id}
    assert data["sessions"][0]["spans"]["context_build"]["duration_ms"] == 10
    assert data["sessions"][1]["outcome"] == "failed"


def test_corrupt_metrics_are_safely_recovered(tmp_path):
    metrics_file = tmp_path / SessionTimingStorage.METRICS_FILE
    metrics_file.write_text("{not valid json", encoding="utf-8")

    assert load_session_metrics(tmp_path) is None

    storage = SessionTimingStorage(tmp_path)
    session_id = storage.start_session(phase="coding", session=1)
    recovered = load_session_metrics(tmp_path)

    assert recovered is not None
    assert [session["id"] for session in recovered["sessions"]] == [session_id]


def test_negative_span_duration_is_rejected(tmp_path):
    storage = SessionTimingStorage(tmp_path)
    session_id = storage.start_session(phase="coding", session=1)

    with pytest.raises(ValueError, match="cannot be negative"):
        storage.add_span(session_id, "client_startup", -1)


def test_new_session_closes_interrupted_open_session(tmp_path):
    storage = SessionTimingStorage(tmp_path)
    first_id = storage.start_session(
        phase="coding",
        session=1,
        started_at="2026-07-16T10:00:00+00:00",
    )

    storage.start_session(
        phase="coding",
        session=2,
        started_at="2026-07-16T10:00:05+00:00",
    )

    data = load_session_metrics(tmp_path)
    assert data is not None
    first = next(session for session in data["sessions"] if session["id"] == first_id)
    assert first["outcome"] == "interrupted"
    assert first["total_duration_ms"] == 5000


def test_task_logger_records_and_resets_session_context(tmp_path):
    logger = TaskLogger(tmp_path, emit_markers=False)
    logger.set_session(7)
    logger.set_subtask("subtask-7")
    logger.start_session_timing(LogPhase.CODING)
    logger.record_timing("context_build", 0.01)
    logger.end_session_timing("continue")

    data = load_session_metrics(tmp_path)
    assert data is not None
    assert data["sessions"][0]["spans"]["context_build"] == {
        "duration_ms": 10,
        "count": 1,
    }
    assert logger.current_session is None
    assert logger.current_subtask is None


def test_task_logger_timing_failures_do_not_abort_execution(tmp_path, monkeypatch):
    logger = TaskLogger(tmp_path, emit_markers=False)
    logger.set_session(1)

    monkeypatch.setattr(
        logger.timing_storage,
        "start_session",
        lambda **_kwargs: (_ for _ in ()).throw(OSError("disk unavailable")),
    )
    logger.start_session_timing(LogPhase.CODING)
    assert logger.current_timing_id is None
    logger.end_session_timing("error")
    assert logger.current_session is None

    logger.set_session(2)
    logger.current_timing_id = "missing"
    logger.current_subtask = "subtask-1"
    monkeypatch.setattr(
        logger.timing_storage,
        "add_span",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(KeyError("missing")),
    )
    monkeypatch.setattr(
        logger.timing_storage,
        "end_session",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(KeyError("missing")),
    )

    logger.record_timing("context_build", 0.01)
    logger.end_session_timing("error")

    assert logger.current_timing_id is None
    assert logger.current_session is None
    assert logger.current_subtask is None
