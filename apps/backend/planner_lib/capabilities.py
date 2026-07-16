"""Group planned file changes into observable capability slices."""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import PurePosixPath


@dataclass
class CapabilityGroup:
    """A stable, generator-ready group of related file changes."""

    key: str
    label: str
    description: str
    files: list[dict]


@dataclass
class _WorkingGroup:
    key: str
    label: str
    description: str
    indexed_files: list[tuple[int, dict]]


_CAPABILITIES = {
    "connection-settings": (
        "Connection & Settings",
        "Deliver provider configuration, credentials, and connection settings.",
    ),
    "repositories": (
        "Repository Operations",
        "Deliver repository discovery, selection, and repository-level behavior.",
    ),
    "pull-requests": (
        "Pull Request & Review",
        "Deliver pull request retrieval, review, and related user flows.",
    ),
    "work-items": (
        "Work Items",
        "Deliver issue, ticket, and work-item behavior across the stack.",
    ),
    "pipelines": (
        "Pipelines & Builds",
        "Deliver pipeline, build, and job behavior across the stack.",
    ),
    "configuration-auth": (
        "Configuration & Authentication",
        "Configure the capability and its authentication or credentials.",
    ),
    "data": (
        "Data Layer",
        "Implement the capability's data model, persistence, and state.",
    ),
    "api-service": (
        "API & Service",
        "Expose the capability through APIs, clients, and service logic.",
    ),
    "automation-review": (
        "Automation & Review",
        "Implement automated workflows, runners, and review behavior.",
    ),
    "ui": (
        "User Interface",
        "Deliver the capability's user-facing interface and interactions.",
    ),
    "verification": (
        "Verification",
        "Verify the capability where no closer implementation slice applies.",
    ),
    "core": (
        "Core Implementation",
        "Implement shared domain and core capability behavior.",
    ),
    "integration": (
        "Integration",
        "Wire shared registries and cross-capability entry points together.",
    ),
}

_CONFIG_AUTH_TERMS = {
    "auth",
    "authentication",
    "authorize",
    "authorization",
    "config",
    "configuration",
    "credential",
    "credentials",
    "env",
    "login",
    "oauth",
    "preference",
    "preferences",
    "secret",
    "secrets",
    "setting",
    "settings",
    "token",
    "tokens",
}
_DATA_TERMS = {
    "database",
    "db",
    "entity",
    "entities",
    "migration",
    "migrations",
    "model",
    "models",
    "persistence",
    "record",
    "records",
    "repository",
    "repositories",
    "schema",
    "schemas",
    "store",
    "stores",
}
_AUTOMATION_REVIEW_TERMS = {
    "agent",
    "agents",
    "automation",
    "bot",
    "bots",
    "build",
    "ci",
    "job",
    "jobs",
    "pipeline",
    "pipelines",
    "pr",
    "pullrequest",
    "review",
    "reviewer",
    "reviews",
    "runner",
    "runners",
    "workflow",
    "workflows",
}
_API_SERVICE_TERMS = {
    "api",
    "client",
    "clients",
    "controller",
    "controllers",
    "endpoint",
    "endpoints",
    "gateway",
    "handler",
    "handlers",
    "request",
    "requests",
    "response",
    "responses",
    "route",
    "service",
    "services",
    "webhook",
    "webhooks",
}
_UI_TERMS = {
    "component",
    "components",
    "dialog",
    "dialogs",
    "form",
    "forms",
    "frontend",
    "hook",
    "hooks",
    "modal",
    "modals",
    "page",
    "pages",
    "screen",
    "screens",
    "style",
    "styles",
    "ui",
    "view",
    "views",
    "widget",
    "widgets",
}
_VERIFICATION_TERMS = {
    "e2e",
    "fixture",
    "fixtures",
    "integrationtest",
    "mock",
    "mocks",
    "pytest",
    "spec",
    "specs",
    "test",
    "tests",
    "verification",
}

_OUTCOME_TERMS = (
    (
        "connection-settings",
        _CONFIG_AUTH_TERMS | {"connect", "connection", "connections"},
    ),
    (
        "pull-requests",
        {"pullrequest", "pullrequests", "review", "reviewer", "reviews", "pr"},
    ),
    (
        "work-items",
        {"issue", "issues", "ticket", "tickets", "workitem", "workitems"},
    ),
    (
        "pipelines",
        {"build", "builds", "job", "jobs", "pipeline", "pipelines"},
    ),
    (
        "repositories",
        {"repo", "repos", "repository", "repositories", "sourcepicker"},
    ),
)


