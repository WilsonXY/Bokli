#!/usr/bin/env bash
# ==============================================================================
# Login smoke test against a freshly built standalone server and a throwaway DB.
#
# Usage (after `npm run build`, from the repo root):
#   bash scripts/ci-smoke-login.sh
#
# Creates a temp dir holding a new SQLite DB, applies the migrations, seeds the
# family users with random passwords, starts .next-prod/standalone/server.js on
# 127.0.0.1:$SMOKE_PORT (default 3999) and runs scripts/smoke-login.mjs twice:
#   - wrong password: must FAIL (proves the smoke test can fail at all)
#   - right password: must reach an authenticated page with a session
# Never touches data/ or data-dev/; the temp dir and server are removed on exit.
# ==============================================================================

set -Eeuo pipefail

cd "$(dirname "$0")/.."

readonly LISTEN_PORT="${SMOKE_PORT:-3999}"
readonly BASE_URL="http://127.0.0.1:${LISTEN_PORT}"
readonly SERVER_JS=".next-prod/standalone/server.js"

[ -f "$SERVER_JS" ] || { echo "FAIL: $SERVER_JS missing; run npm run build first." >&2; exit 1; }

WORK_DIR="$(mktemp -d)"
SERVER_PID=""

cleanup() {
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

dump_server_log() {
  echo "--- server log ---" >&2
  cat "$WORK_DIR/server.log" >&2 || true
}

export BOKLI_DB_PATH="$WORK_DIR/smoke.db"
MOM_PASSWORD="$(openssl rand -hex 16)"

echo "==> Migrating throwaway DB at $BOKLI_DB_PATH"
npx tsx src/db/migrate.ts

echo "==> Seeding family users"
BOKLI_MOM_PASSWORD="$MOM_PASSWORD" BOKLI_ADMIN_PASSWORD="$(openssl rand -hex 16)" \
  npx tsx src/db/seed.ts

echo "==> Starting standalone server on $BASE_URL"
NODE_ENV=production PORT="$LISTEN_PORT" HOSTNAME=127.0.0.1 \
  AUTH_SECRET="$(openssl rand -base64 32)" AUTH_URL="$BASE_URL" \
  node "$SERVER_JS" >"$WORK_DIR/server.log" 2>&1 &
SERVER_PID=$!

for _ in $(seq 60); do
  if curl -sf -o /dev/null "$BASE_URL/login"; then break; fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "FAIL: server exited before serving /login." >&2
    dump_server_log
    exit 1
  fi
  sleep 1
done
curl -sf -o /dev/null "$BASE_URL/login" || { echo "FAIL: /login not served within 60s." >&2; dump_server_log; exit 1; }

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
