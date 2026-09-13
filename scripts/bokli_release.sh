#!/usr/bin/env bash
# ==============================================================================
# Bokli Release Helper
#
# Usage:
#   ./scripts/bokli_release.sh <tag> <message>
#   e.g. ./scripts/bokli_release.sh v1.2.0 "Release v1.2.0"
#
# Steps:
#   1. Validates tag does not already exist locally.
#   2. Fetches origin (--tags --prune).
#   3. Resolves current tip of origin/main.
#   4. Creates an annotated tag on origin/main.
#   5. Pushes the tag to origin. If push fails, outputs the manual command.
#   6. Creates GitHub release via gh CLI (gh release create <tag> --generate-notes).
#
# Release-Tag Deployment Flow:
#   Merge PR -> Tag & Push Release -> Deploy via scripts/bokli_deploy.sh <tag>
#   Rollback = redeploy previous tag with --allow-rollback (DB migrations only move forward).
# ==============================================================================

set -euo pipefail

if [ $# -lt 2 ] || [ -z "${1:-}" ] || [ -z "${2:-}" ]; then
  echo "Usage: $0 <tag> <message> (e.g. $0 v1.2.0 \"Release v1.2.0\")" >&2
  exit 1
fi

TAG="$1"
MESSAGE="$2"

# Resolve repo root directory relative to script location
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${BOKLI_REPO_DIR:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
cd "$REPO_ROOT"

# Pre-check: Refuse if tag already exists locally
if git rev-parse --verify "refs/tags/${TAG}" >/dev/null 2>&1; then
  echo "❌ Refusing release: tag '$TAG' already exists locally." >&2
  exit 1
fi

# Fetch latest origin refs and tags
if [ "${BOKLI_RELEASE_SKIP_FETCH:-0}" = "1" ]; then
  echo "ℹ️  Skipping git fetch (BOKLI_RELEASE_SKIP_FETCH=1)"
else
  echo "==> Fetching origin (--tags --prune)..."
  git fetch origin --tags --prune
fi

# Re-check tag after fetch in case remote had it
if git rev-parse --verify "refs/tags/${TAG}" >/dev/null 2>&1; then
  echo "❌ Refusing release: tag '$TAG' already exists locally after fetch." >&2
  exit 1
fi

# Resolve current tip of origin/main
if ! MAIN_COMMIT=$(git rev-parse --verify "origin/main^{commit}" 2>/dev/null); then
  echo "❌ Error: origin/main ref does not exist or cannot be resolved." >&2
  exit 1
fi

echo "==> Creating annotated tag '$TAG' on origin/main ($MAIN_COMMIT)..."
git tag -a "$TAG" "$MAIN_COMMIT" -m "$MESSAGE"

if [ "${BOKLI_RELEASE_DRY_RUN:-0}" = "1" ]; then
  echo "ℹ️  Dry run active (BOKLI_RELEASE_DRY_RUN=1). Skipping push and gh release create."
  echo "    Would run: git push origin $TAG"
  echo "    Would run: gh release create $TAG --generate-notes"
  exit 0
fi

# Push tag to origin
echo "==> Pushing tag '$TAG' to origin..."
if ! git push origin "$TAG"; then
  echo "❌ Error: Failed to push tag '$TAG' to origin." >&2
  echo "Please push the tag manually by running:" >&2
  echo "  git push origin $TAG" >&2
  exit 1
fi

# Locate gh CLI
GH_BIN="${GH_BIN:-$HOME/.local/bin/gh}"
if [ ! -x "$GH_BIN" ]; then
  if command -v gh >/dev/null 2>&1; then
    GH_BIN="$(command -v gh)"
  else
    echo "❌ Error: 'gh' CLI not found at $GH_BIN or in PATH." >&2
    exit 1
  fi
fi

# Create GitHub release
echo "==> Creating GitHub release with generated release notes..."
"$GH_BIN" release create "$TAG" --generate-notes

echo "✅ Release '$TAG' created and pushed successfully."
