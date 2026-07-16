"""Tests for planner context file-shape normalization."""

import json

from planner_lib.context import ContextLoader, normalize_file_entries


def test_normalizes_service_keyed_file_context():
    value = {
        "backend": [
            "apps/backend/client.py",
            {"path": "apps/backend/models.py", "reason": "Provider model"},
        ],
        "frontend": "apps/frontend/ProviderForm.tsx",
    }

    assert normalize_file_entries(value) == [
        {"path": "apps/backend/client.py", "service": "backend"},
        {
            "service": "backend",
            "path": "apps/backend/models.py",
            "reason": "Provider model",
        },
        {"path": "apps/frontend/ProviderForm.tsx", "service": "frontend"},
    ]


def test_normalizes_mixed_list_context_without_losing_records():
    record = {"path": "src/provider.py", "service": "backend"}

    normalized = normalize_file_entries([record, "tests/test_provider.py"])

    assert normalized == [
        record,
        {"path": "tests/test_provider.py"},
    ]
    assert normalized[0] is not record


def test_context_loader_preserves_create_file_ownership(tmp_path):
    (tmp_path / "spec.md").write_text(
        "## Workflow Type\nFeature\n",
        encoding="utf-8",
    )
    (tmp_path / "context.json").write_text(
        json.dumps(
            {
                "files_to_modify": {"backend": ["apps/backend/client.py"]},
                "files_to_create": {"frontend": ["apps/frontend/AzureSettings.tsx"]},
            }
        ),
        encoding="utf-8",
    )

    context = ContextLoader(tmp_path).load_context()

    assert context.files_to_modify == [
        {"path": "apps/backend/client.py", "service": "backend"}
    ]
    assert context.files_to_create == [
        {
            "path": "apps/frontend/AzureSettings.tsx",
            "service": "frontend",
        }
    ]
    assert context.services_involved == ["backend", "frontend"]
