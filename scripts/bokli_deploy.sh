#!/usr/bin/env bash
# ==============================================================================
# Bokli Production Release-Tag Deploy Flow
#
# Usage:
#   ./scripts/bokli_deploy.sh [--allow-rollback] <tag>
#   e.g. ./scripts/bokli_deploy.sh v1.0.0
#        ./scripts/bokli_deploy.sh --allow-rollback v0.9.0
#
# Safety & Refusal Gates:
#   1. Argument required: must supply a release tag name.
#   2. Tag format validation: must match ^[A-Za-z0-9._-]+$
#   3. Fetches origin (git fetch origin --tags --prune).
#   4. Refuses if the tag does not exist locally after fetch.
#   5. Tip equality or rollback ancestor check:
#      - By default, tag commit must equal origin/main tip.
#      - If --allow-rollback is specified, tag commit may differ from origin/main
#        tip, but MUST be a direct ancestor of origin/main (git merge-base --is-ancestor).
#   6. Refuses if tracked files are modified (git status --porcelain --untracked-files=no).
#   7. Single-deploy lock: holds an exclusive flock on <repo>/.deploy.lock for the
#      whole run and refuses to start if another deploy already holds it.
#   8. BOKLI_DEPLOY_BUILD_CMD (build override) is refused unless BOKLI_DEPLOY_TEST_MODE=1.
#
# Deploy Actions:
#   - Check out tag (git checkout <tag>)
#   - Run database migrations: npx tsx src/db/migrate.ts with BOKLI_DB_PATH taken
#     from the environment or the repo .env (refuses if neither sets it)
#     (skippable via BOKLI_DEPLOY_SKIP_MIGRATE=1)
#   - Build production artifacts: BOKLI_BUILD_DIR=.next-prod npm run build
#     (skippable via BOKLI_DEPLOY_SKIP_BUILD=1; the BOKLI_DEPLOY_BUILD_CMD override is
#      a TEST-ONLY seam and requires BOKLI_DEPLOY_TEST_MODE=1)
#   - Stamp the build manifest: .next-prod/BUILD_MANIFEST (verified by ExecStartPre)
#   - Restart systemd user service: systemctl --user restart bokli
#     (skippable via BOKLI_DEPLOY_SKIP_RESTART=1)
#   - Post-restart health check on /login with 3 retry attempts 2s apart and --max-time 5
#     (URL configurable via BOKLI_DEPLOY_HEALTHCHECK_URL, skippable via BOKLI_DEPLOY_SKIP_HEALTHCHECK=1)
#
# Rollback:
#   To roll back, pass --allow-rollback with a previous release tag:
#   ./scripts/bokli_deploy.sh --allow-rollback <previous-tag>
#   Note: SQLite migrations only move forward; application code must remain
#   backwards-compatible with forward schema changes.
# ==============================================================================

set -euo pipefail

ALLOW_ROLLBACK=0
TAG=""

while [ $# -gt 0 ]; do
  case "$1" in
    --allow-rollback)
      ALLOW_ROLLBACK=1
      shift
      ;;
    -*)
      echo "❌ Unknown option: $1" >&2
      echo "Usage: $0 [--allow-rollback] <tag>" >&2
      exit 1
      ;;
    *)
      if [ -z "$TAG" ]; then
        TAG="$1"
      else
        echo "❌ Unexpected extra argument: $1" >&2
        echo "Usage: $0 [--allow-rollback] <tag>" >&2
        exit 1
      fi
      shift
      ;;
  esac
done

if [ -z "$TAG" ]; then
  echo "Usage: $0 [--allow-rollback] <tag> (e.g. $0 v1.0.0)" >&2
  exit 1
fi

