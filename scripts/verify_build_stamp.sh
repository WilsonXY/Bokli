#!/usr/bin/env bash
# ==============================================================================
# Build Stamp Verifier (systemd ExecStartPre gate for bokli.service)
#
# Refuses (non-zero exit) unless .next-prod/BUILD_MANIFEST exists and shows the
# build was produced by scripts/bokli_deploy.sh for the exact commit and tag
# currently checked out in this repository.
#
# Required manifest fields:
#   TAG=<release tag, must exist as a tag in this repo>
#   COMMIT=<full sha, must equal `git rev-parse HEAD`>
#   BUILT_AT=<UTC ISO8601 timestamp, must be non-empty>
#   DEPLOYED_BY=bokli_deploy.sh
#
# On failure the remediation is always: run ./scripts/bokli_deploy.sh <tag>
# ==============================================================================
set -u

# Resolve repo root: prefer the current working directory when it is a git repo
# (systemd sets WorkingDirectory=%h/projects/bokli; tests set cwd to the fixture).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${BOKLI_REPO_DIR:-}"
if [ -z "$REPO_ROOT" ]; then
  if git -C "$PWD" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    REPO_ROOT="$PWD"
  else
    REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
  fi
fi
STAMP_FILE="$REPO_ROOT/.next-prod/BUILD_MANIFEST"

fail() {
  echo "❌ bokli build stamp verification FAILED: $1" >&2
  echo "Remediation: run ./scripts/bokli_deploy.sh <tag> to rebuild and stamp, then start the service again." >&2
  exit 1
}

# 1. Manifest must exist
if [ ! -f "$STAMP_FILE" ]; then
  fail "build stamp file not found at $STAMP_FILE (prod builds must be produced by scripts/bokli_deploy.sh)."
fi

# 2. Parse required fields
get_field() {
  # prints value of KEY= line; empty if absent
  sed -n "s/^$1=//p" "$STAMP_FILE" | tail -n 1
}

TAG_VAL="$(get_field TAG)"
COMMIT_VAL="$(get_field COMMIT)"
BUILT_AT_VAL="$(get_field BUILT_AT)"
DEPLOYED_BY_VAL="$(get_field DEPLOYED_BY)"

[ -n "$TAG_VAL" ] || fail "TAG field missing/empty in $STAMP_FILE."
[ -n "$COMMIT_VAL" ] || fail "COMMIT field missing/empty in $STAMP_FILE."
[ -n "$BUILT_AT_VAL" ] || fail "BUILT_AT field missing/empty in $STAMP_FILE."
[ "$DEPLOYED_BY_VAL" = "bokli_deploy.sh" ] || fail "DEPLOYED_BY must be 'bokli_deploy.sh' (got '$DEPLOYED_BY_VAL'); build was not produced by the deploy script."

# 3. COMMIT must match checked-out HEAD
HEAD_SHA="$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null)"
if [ -z "$HEAD_SHA" ]; then
  fail "cannot resolve git HEAD in $REPO_ROOT."
fi
if [ "$COMMIT_VAL" != "$HEAD_SHA" ]; then
  fail "stamp COMMIT ($COMMIT_VAL) does not match checked-out HEAD ($HEAD_SHA)."
fi

# 4. TAG must exist as a tag in this repo
if ! git -C "$REPO_ROOT" rev-parse --verify --quiet "refs/tags/${TAG_VAL}^{commit}" >/dev/null 2>&1; then
  fail "stamp TAG '$TAG_VAL' does not exist as a tag in this repository."
fi

echo "✅ Build stamp OK: TAG=$TAG_VAL COMMIT=$HEAD_SHA BUILT_AT=$BUILT_AT_VAL"
exit 0
