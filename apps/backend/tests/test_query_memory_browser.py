"""
Tests for the query_memory.py memory-browser CLI.

Tests cover:
- compute_project_group_id() determinism and format
- resolve_group_id() precedence rules
- argparse routing for get-relationships / delete-memory / update-memory
- graceful JSON output when the database / tables are absent

The command handlers write JSON to stdout and call sys.exit(), so they are
exercised through a small helper that captures the emitted JSON and exit code.
No real database is required: a temp path (missing database) drives the
"database absent" paths, and apply_monkeypatch is stubbed so the handlers do not
short-circuit on a missing kuzu/LadybugDB backend.
"""

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

import pytest

# Ensure the backend root (where query_memory.py lives) is importable
# regardless of pytest's import mode.
BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import query_memory  # noqa: E402


# =============================================================================
# Helpers
# =============================================================================


def run_handler(handler, args, capsys):
    """Run a command handler, capturing its JSON output and exit code.

    The handlers call sys.exit() via output_json/output_error, so we trap the
    SystemExit and parse the single JSON line written to stdout.
    """
    with pytest.raises(SystemExit) as exc_info:
        handler(args)
    captured = capsys.readouterr()
    payload = json.loads(captured.out.strip())
    return payload, exc_info.value.code


@pytest.fixture
def force_backend(monkeypatch):
    """Pretend a kuzu/LadybugDB backend is installed.

    Handlers bail out early with an error when apply_monkeypatch() returns a
    falsy value. Stubbing it lets us exercise the database-absent JSON paths.
    """
    monkeypatch.setattr(query_memory, "apply_monkeypatch", lambda: "kuzu")


# =============================================================================
# compute_project_group_id
# =============================================================================


class TestComputeProjectGroupId:
    """Test compute_project_group_id determinism and format."""

    def test_format_matches_expected_pattern(self, tmp_path):
        """group_id has form project_{name}_{8-hex-hash}."""
        project_dir = tmp_path / "my-project"
        project_dir.mkdir()

        group_id = query_memory.compute_project_group_id(str(project_dir))

        assert re.fullmatch(r"project_my-project_[0-9a-f]{8}", group_id)

    def test_matches_manual_computation(self, tmp_path):
        """group_id equals project_{name}_{md5(resolved)[:8]}."""
        project_dir = tmp_path / "alpha"
        project_dir.mkdir()

        expected_hash = hashlib.md5(
            str(project_dir.resolve()).encode(), usedforsecurity=False
        ).hexdigest()[:8]
        expected = f"project_alpha_{expected_hash}"

        assert query_memory.compute_project_group_id(str(project_dir)) == expected

    def test_deterministic_for_same_path(self, tmp_path):
        """Same directory yields the same group_id across calls."""
        project_dir = tmp_path / "stable"
        project_dir.mkdir()

        first = query_memory.compute_project_group_id(str(project_dir))
        second = query_memory.compute_project_group_id(str(project_dir))

        assert first == second

    def test_different_paths_differ(self, tmp_path):
        """Different directories yield different group_ids."""
        dir_a = tmp_path / "a"
        dir_b = tmp_path / "b"
        dir_a.mkdir()
        dir_b.mkdir()

        assert query_memory.compute_project_group_id(
            str(dir_a)
        ) != query_memory.compute_project_group_id(str(dir_b))

    def test_uses_directory_basename(self, tmp_path):
        """The name segment is the directory basename."""
        project_dir = tmp_path / "cool_name"
        project_dir.mkdir()

        group_id = query_memory.compute_project_group_id(str(project_dir))

        assert group_id.startswith("project_cool_name_")


# =============================================================================
# resolve_group_id
# =============================================================================


class TestResolveGroupId:
    """Test resolve_group_id precedence rules."""

    def test_explicit_group_id_wins(self, tmp_path):
        """An explicit --group-id overrides --project-dir."""
        args = argparse.Namespace(
            group_id="explicit_group", project_dir=str(tmp_path)
        )

        assert query_memory.resolve_group_id(args) == "explicit_group"

    def test_project_dir_computes_group_id(self, tmp_path):
        """--project-dir is converted via compute_project_group_id."""
        project_dir = tmp_path / "proj"
        project_dir.mkdir()
        args = argparse.Namespace(group_id=None, project_dir=str(project_dir))

        expected = query_memory.compute_project_group_id(str(project_dir))
        assert query_memory.resolve_group_id(args) == expected

    def test_none_when_unscoped(self):
        """No group_id and no project_dir returns None (unscoped)."""
        args = argparse.Namespace(group_id=None, project_dir=None)

        assert query_memory.resolve_group_id(args) is None

    def test_missing_attributes_default_to_none(self):
        """Absent attributes are treated as None (backward compatible)."""
        args = argparse.Namespace()

        assert query_memory.resolve_group_id(args) is None


# =============================================================================
# argparse routing
# =============================================================================


