# Tarkeeba release runbook

This fork publishes independently from upstream. The current release candidate is `2.8.0-beta.1`.

## Release topology

- `develop` is the integration and beta branch.
- `main` is the stable release branch. It still needs to be created on the fork before the first stable release.
- `.github/workflows/beta-release.yml` builds a manually requested prerelease from `develop`.
- `.github/workflows/prepare-release.yml` watches version changes merged to `main`, validates the changelog, and creates a tag.
- `.github/workflows/release.yml` builds and publishes a stable tag for macOS, Windows, and Linux.

The updater, package metadata, documentation, and release workflows target the standalone `mohamedjanemr/tarkeeba` repository.

## One-time GitHub preparation

1. Confirm Actions has read/write workflow permissions under **Settings → Actions → General**.
2. Create `main` from the tested `develop` commit, then make it the protected stable branch.
3. Add these repository secrets:

| Secret | Required for | Notes |
|---|---|---|
| `PAT_TOKEN` | stable automation | Fine-grained token scoped to this repository with Contents read/write permission |
| `MAC_CERTIFICATE` | signed macOS builds | Base64-encoded Developer ID Application `.p12` |
| `MAC_CERTIFICATE_PASSWORD` | signed macOS builds | Password for the `.p12` |
| `APPLE_ID` | notarization | Apple developer account email |
| `APPLE_APP_SPECIFIC_PASSWORD` | notarization | App-specific password, not the Apple ID password |
| `APPLE_TEAM_ID` | notarization | Apple Developer team identifier |

Windows signing is optional for a beta, but strongly recommended before stable distribution. When available, add `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `AZURE_SIGNING_ACCOUNT`, and `AZURE_CERTIFICATE_PROFILE`.

`SENTRY_DSN`, `SENTRY_TRACES_SAMPLE_RATE`, and `SENTRY_PROFILES_SAMPLE_RATE` are optional.

Never commit certificates, passwords, tokens, `.env` files, or signing material.

## First beta

Run the complete local checks first, then push the release commit to `develop`.

```bash
git status --short
npm run build
npm test
npm run test:backend
```

Run a non-publishing CI rehearsal:

```bash
gh workflow run beta-release.yml \
  --repo mohamedjanemr/tarkeeba \
  --ref develop \
  -f version=2.8.0-beta.1 \
  -f dry_run=true
```

After every platform succeeds, publish the beta:

```bash
gh workflow run beta-release.yml \
  --repo mohamedjanemr/tarkeeba \
  --ref develop \
  -f version=2.8.0-beta.1 \
  -f dry_run=false
```

Verify the release assets, SHA256 checksums, macOS signature/notarization, Windows signature status, fresh install, upgrade from Auto-Claude, provider switching, account switching, and one real task with each provider.

## First stable

1. Finish beta validation and fix release blockers.
2. Run `node scripts/bump-version.js 2.8.0` to change all package/backend versions.
3. Add a `## 2.8.0` changelog entry.
4. Merge `develop` into `main` through a release PR.
5. Watch **Prepare Release**, then **Release**, and verify every asset before announcing it.

Do not reuse a failed or partially published version number. Cut the next beta or patch version instead.

## Compatibility policy for 2.8

- The visible application, app ID, installers, and update feed use Tarkeeba.
- Production explicitly keeps the legacy `auto-claude-ui` user-data directory so existing installed settings and account profiles continue to load.
- The updater cache uses the new `tarkeeba-updater` key so pending upstream updates cannot collide with Tarkeeba.
- Existing `.auto-claude/` project data and `auto-claude/*` task branches remain supported.
- Internal compatibility identifiers can be migrated only in a later release with an explicit data migration and rollback path.

## Fork and license obligations

Tarkeeba remains AGPL-3.0. Preserve the license, copyright notices, source availability, and upstream contributor history in distributed versions. The product must not imply affiliation with Anthropic, OpenAI, or the upstream Aperant maintainers.
