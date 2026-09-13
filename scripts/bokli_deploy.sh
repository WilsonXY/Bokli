#!/usr/bin/env bash
# ==============================================================================
# Bokli Production Release-Tag Deploy Flow
#
# Usage:
#   ./scripts/bokli_deploy.sh <tag>   (e.g. ./scripts/bokli_deploy.sh v1.0.0)
#
# Safety & Refusal Gates:
#   1. Argument required: must supply a release tag name.
#   2. Fetches origin (git fetch origin).
#   3. Refuses if the tag does not exist locally after fetch.
#   4. Refuses unless git rev-parse $TAG^{commit} == git rev-parse origin/main.
#   5. Refuses if the working tree is dirty (git status --porcelain is non-empty).
#
# Deploy Actions:
#   - Check out tag
#   - BOKLI_BUILD_DIR=.next-prod npm run build (skippable with BOKLI_DEPLOY_SKIP_BUILD=1)
#   - systemctl --user restart bokli (skippable with BOKLI_DEPLOY_SKIP_RESTART=1)
#   - Health check: curl -s -o /dev/null -w "%{http_code}" http://localhost:5000/login
#     (stubbed via BOKLI_DEPLOY_HEALTHCHECK_CMD; sleep skippable via BOKLI_DEPLOY_SKIP_SLEEP=1)
#
# Rollback:
#   To roll back, deploy the previous known-good tag. Note: SQLite migrations
#   only move forward; application code must remain backwards compatible.
# ==============================================================================

set -eo pipefail

if [ $# -lt 1 ] || [ -z "${1:-}" ]; then
  echo "Usage: $0 <tag> (e.g. $0 v1.0.0)" >&2
  exit 1
fi

TAG="$1"

# Resolve repo root directory relative to script location
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${BOKLI_REPO_DIR:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
cd "$REPO_ROOT"

# Fetch latest refs from origin
if [ "${BOKLI_DEPLOY_SKIP_FETCH:-0}" = "1" ]; then
  echo "ℹ️  Skipping git fetch (BOKLI_DEPLOY_SKIP_FETCH=1)"
else
  echo "==> Fetching origin..."
  git fetch origin
fi

# Gate 1: Check tag exists locally after fetch
if ! TAG_COMMIT=$(git rev-parse --verify "refs/tags/${TAG}^{commit}" 2>/dev/null); then
  echo "❌ Refusing deploy: tag '$TAG' does not exist locally after fetch." >&2
  exit 1
fi

# Gate 2: Check origin/main resolves
if ! MAIN_COMMIT=$(git rev-parse --verify "origin/main^{commit}" 2>/dev/null); then
  echo "❌ Refusing deploy: origin/main ref does not exist or cannot be resolved." >&2
  exit 1
fi

# Gate 3: Check tag matches origin/main tip
if [ "$TAG_COMMIT" != "$MAIN_COMMIT" ]; then
  echo "❌ Refusing deploy: tag '$TAG' commit ($TAG_COMMIT) does not match origin/main ($MAIN_COMMIT)." >&2
  echo "    Bokli deploy requires the release tag to point to the current tip of origin/main." >&2
  exit 1
fi

# Gate 4: Check working tree is clean
DIRTY_STATUS=$(git status --porcelain)
if [ -n "$DIRTY_STATUS" ]; then
  echo "❌ Refusing deploy: working tree is dirty. Deploy requires a clean working tree." >&2
  echo "Dirty files:" >&2
  echo "$DIRTY_STATUS" >&2
  exit 1
fi

# Checkout the validated tag
echo "==> Checking out $TAG..."
git checkout "$TAG"

# Build production artifacts
if [ "${BOKLI_DEPLOY_SKIP_BUILD:-0}" = "1" ]; then
  echo "ℹ️  Skipping build (BOKLI_DEPLOY_SKIP_BUILD=1)"
else
  echo "==> Building production release..."
  BOKLI_BUILD_DIR=.next-prod npm run build
fi

# Restart systemd user service
if [ "${BOKLI_DEPLOY_SKIP_RESTART:-0}" = "1" ]; then
  echo "ℹ️  Skipping restart (BOKLI_DEPLOY_SKIP_RESTART=1)"
else
  echo "==> Restarting bokli service..."
  systemctl --user restart bokli
fi

# Health check
echo "==> Running health check on /login..."
if [ "${BOKLI_DEPLOY_SKIP_SLEEP:-0}" != "1" ]; then
  sleep 3
fi

if [ -n "${BOKLI_DEPLOY_HEALTHCHECK_CMD:-}" ]; then
  HTTP_CODE=$(eval "$BOKLI_DEPLOY_HEALTHCHECK_CMD" 2>/dev/null || true)
else
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5000/login 2>/dev/null || true)
fi

if [ "$HTTP_CODE" = "200" ]; then
  echo "✅ deployed $TAG, /login returns 200"
else
  echo "❌ FAIL: deployed $TAG, but /login returned HTTP $HTTP_CODE (expected 200)." >&2
  echo "Hint: check service logs with 'journalctl --user -u bokli' or 'journalctl --user -u bokli -n 50 --no-pager'." >&2
  exit 1
fi
