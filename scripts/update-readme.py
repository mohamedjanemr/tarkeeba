#!/usr/bin/env python3
"""Update Tarkeeba release badges and download links in README.md."""

import argparse
import os
import re
import sys

SEMVER_PATTERN = re.compile(r"^\d+\.\d+\.\d+(-[a-zA-Z]+\.\d+)?$")
PRODUCT_NAME = os.environ.get("TARKEEBA_PRODUCT_NAME", "Tarkeeba")
REPOSITORY = os.environ.get("GITHUB_REPOSITORY", "mohamedjanemr/tarkeeba")


def replace_marked_section(text: str, marker: str, content: str) -> str:
    start = f"<!-- {marker} -->"
    end = f"<!-- {marker}_END -->"
    pattern = re.compile(f"({re.escape(start)}).*?({re.escape(end)})", re.DOTALL)
    if not pattern.search(text):
        raise ValueError(f"README marker pair not found: {marker}")
    return pattern.sub(f"\\1\n{content.rstrip()}\n\\2", text)


def badge(version: str, prerelease: bool) -> str:
    channel = "Beta" if prerelease else "Stable"
    label = channel.lower()
    color = "orange" if prerelease else "blue"
    badge_version = version.replace("-", "--")
    release = f"https://github.com/{REPOSITORY}/releases/tag/v{version}"
    return f"[![{channel}](https://img.shields.io/badge/{label}-{badge_version}-{color}?style=flat-square)]({release})"


def downloads(version: str) -> str:
    base = f"https://github.com/{REPOSITORY}/releases/download/v{version}"
    assets = [
        ("Windows", f"{PRODUCT_NAME}-{version}-win32-x64.exe"),
        ("macOS (Apple Silicon)", f"{PRODUCT_NAME}-{version}-darwin-arm64.dmg"),
        ("macOS (Intel)", f"{PRODUCT_NAME}-{version}-darwin-x64.dmg"),
        ("Linux", f"{PRODUCT_NAME}-{version}-linux-x86_64.AppImage"),
        ("Linux (Debian)", f"{PRODUCT_NAME}-{version}-linux-amd64.deb"),
        ("Linux (Flatpak)", f"{PRODUCT_NAME}-{version}-linux-x86_64.flatpak"),
    ]
    rows = ["| Platform | Download |", "|----------|----------|"]
    rows.extend(f"| **{platform}** | [{asset}]({base}/{asset}) |" for platform, asset in assets)
    return "\n".join(rows)


def update_readme(version: str, prerelease: bool) -> bool:
    with open("README.md", encoding="utf-8") as file:
        original = file.read()

    prefix = "BETA" if prerelease else "STABLE"
    content = replace_marked_section(original, f"{prefix}_VERSION_BADGE", badge(version, prerelease))
    content = replace_marked_section(content, f"{prefix}_DOWNLOADS", downloads(version))

    if content == original:
        return False
    with open("README.md", "w", encoding="utf-8") as file:
        file.write(content)
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("version")
    parser.add_argument("--prerelease", action="store_true")
    args = parser.parse_args()

    if not SEMVER_PATTERN.fullmatch(args.version):
        parser.error("version must be X.Y.Z or X.Y.Z-prerelease.N")

    try:
        changed = update_readme(args.version, args.prerelease or "-" in args.version)
    except (OSError, ValueError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1) from error
    print(f"README.md {'updated' if changed else 'already current'} for {args.version}")


if __name__ == "__main__":
    main()
