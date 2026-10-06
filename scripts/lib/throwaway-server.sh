# shellcheck shell=bash
# ==============================================================================
# Built Bokli server on a throwaway DB. Sourced, not run; used by
# scripts/ci-smoke-login.sh and scripts/agent-verify.sh.
#
# Caller: cd to the repo root, `npm run build` first, then
#   source scripts/lib/throwaway-server.sh
#   trap stop_throwaway_server EXIT
#   start_throwaway_server
#
# Creates a temp dir holding a new SQLite DB, applies the migrations, seeds the
# family users with random passwords (MOM_PASSWORD, ADMIN_PASSWORD) and starts
# .next-prod/standalone/server.js on 127.0.0.1:$SMOKE_PORT (default 3999).
# Never touches data/ or data-dev/; stop_throwaway_server removes server and dir.
# ==============================================================================

readonly LISTEN_PORT="${SMOKE_PORT:-3999}"
readonly BASE_URL="http://127.0.0.1:${LISTEN_PORT}"
readonly SERVER_JS=".next-prod/standalone/server.js"

WORK_DIR=""
SERVER_PID=""
MOM_PASSWORD=""
ADMIN_PASSWORD=""

stop_throwaway_server() {
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  [ -n "$WORK_DIR" ] && rm -rf "$WORK_DIR"
  return 0
}

dump_server_log() {
  echo "--- server log ---" >&2
  cat "$WORK_DIR/server.log" >&2 || true
}

start_throwaway_server() {
  [ -f "$SERVER_JS" ] || { echo "FAIL: $SERVER_JS missing; run npm run build first." >&2; exit 1; }
  # Something else on the port would answer the readiness check below and get
  # tested instead of this build.
  if curl -s -o /dev/null --max-time 3 "$BASE_URL/login"; then
    echo "FAIL: $BASE_URL is already in use; set SMOKE_PORT to a free port." >&2
    exit 1
  fi

  WORK_DIR="$(mktemp -d)"
  export BOKLI_DB_PATH="$WORK_DIR/smoke.db"
  MOM_PASSWORD="$(openssl rand -hex 16)"
  ADMIN_PASSWORD="$(openssl rand -hex 16)"

  echo "==> Migrating throwaway DB at $BOKLI_DB_PATH"
  npx tsx src/db/migrate.ts

  echo "==> Seeding family users"
  BOKLI_MOM_PASSWORD="$MOM_PASSWORD" BOKLI_ADMIN_PASSWORD="$ADMIN_PASSWORD" \
    npx tsx src/db/seed.ts

  echo "==> Starting standalone server on $BASE_URL"
  NODE_ENV=production PORT="$LISTEN_PORT" HOSTNAME=127.0.0.1 \
    AUTH_SECRET="$(openssl rand -base64 32)" AUTH_URL="$BASE_URL" \
    node "$SERVER_JS" >"$WORK_DIR/server.log" 2>&1 &
  SERVER_PID=$!

  for _ in $(seq 60); do
    if curl -sf -o /dev/null --max-time 2 "$BASE_URL/login"; then break; fi
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
      echo "FAIL: server exited before serving /login." >&2
      dump_server_log
      exit 1
    fi
    sleep 1
  done
  curl -sf -o /dev/null --max-time 5 "$BASE_URL/login" || { echo "FAIL: /login not served within 60s." >&2; dump_server_log; exit 1; }
}