class TestArgparseRouting:
    """Test main() routes subcommands to the correct handler with parsed args."""

    def _route(self, monkeypatch, argv, command):
        """Patch the handler for `command`, run main(), return captured args."""
        captured = {}

        def fake_handler(args):
            captured["args"] = args

        handler_name = {
            "get-relationships": "cmd_get_relationships",
            "delete-memory": "cmd_delete_memory",
            "update-memory": "cmd_update_memory",
        }[command]
        monkeypatch.setattr(query_memory, handler_name, fake_handler)
        monkeypatch.setattr(sys, "argv", ["query_memory.py", *argv])

        query_memory.main()
        return captured.get("args")

    def test_get_relationships_routing(self, monkeypatch):
        """get-relationships parses db_path, database, limit and scope args."""
        args = self._route(
            monkeypatch,
            [
                "get-relationships",
                "/db/path",
                "memory.db",
                "--limit",
                "5",
                "--project-dir",
                "/proj",
            ],
            "get-relationships",
        )

        assert args is not None
        assert args.command == "get-relationships"
        assert args.db_path == "/db/path"
        assert args.database == "memory.db"
        assert args.limit == 5
        assert args.project_dir == "/proj"

    def test_delete_memory_routing(self, monkeypatch):
        """delete-memory parses required --uuid and --kind."""
        args = self._route(
            monkeypatch,
            [
                "delete-memory",
                "/db/path",
                "memory.db",
                "--uuid",
                "abc-123",
                "--kind",
                "episodic",
                "--project-dir",
                "/proj",
            ],
            "delete-memory",
        )

        assert args is not None
        assert args.command == "delete-memory"
        assert args.db_path == "/db/path"
        assert args.database == "memory.db"
        assert args.uuid == "abc-123"
        assert args.kind == "episodic"
        assert args.project_dir == "/proj"

    def test_update_memory_routing(self, monkeypatch):
        """update-memory parses --uuid, --kind, --content and --name."""
        args = self._route(
            monkeypatch,
            [
                "update-memory",
                "/db/path",
                "memory.db",
                "--uuid",
                "def-456",
                "--kind",
                "entity",
                "--summary",
                "new summary",
                "--name",
                "new name",
                "--project-dir",
                "/proj",
            ],
            "update-memory",
        )

        assert args is not None
        assert args.command == "update-memory"
        assert args.uuid == "def-456"
        assert args.kind == "entity"
        assert args.summary == "new summary"
        assert args.name == "new name"
        assert args.project_dir == "/proj"

    def test_delete_memory_rejects_invalid_kind(self, monkeypatch):
        """argparse enforces the kind choices (episodic|entity)."""
        monkeypatch.setattr(
            sys,
            "argv",
            [
                "query_memory.py",
                "delete-memory",
                "/db",
                "memory.db",
                "--uuid",
                "x",
                "--kind",
                "bogus",
            ],
        )

        with pytest.raises(SystemExit):
            query_memory.main()


# =============================================================================
# Graceful JSON output when database / tables are absent
# =============================================================================


class TestGracefulDatabaseAbsent:
    """Test handlers emit JSON (not crashes) when the DB is missing."""

    def test_get_relationships_missing_db(self, tmp_path, force_backend, capsys):
        """Missing/unconnectable DB returns an empty relationship list."""
        args = argparse.Namespace(
            db_path=str(tmp_path),
            database="does_not_exist.db",
            limit=20,
            group_id=None,
            project_dir=None,
        )

        payload, code = run_handler(query_memory.cmd_get_relationships, args, capsys)

        assert code == 0
        assert payload["success"] is True
        assert payload["data"] == {"relationships": [], "count": 0}

    def test_delete_memory_missing_db(self, tmp_path, force_backend, capsys):
        """Deleting from a missing DB reports deleted=False, not an error."""
        args = argparse.Namespace(
            db_path=str(tmp_path),
            database="does_not_exist.db",
            uuid="node-1",
            kind="episodic",
        )

        payload, code = run_handler(query_memory.cmd_delete_memory, args, capsys)

        assert code == 0
        assert payload["success"] is True
        assert payload["data"] == {"deleted": False, "id": "node-1"}

    def test_update_memory_missing_db(self, tmp_path, force_backend, capsys):
        """Updating in a missing DB reports updated=False, not an error."""
        args = argparse.Namespace(
            db_path=str(tmp_path),
            database="does_not_exist.db",
            uuid="node-2",
            kind="episodic",
            content="new content",
            summary=None,
            name=None,
        )

        payload, code = run_handler(query_memory.cmd_update_memory, args, capsys)

        assert code == 0
        assert payload["success"] is True
        assert payload["data"] == {"updated": False, "id": "node-2"}

    def test_delete_memory_invalid_kind(self, tmp_path, force_backend, capsys):
        """An invalid kind reaching the handler yields a JSON error."""
        args = argparse.Namespace(
            db_path=str(tmp_path),
            database="does_not_exist.db",
            uuid="node-3",
            kind="not-a-kind",
        )

        payload, code = run_handler(query_memory.cmd_delete_memory, args, capsys)

        assert code == 1
        assert payload["success"] is False
        assert "error" in payload

    def test_update_memory_nothing_to_update(self, tmp_path, force_backend, capsys):
        """No content/summary/name provided yields a JSON error."""
        args = argparse.Namespace(
            db_path=str(tmp_path),
            database="does_not_exist.db",
            uuid="node-4",
            kind="episodic",
            content=None,
            summary=None,
            name=None,
        )

        payload, code = run_handler(query_memory.cmd_update_memory, args, capsys)

        assert code == 1
        assert payload["success"] is False
        assert "error" in payload

    def test_get_relationships_no_backend(self, tmp_path, monkeypatch, capsys):
        """Without a kuzu/LadybugDB backend a JSON error is emitted."""
        monkeypatch.setattr(query_memory, "apply_monkeypatch", lambda: None)
        args = argparse.Namespace(
            db_path=str(tmp_path),
            database="does_not_exist.db",
            limit=20,
            group_id=None,
            project_dir=None,
        )

        payload, code = run_handler(query_memory.cmd_get_relationships, args, capsys)

        assert code == 1
        assert payload["success"] is False
        assert "error" in payload
