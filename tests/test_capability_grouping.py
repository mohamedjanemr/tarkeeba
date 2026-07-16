"""Tests for capability-oriented file grouping."""

import pytest
from planner_lib.capabilities import group_files_into_capabilities


def _group_by_key(files: list[dict], max_slices: int = 8):
    return {
        group.key: group for group in group_files_into_capabilities(files, max_slices)
    }


def test_groups_cross_service_files_by_observable_capability():
    files = [
        {"path": "apps/backend/auth/azure_credentials.py"},
        {"path": "apps/frontend/settings/AzureDevOpsForm.tsx"},
        {"path": "apps/backend/services/azure_client.py"},
        {"path": "apps/frontend/api/azure-client.ts"},
        {"path": "apps/backend/runners/azure_review.py"},
    ]

    groups = _group_by_key(files)

    assert [item["path"] for item in groups["connection-settings"].files] == [
        "apps/backend/auth/azure_credentials.py",
        "apps/frontend/settings/AzureDevOpsForm.tsx",
    ]
    assert [item["path"] for item in groups["api-service"].files] == [
        "apps/backend/services/azure_client.py",
        "apps/frontend/api/azure-client.ts",
    ]
    assert [item["path"] for item in groups["pull-requests"].files] == [
        "apps/backend/runners/azure_review.py"
    ]


def test_covers_data_ui_verification_and_core_capabilities():
    files = [
        {"path": "apps/backend/models/provider.py"},
        {"path": "apps/frontend/components/ProviderCard.tsx"},
        {"path": "tests/test_smoke.py"},
        {"path": "apps/backend/domain/provider.py"},
    ]

    groups = _group_by_key(files)

    assert [group for group in groups] == ["data", "ui", "verification", "core"]
    assert all(group.label and group.description for group in groups.values())


def test_attaches_tests_to_matching_capability_when_possible():
    files = [
        {"path": "apps/backend/auth/token.py"},
        {"path": "tests/test_auth_token.py"},
        {"path": "apps/backend/services/provider.py"},
        {"path": "tests/services/provider_service.test.ts"},
        {"path": "tests/test_smoke.py"},
    ]

    groups = _group_by_key(files)

    assert [item["path"] for item in groups["connection-settings"].files] == [
        "apps/backend/auth/token.py",
        "tests/test_auth_token.py",
    ]
    assert [item["path"] for item in groups["api-service"].files] == [
        "apps/backend/services/provider.py",
        "tests/services/provider_service.test.ts",
    ]
    assert [item["path"] for item in groups["verification"].files] == [
        "tests/test_smoke.py"
    ]


def test_places_shared_registries_in_final_integration_group():
    files = [
        {"path": "apps/backend/services/provider.py"},
        {"path": "apps/frontend/ipc/provider-handler.ts"},
        {"path": "apps/frontend/ipc/index.ts"},
        {"path": "apps/frontend/preload.ts"},
        {"path": "apps/frontend/navigation.ts"},
        {"path": "apps/frontend/i18n.ts"},
        {"path": "apps/backend/routes.py"},
    ]

    groups = group_files_into_capabilities(files, max_slices=8)

    assert groups[-1].key == "integration"
    assert [item["path"] for item in groups[-1].files] == [
        "apps/frontend/ipc/index.ts",
        "apps/frontend/preload.ts",
        "apps/frontend/navigation.ts",
        "apps/frontend/i18n.ts",
        "apps/backend/routes.py",
    ]
    assert groups[0].files[0] is files[0]
    assert groups[0].files[1] is files[1]


def test_coalesces_smallest_groups_deterministically_to_slice_limit():
    files = [
        {"path": "src/auth/token.py"},
        {"path": "src/models/provider.py"},
        {"path": "src/services/provider.py"},
        {"path": "src/review/runner.py"},
        {"path": "src/ui/ProviderPage.tsx"},
        {"path": "tests/test_smoke.py"},
        {"path": "src/domain/provider.py"},
        {"path": "src/index.ts"},
    ]

    first = group_files_into_capabilities(files, max_slices=4)
    second = group_files_into_capabilities(files, max_slices=4)

    assert len(first) == 4
    assert [group.key for group in first] == [group.key for group in second]
    assert first[-1].key == "integration"
    grouped_files = [item for group in first for item in group.files]
    assert sorted(map(id, grouped_files)) == sorted(map(id, files))
    original_positions = {id(item): index for index, item in enumerate(files)}
    assert all(
        [original_positions[id(item)] for item in group.files]
        == sorted(original_positions[id(item)] for item in group.files)
        for group in first
    )


def test_single_slice_budget_serializes_integration_with_all_files():
    files = [
        {"path": "src/services/provider.py"},
        {"path": "src/index.ts"},
    ]

    groups = group_files_into_capabilities(files, max_slices=1)

    assert len(groups) == 1
    assert groups[0].key == "integration"
    assert groups[0].files == files


def test_local_module_index_is_not_treated_as_shared_registry():
    files = [
        {"path": "src/features/provider/index.ts"},
        {"path": "src/features/provider/client.ts"},
    ]

    groups = group_files_into_capabilities(files, max_slices=4)

    assert all(group.key != "integration" for group in groups)


def test_handles_empty_files_and_rejects_invalid_limit():
    assert group_files_into_capabilities([], max_slices=1) == []

    with pytest.raises(ValueError, match="at least 1"):
        group_files_into_capabilities([], max_slices=0)