# Validate TAG against safe charset before any use
if [[ ! "$TAG" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "❌ Refusing deploy: invalid tag format '$TAG'. Tags must only contain alphanumeric characters, dots, underscores, and hyphens (^[A-Za-z0-9._-]+$)." >&2
  exit 1
fi

# Resolve repo root directory relative to script location
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${BOKLI_REPO_DIR:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
cd "$REPO_ROOT"

# Gate: BOKLI_DEPLOY_BUILD_CMD is a TEST-ONLY seam.
# It replaces the real production build, so on its own it lets a deploy write a
# fresh .next-prod/BUILD_MANIFEST stamp for a build that never actually ran —
# prod would then pass the ExecStartPre stamp check while serving stale artifacts.
# Honour it only when the caller also opts in with BOKLI_DEPLOY_TEST_MODE=1.
if [ -n "${BOKLI_DEPLOY_BUILD_CMD:-}" ] && [ "${BOKLI_DEPLOY_TEST_MODE:-0}" != "1" ]; then
  echo "❌ Refusing deploy: BOKLI_DEPLOY_BUILD_CMD is set but BOKLI_DEPLOY_TEST_MODE=1 is not." >&2
  echo "    BOKLI_DEPLOY_BUILD_CMD replaces the real production build and would stamp a build that never ran." >&2
  echo "    It is a test-only seam: re-run with BOKLI_DEPLOY_TEST_MODE=1, or unset BOKLI_DEPLOY_BUILD_CMD for a real deploy." >&2
  exit 1
fi

if [ "${BOKLI_DEPLOY_TEST_MODE:-0}" = "1" ]; then
  echo "################################################################"
  echo "##  ⚠️  BOKLI_DEPLOY_TEST_MODE=1 — THIS IS NOT A REAL DEPLOY  ##"
  echo "##  Build override: BOKLI_DEPLOY_BUILD_CMD='${BOKLI_DEPLOY_BUILD_CMD:-<unset>}'"
  echo "##  Any build stamp written by this run is NOT from a real build."
  echo "################################################################"
fi

# Single-deploy lock: two concurrent deploys would race on the same checkout,
# .next-prod build output, build stamp and service restart, and could leave prod
# running artifacts from one tag stamped with another. Take an exclusive,
# non-blocking lock before anything mutates the repo; the lock is held on fd 9
# for the rest of the run and released automatically when the script exits.
exec 9>"$REPO_ROOT/.deploy.lock"
if ! flock -n 9; then
  echo "❌ Refusing deploy: another deploy is already running (lock held on $REPO_ROOT/.deploy.lock)." >&2
  echo "    Wait for it to finish, or check with: fuser -v $REPO_ROOT/.deploy.lock" >&2
  exit 1
fi

# Fetch latest refs and tags from origin
if [ "${BOKLI_DEPLOY_SKIP_FETCH:-0}" = "1" ]; then
  echo "ℹ️  Skipping git fetch (BOKLI_DEPLOY_SKIP_FETCH=1)"
else
  echo "==> Fetching origin (--tags --prune)..."
  git fetch origin --tags --prune
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

# Gate 3: Check tag matches origin/main tip, or is a valid ancestor when --allow-rollback is passed
if [ "$TAG_COMMIT" = "$MAIN_COMMIT" ]; then
  echo "==> Tag '$TAG' matches tip of origin/main ($MAIN_COMMIT)."
else
  if [ "$ALLOW_ROLLBACK" -ne 1 ]; then
    echo "❌ Refusing deploy: tag '$TAG' commit ($TAG_COMMIT) does not match origin/main tip ($MAIN_COMMIT)." >&2
    echo "    To roll back to a previously released ancestor tag, re-run with: --allow-rollback" >&2
    exit 1
  fi

  if ! git merge-base --is-ancestor "$TAG_COMMIT" "$MAIN_COMMIT"; then
    echo "❌ Refusing rollback: tag '$TAG' commit ($TAG_COMMIT) is not an ancestor of origin/main ($MAIN_COMMIT)." >&2
    echo "    Rollback is only allowed for commits that exist in origin/main's history." >&2
    exit 1
  fi
  echo "⚠️  Rollback allowed: tag '$TAG' ($TAG_COMMIT) is a valid ancestor of origin/main ($MAIN_COMMIT)."
fi

# Gate 4: Check tracked files are clean (ignoring untracked files so artifacts never block deploy)
DIRTY_STATUS=$(git status --porcelain --untracked-files=no)
if [ -n "$DIRTY_STATUS" ]; then
  echo "❌ Refusing deploy: working tree has modified tracked files. Deploy requires clean tracked files." >&2
  echo "Dirty tracked files:" >&2
  echo "$DIRTY_STATUS" >&2
  exit 1
fi

# Checkout the validated tag
echo "==> Checking out $TAG..."
git checkout "$TAG"

# Run database migrations
if [ "${BOKLI_DEPLOY_SKIP_MIGRATE:-0}" = "1" ]; then
  echo "ℹ️  Skipping database migrations (BOKLI_DEPLOY_SKIP_MIGRATE=1)"
else
  echo "==> Running database migrations..."
  if [ -z "${BOKLI_DB_PATH:-}" ] && [ -f "$REPO_ROOT/.env" ]; then
    _raw_db_line=$(grep -E '^[[:space:]]*(export[[:space:]]+)?BOKLI_DB_PATH[[:space:]]*=' "$REPO_ROOT/.env" | head -1 || true)
    BOKLI_DB_PATH=$(printf '%s' "$_raw_db_line" | cut -d= -f2- \
      | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' \
            -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/")
    unset _raw_db_line
    export BOKLI_DB_PATH
  fi
  if [ -z "${BOKLI_DB_PATH:-}" ] || [ -z "$(printf '%s' "${BOKLI_DB_PATH:-}" | tr -d '[:space:]')" ]; then
    echo "❌ Refusing to migrate: BOKLI_DB_PATH is not set (export it or set it in $REPO_ROOT/.env)." >&2
    exit 1
  fi
  npx tsx src/db/migrate.ts
fi

# Build production artifacts
BUILD_SKIPPED=0
if [ "${BOKLI_DEPLOY_SKIP_BUILD:-0}" = "1" ]; then
  echo "ℹ️  Skipping build (BOKLI_DEPLOY_SKIP_BUILD=1)"
  BUILD_SKIPPED=1
else
  echo "==> Building production release..."
  if [ -n "${BOKLI_DEPLOY_BUILD_CMD:-}" ]; then
    # Test-only override; already gated on BOKLI_DEPLOY_TEST_MODE=1 above.
    echo "⚠️  TEST MODE: running BOKLI_DEPLOY_BUILD_CMD instead of the real build."
    $BOKLI_DEPLOY_BUILD_CMD
  else
    BOKLI_BUILD_DIR=.next-prod npm run build
  fi
fi

# Stamp the build manifest (systemd ExecStartPre verifies this before every start)
echo "==> Writing build stamp (.next-prod/BUILD_MANIFEST)..."
BUILD_DIR_ABS="$REPO_ROOT/.next-prod"
STAMP_FILE="$BUILD_DIR_ABS/BUILD_MANIFEST"
if [ "$BUILD_SKIPPED" -eq 1 ]; then
  # Build skipped: the existing stamp must still match current HEAD and tag so we
  # never restart into a build produced for a different commit.
  if [ ! -f "$STAMP_FILE" ]; then
    echo "❌ Refusing restart: build skipped (BOKLI_DEPLOY_SKIP_BUILD=1) but no build stamp exists at $STAMP_FILE." >&2
    echo "    Run a full deploy: ./scripts/bokli_deploy.sh <tag>" >&2
    exit 1
  fi
  if ! BOKLI_REPO_DIR="$REPO_ROOT" "$SCRIPT_DIR/verify_build_stamp.sh"; then
    echo "❌ Refusing restart: build was skipped but the existing build stamp does not match HEAD/tag." >&2
    echo "    Run a full deploy: ./scripts/bokli_deploy.sh <tag> (do not set BOKLI_DEPLOY_SKIP_BUILD=1)" >&2
    exit 1
  fi
else
  STAMP_COMMIT="$(git rev-parse HEAD)"
  STAMP_BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if [ -z "$TAG" ] || [ -z "$STAMP_COMMIT" ] || [ -z "$STAMP_BUILT_AT" ]; then
    echo "❌ Refusing restart: build stamp fields must not be empty (TAG='$TAG' COMMIT='$STAMP_COMMIT' BUILT_AT='$STAMP_BUILT_AT')." >&2
    exit 1
  fi
  if [ ! -d "$BUILD_DIR_ABS" ]; then
    echo "❌ Refusing restart: build output directory $BUILD_DIR_ABS does not exist." >&2
    exit 1
  fi
  cat > "$STAMP_FILE" <<EOF
TAG=$TAG
COMMIT=$STAMP_COMMIT
BUILT_AT=$STAMP_BUILT_AT
DEPLOYED_BY=bokli_deploy.sh
EOF
  echo "==> Stamped: TAG=$TAG COMMIT=$STAMP_COMMIT BUILT_AT=$STAMP_BUILT_AT"
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
if [ "${BOKLI_DEPLOY_SKIP_HEALTHCHECK:-0}" = "1" ]; then
  echo "ℹ️  Health check skipped (BOKLI_DEPLOY_SKIP_HEALTHCHECK=1)"
else
  if [ "${BOKLI_DEPLOY_SKIP_SLEEP:-0}" != "1" ]; then
    sleep 3
  fi

  HEALTHCHECK_URL="${BOKLI_DEPLOY_HEALTHCHECK_URL:-http://localhost:5000/login}"
  MAX_ATTEMPTS=3
  ATTEMPT=1
  HTTP_CODE="000"

  while [ $ATTEMPT -le $MAX_ATTEMPTS ]; do
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$HEALTHCHECK_URL" 2>/dev/null || true)
    if [ "$HTTP_CODE" = "200" ]; then
      break
    fi
    if [ $ATTEMPT -lt $MAX_ATTEMPTS ]; then
      if [ "${BOKLI_DEPLOY_SKIP_SLEEP:-0}" != "1" ]; then
        sleep 2
      fi
    fi
    ATTEMPT=$((ATTEMPT + 1))
  done

  if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ deployed $TAG, /login returns 200"
  else
    echo "❌ FAIL: deployed $TAG, but $HEALTHCHECK_URL returned HTTP $HTTP_CODE (expected 200 after $MAX_ATTEMPTS attempts)." >&2
    echo "Hint: check service logs with 'journalctl --user -u bokli' or 'journalctl --user -u bokli -n 50 --no-pager'." >&2
    exit 1
  fi
fi
