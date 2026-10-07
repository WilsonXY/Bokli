#!/usr/bin/env bash
# ==============================================================================
# Login smoke test against a freshly built standalone server and a throwaway DB.
#
# Usage (after `npm run build`, from the repo root):
#   bash scripts/ci-smoke-login.sh
#
# Starts the throwaway server from scripts/lib/throwaway-server.sh (new SQLite
# DB, migrations, seeded users, standalone server on 127.0.0.1:$SMOKE_PORT,
# default 3999) and runs scripts/smoke-login.mjs twice:
#   - wrong password: must FAIL (proves the smoke test can fail at all)
#   - right password: must reach an authenticated page with a session
# Never touches data/ or data-dev/; the temp dir and server are removed on exit.
# ==============================================================================

set -Eeuo pipefail

cd "$(dirname "$0")/.."

# Server setup is shared with scripts/agent-verify.sh.
source scripts/lib/throwaway-server.sh
trap stop_throwaway_server EXIT
start_throwaway_server

echo "==> Wrong password must be rejected"
# Only "submitted, then never left /login" counts as a rejection; a browser,
# navigation or form failure must not pass as one.
if SMOKE_USER=mom SMOKE_PASS="wrong-$MOM_PASSWORD" TARGET_URL="$BASE_URL" node scripts/smoke-login.mjs \
  >"$WORK_DIR/smoke-wrong.out"; then
  cat "$WORK_DIR/smoke-wrong.out"
  echo "FAIL: login with a wrong password succeeded." >&2
  dump_server_log
  exit 1
fi
cat "$WORK_DIR/smoke-wrong.out"
if ! grep -q "^STATE: FAIL: not authenticated: .*url=$BASE_URL/login" "$WORK_DIR/smoke-wrong.out"; then
  echo "FAIL: wrong-password run failed for another reason than staying on /login." >&2
  dump_server_log
  exit 1
fi

echo "==> Right password must log in"
# smoke-login.mjs exits 0 on a Cloudflare Access SKIP; on loopback that can only
# mean something is wrong, so require the SUCCESS line.
if ! SMOKE_USER=mom SMOKE_PASS="$MOM_PASSWORD" TARGET_URL="$BASE_URL" node scripts/smoke-login.mjs \
  | tee "$WORK_DIR/smoke.out"; then
  dump_server_log
  exit 1
fi
if ! grep -q "^STATE: SUCCESS" "$WORK_DIR/smoke.out"; then
  echo "FAIL: smoke test did not report SUCCESS." >&2
  dump_server_log
  exit 1
fi

echo "PASS: login smoke test"