def group_files_into_capabilities(
    files: list[dict], max_slices: int
) -> list[CapabilityGroup]:
    """Group files by capability while preserving input objects and stable order.

    Shared registries are kept in a final integration group. When the initial
    capability set is larger than ``max_slices``, the smallest non-integration
    groups are coalesced deterministically.
    """

    if max_slices < 1:
        raise ValueError("max_slices must be at least 1")
    if not files:
        return []

    groups_by_key: dict[str, _WorkingGroup] = {}
    integration_files: list[tuple[int, dict]] = []

    for index, file_info in enumerate(files):
        path = str(file_info.get("path", ""))
        if _is_shared_registry(path):
            integration_files.append((index, file_info))
            continue

        key = _classify_file(file_info)
        if key not in groups_by_key:
            label, description = _CAPABILITIES[key]
            groups_by_key[key] = _WorkingGroup(key, label, description, [])
        groups_by_key[key].indexed_files.append((index, file_info))

    groups = list(groups_by_key.values())
    if integration_files and max_slices == 1:
        all_files = sorted(
            [indexed_file for group in groups for indexed_file in group.indexed_files]
            + integration_files,
            key=lambda item: item[0],
        )
        label, description = _CAPABILITIES["integration"]
        return [
            CapabilityGroup(
                key="integration",
                label=label,
                description=description,
                files=[file_info for _, file_info in all_files],
            )
        ]

    non_integration_limit = max_slices - bool(integration_files)
    groups = _coalesce_groups(groups, non_integration_limit)
    groups.sort(key=_first_file_index)

    result = [_to_capability_group(group) for group in groups]
    if integration_files:
        label, description = _CAPABILITIES["integration"]
        result.append(
            CapabilityGroup(
                key="integration",
                label=label,
                description=description,
                files=[file_info for _, file_info in integration_files],
            )
        )
    return result


def is_shared_registry_path(path: str) -> bool:
    """Return whether a path is a shared integration registry."""
    return _is_shared_registry(path)


def _classify_file(file_info: dict) -> str:
    path = str(file_info.get("path", ""))
    reason = str(file_info.get("reason", ""))
    is_test = _is_test_file(path)
    tokens = _tokens(f"{path} {reason}", strip_test_terms=is_test)

    key = _classify_tokens(tokens)
    if is_test and key == "core":
        return "verification"
    return key


def _classify_tokens(tokens: set[str]) -> str:
    for key, outcome_terms in _OUTCOME_TERMS:
        if tokens & outcome_terms:
            return key
    if tokens & _CONFIG_AUTH_TERMS:
        return "configuration-auth"
    if tokens & _DATA_TERMS:
        return "data"
    if tokens & _AUTOMATION_REVIEW_TERMS:
        return "automation-review"
    if tokens & _API_SERVICE_TERMS:
        return "api-service"
    if tokens & _UI_TERMS:
        return "ui"
    if tokens & _VERIFICATION_TERMS:
        return "verification"
    return "core"


def _tokens(value: str, *, strip_test_terms: bool = False) -> set[str]:
    value = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", value)
    tokens = set(re.findall(r"[a-z0-9]+", value.lower()))
    if strip_test_terms:
        tokens -= _VERIFICATION_TERMS
    return tokens


def _is_test_file(path: str) -> bool:
    normalized = path.replace("\\", "/").lower()
    parts = PurePosixPath(normalized).parts
    name = parts[-1] if parts else ""
    stem = name.rsplit(".", 1)[0]
    return (
        any(part in {"test", "tests", "__tests__"} for part in parts[:-1])
        or stem.startswith("test_")
        or stem.endswith("_test")
        or ".test." in name
        or ".spec." in name
    )


def _is_shared_registry(path: str) -> bool:
    normalized = path.replace("\\", "/").lower()
    parts = PurePosixPath(normalized).parts
    if not parts:
        return False

    name = parts[-1]
    stem = name.rsplit(".", 1)[0]
    parent_parts = set(parts[:-1])

    if stem == "index":
        return bool(
            len(parts) <= 2
            or {"ipc", "preload", "shared", "navigation", "i18n", "routes"}
            & parent_parts
        )
    if stem in {
        "i18n",
        "navigation",
        "navigator",
        "preload",
        "router",
        "routes",
    }:
        return True
    if "registry" in stem and (
        {"ipc", "preload", "i18n", "navigation", "routes"} & parent_parts
        or any(
            term in stem for term in ("ipc", "preload", "i18n", "navigation", "route")
        )
    ):
        return True
    return bool(
        ("ipc" in parent_parts or stem.startswith("ipc"))
        and any(term in stem for term in ("index", "registry", "router"))
    )


def _coalesce_groups(groups: list[_WorkingGroup], limit: int) -> list[_WorkingGroup]:
    groups = list(groups)
    while len(groups) > limit:
        ranked = sorted(
            enumerate(groups),
            key=lambda item: (
                len(item[1].indexed_files),
                _first_file_index(item[1]),
            ),
        )
        first_index, first = ranked[0]
        second_index, second = ranked[1]
        merged = _merge_groups(first, second)

        for index in sorted((first_index, second_index), reverse=True):
            groups.pop(index)
        groups.append(merged)
    return groups


def _merge_groups(first: _WorkingGroup, second: _WorkingGroup) -> _WorkingGroup:
    ordered = sorted((first, second), key=_first_file_index)
    return _WorkingGroup(
        key="+".join(group.key for group in ordered),
        label=" & ".join(group.label for group in ordered),
        description=" ".join(group.description for group in ordered),
        indexed_files=sorted(
            first.indexed_files + second.indexed_files,
            key=lambda item: item[0],
        ),
    )


def _first_file_index(group: _WorkingGroup) -> int:
    return min(index for index, _ in group.indexed_files)


def _to_capability_group(group: _WorkingGroup) -> CapabilityGroup:
    return CapabilityGroup(
        key=group.key,
        label=group.label,
        description=group.description,
        files=[file_info for _, file_info in group.indexed_files],
    )
