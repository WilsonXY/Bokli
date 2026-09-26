#!/usr/bin/env bash
# ==============================================================================
# Bokli Production Release-Tag Deploy — staged build + guarded cutover
#
# Usage (always from a SEPARATE deployer checkout at origin/main, never from the
# production checkout itself):
#   BOKLI_REPO_DIR=<prod checkout> BOKLI_DB_PATH=<prod db> \
#     <deployer>/scripts/bokli_deploy.sh [--allow-rollback] <tag>
#   BOKLI_REPO_DIR=<prod checkout> BOKLI_DB_PATH=<prod db> \
#     <deployer>/scripts/bokli_deploy.sh --recover
#
# Why a separate checkout: the deploy switches the production checkout to the
# new tag. A script living inside that checkout would be the OLD release's
# script (it cannot adopt the new code mid-run) and would rewrite itself while
# bash is still reading it. The script therefore refuses to run from inside
# BOKLI_REPO_DIR, and requires its own checkout to be exactly origin/main.
#
# Refusal gates (all before any production mutation):
#   - tag argument required, must match ^[A-Za-z0-9._-]+$
#   - no BOKLI_DEPLOY_* overrides except BOKLI_DEPLOY_HEALTH_TIMEOUT_SECS (the old
#     SKIP_*/BUILD_CMD/TEST_MODE/HEALTHCHECK_URL seams could fake a success)
#   - BOKLI_REPO_DIR must be the `bokli` user unit's WorkingDirectory, and the unit
#     must run <repo>/scripts/verify_build_stamp.sh as ExecStartPre
#   - BOKLI_DB_PATH must be the DB the unit actually uses (.env overrides unit env,
#     even with an empty value, which is refused), both paths absolute, and must not
#     be under data-dev/
#   - single-deploy flock on <repo>/.deploy.lock; refuses if an earlier cutover
#     journal is pending (run --recover)
#   - fetches origin; tag must exist; tag commit must equal origin/main tip, or be
#     an ancestor of it with --allow-rollback
#   - deployer checkout must be clean and exactly origin/main
#   - production checkout must have clean tracked files and a build stamp that
#     verifies (the known-good release a failed cutover rolls back to)
#
# Phase 1 — prepare (production untouched, service keeps serving):
#   git archive <tag> into a staging dir → consistent online SQLite backup →
#   npm ci → rehearse migrations on the copy (+ integrity/foreign-key checks) →
#   npm run build → verify standalone server + static assets → smoke-test the
#   candidate server on a loopback port against a DB copy → write the stamp.
# Phase 2 — cutover (downtime from stop to healthy start):
#   stop service → fresh snapshot (verified) → migrate a copy of it → swap the
#   migrated DB file in (original DB set kept) → swap .next-prod + node_modules in
#   (old kept) → checkout tag → verify stamp → smoke-test the build at its live
#   path against a DB copy → start service → verify it serves the NEW build id.
#
# Failure handling:
#   - before cutover: exit 1, production untouched.
#   - during cutover, before the new service could have accepted writes (also on
#     INT/TERM/HUP): restore old checkout, build, node_modules and the original DB
#     files, prove it (HEAD, stamp, DB content digest = snapshot; before the DB swap
#     only integrity, so writes the unchanged old release made are kept), restart
#     the old service; exit 2. If that cannot be proven: exit 3, journal kept.
#   - once the service's main process may have run on the new DB: NEVER restore
#     the DB automatically (it may hold new writes); exit 3 "MANUAL RECOVERY
#     REQUIRED", journal kept, further deploys refused until resolved.
#   - SIGKILL/power loss: the journal at <state>/ACTIVE_CUTOVER survives; run
#     --recover, which applies the same rules. Each phase is fsync'd (file and
#     directory entry) before its step starts; an fsync error fails closed.
#
# State dir: <parent of repo>/.bokli-deploy-<repo name>/ (mode 700), holding
# runs/<id>/ with the snapshot, previous build/node_modules and previous DB files.
# After a success only this run and one prior successful run are kept; runs that
# rolled back, need manual recovery or never finished are never pruned.
# SQLite migrations are forward-only; see deploy/README.md for the runbook.
# ==============================================================================

set -Eeuo pipefail

readonly SERVICE="bokli"
readonly SAFE_PATH_RE='^/[A-Za-z0-9._/+@-]+$'

ALLOW_ROLLBACK=0
RECOVER=0
TAG=""
IN_PREPARE=0
IN_CUTOVER=0
PHASE="none"
SMOKE_PID=""
RUN_DIR=""
JOURNAL=""
HEALTH_TIMEOUT=60
LAST_HEALTH=""
LAST_LOGIN_CODE="000"

usage() {
  echo "Usage: BOKLI_REPO_DIR=<prod checkout> BOKLI_DB_PATH=<prod db> $0 [--allow-rollback] <tag>" >&2
  echo "       BOKLI_REPO_DIR=<prod checkout> BOKLI_DB_PATH=<prod db> $0 --recover" >&2
}

say() { printf '==> %s\n' "$*"; }

refuse() {
  printf '❌ Refusing deploy: %s\n' "$1" >&2
  shift
  local line
  for line in "$@"; do printf '    %s\n' "$line" >&2; done
  exit 1
}

# During cutover: exit non-zero; the EXIT trap decides between rollback and manual recovery.
fail() {
  printf '❌ %s\n' "$*" >&2
  exit 1
}

svc_prop() { systemctl --user show "$SERVICE" --property="$1" --value; }

# 0 if a dotenv file assigns KEY at all, even to an empty value.
env_file_has() { grep -qE "^[[:space:]]*(export[[:space:]]+)?$1[[:space:]]*=" "$2"; }

# Value of KEY in a dotenv file (only that line is read; nothing else is printed).
env_file_value() {
  local raw
  raw=$(grep -E "^[[:space:]]*(export[[:space:]]+)?$1[[:space:]]*=" "$2" | tail -n 1 || true)
  printf '%s' "$raw" | cut -d= -f2- |
    sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/"
}

# Value of KEY in systemd's space-separated Environment= list.
unit_env_value() { tr ' ' '\n' <<<"$2" | sed -n "s/^$1=//p" | tail -n 1; }

safe_path() {
  [[ "$1" =~ $SAFE_PATH_RE ]] || refuse "unsupported characters in path '$1' (allowed: A-Z a-z 0-9 . _ / + @ -)."
}

# ------------------------------------------------------------------------------
# SQLite helpers (sqlite3 CLI). Reads of the live DB use a read-only URI so they
# never checkpoint or otherwise modify the live DB files.
# ------------------------------------------------------------------------------
db_backup() { sqlite3 -bail "file:$1?mode=ro" ".timeout 10000" ".backup '$2'"; }
db_integrity_ok() { [ "$(sqlite3 -bail "file:$1?mode=ro" 'PRAGMA integrity_check;' 2>/dev/null)" = "ok" ]; }
db_fk_ok() { [ -z "$(sqlite3 -bail "file:$1?mode=ro" 'PRAGMA foreign_key_check;' 2>&1)" ]; }
db_digest() { sqlite3 -bail "file:$1?mode=ro" .dump | sha256sum | cut -d' ' -f1; }

# Fold any WAL into the main file and make sure it is a single self-contained file.
db_finalize() {
  sqlite3 -bail "$1" 'PRAGMA wal_checkpoint(TRUNCATE);' >/dev/null || return 1
  [ ! -s "$1-wal" ] || return 1
  rm -f "$1-wal" "$1-shm"
}

# Move a DB file together with its WAL sidecars (sidecars first, main file last).
db_move_set() {
  local s
  for s in -wal -shm ""; do
    if [ -e "$1$s" ]; then mv -T "$1$s" "$2$s" || return 1; fi
  done
}

run_migrate() {
  (cd "$RUN_DIR/src" && env -u NODE_ENV BOKLI_DB_PATH="$1" ./node_modules/.bin/tsx src/db/migrate.ts) 9>&-
}

# ------------------------------------------------------------------------------
# HTTP / service helpers
# ------------------------------------------------------------------------------
http_code() { curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$1" 2>/dev/null || true; }

free_port() {
  "$SERVICE_NODE" -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{process.stdout.write(String(s.address().port));s.close()})'
}

# 0 when <base>/login is 200 and <base> serves the static asset only build <id> has.
serves_build() {
  local login asset
  login=$(http_code "$1/login")
  asset=$(http_code "$1/_next/static/$2/_buildManifest.js")
  LAST_LOGIN_CODE="$login"
  LAST_HEALTH="/login=$login, /_next/static/$2/_buildManifest.js=$asset"
  [ "$login" = "200" ] && [ "$asset" = "200" ]
}

stop_smoke() {
  if [ -n "$SMOKE_PID" ]; then
    kill "$SMOKE_PID" 2>/dev/null || true
    wait "$SMOKE_PID" 2>/dev/null || true
    SMOKE_PID=""
  fi
}

# Starts <server.js> on a loopback port against a DB COPY with a throwaway
# AUTH_SECRET (the production secret is never read) and checks it serves <id>.
smoke_server() {
  local server_js="$1" db_copy="$2" build_id="$3" label="$4" port secret deadline
  port=$(free_port)
  secret=$("$SERVICE_NODE" -e 'process.stdout.write(require("crypto").randomBytes(32).toString("base64"))')
  env -i PATH="$PATH" HOME="$HOME" NODE_ENV=production PORT="$port" HOSTNAME=127.0.0.1 \
    BOKLI_DB_PATH="$db_copy" AUTH_SECRET="$secret" AUTH_URL="http://127.0.0.1:$port" AUTH_TRUST_HOST=true \
    "$SERVICE_NODE" "$server_js" >"$RUN_DIR/smoke-$label.log" 2>&1 9>&- &
  SMOKE_PID=$!
  deadline=$((SECONDS + HEALTH_TIMEOUT))
  while :; do
    if ! kill -0 "$SMOKE_PID" 2>/dev/null; then
      LAST_HEALTH="server exited (log: $RUN_DIR/smoke-$label.log)"
      break
    fi
    if serves_build "http://127.0.0.1:$port" "$build_id"; then
      stop_smoke
      return 0
    fi
    [ "$SECONDS" -lt "$deadline" ] || break
    sleep 0.5
  done
  stop_smoke
  return 1
}

# 0 when the unit is active, its main process runs from <repo>/.next-prod/standalone
# and the service port serves build <id>.
wait_for_service() {
  local build_id="$1" deadline pid cwd want
  want="$REPO_ROOT/.next-prod/standalone"
  deadline=$((SECONDS + HEALTH_TIMEOUT))
  while :; do
    pid=$(svc_prop MainPID 2>/dev/null || echo 0)
    if [ "$(systemctl --user is-active "$SERVICE" 2>/dev/null || true)" = "active" ] && [ "${pid:-0}" != "0" ]; then
      cwd=$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)
      if [ "$cwd" != "$(readlink -f "$want" 2>/dev/null || echo "$want")" ]; then
        LAST_HEALTH="service main process runs from '$cwd', not $want"
      elif serves_build "http://127.0.0.1:$SERVICE_PORT" "$build_id"; then
        return 0
      fi
    else
      LAST_HEALTH="service is not active"
    fi
    [ "$SECONDS" -lt "$deadline" ] || return 1
    sleep 0.5
  done
}

service_stopped() {
  local state
  state=$(systemctl --user is-active "$SERVICE" 2>/dev/null || true)
  case "$state" in active | activating | deactivating | reloading | refreshing) return 1 ;; esac
  [ "$(svc_prop MainPID)" = "0" ]
}

# ------------------------------------------------------------------------------
# Durability. fsync(2) flushes a file's data and inode, but "does not necessarily
# ensure that the entry in the directory containing the file has also reached disk.
# For that an explicit fsync() on a file descriptor for the directory is also
# needed." So every rename recovery depends on is followed by an fsync of the
# directories involved. `sync FILE` is not used: uutils coreutils' sync ignores the
# file and calls sync(2), which reports no errors. Any fsync error fails closed, with
# no retry: after a failed writeback Linux may drop the dirty pages, so a later
# fsync that succeeds proves nothing.
# ------------------------------------------------------------------------------
readonly DURABLE_JS='const fs = require("fs"), path = require("path");
const fsync = (p) => { const fd = fs.openSync(p, "r"); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } };
const [mode, ...args] = process.argv.slice(1);
let p;
try {
  if (mode === "rename") {
    p = args[0]; fsync(p);
    p = args[1]; fs.renameSync(args[0], p);
    p = path.dirname(p); fsync(p);
  } else {
    for (p of args) fsync(p);
  }
} catch (e) { console.error("   " + e.syscall + " " + p + ": " + e.code); process.exit(1); }'

# fsync(2) each file or directory.
fsync_paths() { "$SERVICE_NODE" -e "$DURABLE_JS" fsync "$@" 9>&-; }

# fsync SRC, rename(2) it over DST, fsync DST's directory: DST is durable on return 0.
durable_rename() { "$SERVICE_NODE" -e "$DURABLE_JS" rename "$1" "$2" 9>&-; }

# ------------------------------------------------------------------------------
# Cutover journal (survives SIGKILL/power loss; read back by --recover)
# ------------------------------------------------------------------------------
J_KEYS=(RUN_DIR REPO_ROOT LIVE_DB OLD_HEAD OLD_TAG OLD_BUILD_ID TAG TAG_COMMIT NEW_BUILD_ID PID BOOT_ID MAIN_TS SNAP_DIGEST
  ORIG_DB_INO ORIG_WAL_INO ORIG_SHM_INO PHASE)

# Before the first journal write: every directory entry on the path to the run dir
# (the state dir and runs/ may have been created by this deploy) must be on disk, so a
# journal that survives a crash never points at a run directory that did not.
journal_begin() {
  fsync_paths "$RUN_DIR" "$STATE_DIR/runs" "$STATE_DIR" "$(dirname "$STATE_DIR")"
}

# Returns 0 only once the new journal is durable: content fsync'd, atomically
# renamed over the old one, and the rename's directory entry fsync'd.
journal_write() {
  local k tmp="$JOURNAL.tmp"
  for k in "${J_KEYS[@]}"; do printf '%s=%s\n' "$k" "${!k:-}"; done >"$tmp" &&
    durable_rename "$tmp" "$JOURNAL"
}

# Records PHASE durably BEFORE the step it names starts.
journal_phase() {
  PHASE="$1"
  journal_write || fail "could not durably record cutover phase $PHASE in $JOURNAL."
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $PHASE" >>"$RUN_DIR/phases.log"
  say "PHASE $PHASE"
}

journal_read() {
  local k v
  for k in "${J_KEYS[@]}"; do
    v=$(sed -n "s/^$k=//p" "$JOURNAL" | tail -n 1)
    printf -v "$k" '%s' "$v"
  done
}

journal_archive() {
  mv -f "$JOURNAL" "$RUN_DIR/journal.$1" 2>/dev/null || true
  # If this is lost to a power cut the journal reappears; --recover then fails closed.
  fsync_paths "$STATE_DIR" "$RUN_DIR" || echo "⚠️  could not fsync the archived journal in $STATE_DIR." >&2
}

boot_id() { cat /proc/sys/kernel/random/boot_id 2>/dev/null || echo unknown; }

# 0 (true) if the unit's main process may have run since we stopped it — i.e. the
# live DB may contain writes made after the snapshot. Unknown counts as "may".
# Any boot change counts as "may": after a reboot the start timestamp only covers
# the current boot, so a main process that ran (and wrote) before the reboot is
# invisible. Only called once the DB may have been swapped.
writes_possible() {
  local ts
  if [ -z "${MAIN_TS:-}" ] || [ -z "${BOOT_ID:-}" ]; then return 0; fi
  [ "$(boot_id)" = "$BOOT_ID" ] || return 0
  ts=$(svc_prop ExecMainStartTimestampMonotonic 2>/dev/null) || return 0
  [ -n "$ts" ] || return 0
  [ "$ts" != "$MAIN_TS" ]
}

# ------------------------------------------------------------------------------
# Rollback (only when no writes can have reached the new DB)
# ------------------------------------------------------------------------------
restore_dir() {
  local n="$1"
  mkdir -p "$RUN_DIR/rolled-back" || return 1
  if [ -e "$RUN_DIR/prev/$n" ]; then
    if [ -e "$REPO_ROOT/$n" ]; then mv -T "$REPO_ROOT/$n" "$RUN_DIR/rolled-back/$n" || return 1; fi
    mv -T "$RUN_DIR/prev/$n" "$REPO_ROOT/$n" || return 1
  elif [ -e "$RUN_DIR/prev/$n.absent" ]; then
    if [ -e "$REPO_ROOT/$n" ]; then mv -T "$REPO_ROOT/$n" "$RUN_DIR/rolled-back/$n" || return 1; fi
  fi
  return 0
}

ino_of() { stat -c %i -- "$1" 2>/dev/null || true; }

# Inode the original DB file with suffix $1 ("", -wal, -shm) had before the swap; empty if absent.
orig_ino() {
  case "$1" in
    -wal) echo "${ORIG_WAL_INO:-}" ;;
    -shm) echo "${ORIG_SHM_INO:-}" ;;
    *) echo "${ORIG_DB_INO:-}" ;;
  esac
}

# Puts the original DB files back at the live path. They are identified by the inode
# recorded before the swap (a rename keeps it), not by where they happen to be, so
# this resumes correctly after an interruption at any single move: only files that are
# NOT originals leave the live path (never onto an existing file), so an original -wal
# already moved back, holding committed rows, stays next to its main file.
restore_db() {
  local base prev s want dest
  base=$(basename "$LIVE_DB")
  prev="$RUN_DIR/prev-db/$base"
  [ -n "${ORIG_DB_INO:-}" ] || { echo "   journal records no inode for the original DB; cannot tell it from the migrated one" >&2; return 1; }
  mkdir -p "$RUN_DIR/rolled-back-db" || return 1
  for s in -wal -shm ""; do
    [ -e "$LIVE_DB$s" ] || continue
    want=$(orig_ino "$s")
    if [ -n "$want" ] && [ "$(ino_of "$LIVE_DB$s")" = "$want" ]; then continue; fi
    dest="$RUN_DIR/rolled-back-db/$base$s"
    [ ! -e "$dest" ] || dest="$dest.$(date +%s%N)"
    mv -T "$LIVE_DB$s" "$dest" || return 1
  done
  for s in -wal -shm ""; do
    [ -e "$prev$s" ] || continue
    want=$(orig_ino "$s")
    if [ -z "$want" ] || [ "$(ino_of "$prev$s")" != "$want" ]; then
      echo "   $prev$s is not one of the original DB files" >&2
      return 1
    fi
    mv -T "$prev$s" "$LIVE_DB$s" || return 1
  done
  for s in "" -wal -shm; do
    want=$(orig_ino "$s")
    [ -z "$want" ] || [ "$(ino_of "$LIVE_DB$s")" = "$want" ] || { echo "   original $base$s is not back at $LIVE_DB$s" >&2; return 1; }
  done
}

# Full rollback + proof. Returns 0 only if the old release is verifiably back.
rollback_all() {
  local ok=0 head
  echo "↩️  Rolling back to $OLD_TAG ($OLD_HEAD)..." >&2
  systemctl --user stop "$SERVICE" >/dev/null 2>&1 || true
  if ! service_stopped; then
    echo "   could not stop $SERVICE for rollback" >&2
    return 1
  fi
  # Re-check after the stop: a restart loop could have started the new main process.
  # (Irrelevant before the DB swap: the live DB is still the original then.)
  case "$PHASE" in
    stopping | stopped) ;;
    *)
      if writes_possible; then
        ROLLBACK_BLOCKED_BY_WRITES=1
        return 1
      fi
      ;;
  esac
  restore_dir .next-prod || { echo "   failed to restore .next-prod" >&2; ok=1; }
  restore_dir node_modules || { echo "   failed to restore node_modules" >&2; ok=1; }
  head=$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || true)
  if [ "$head" != "$OLD_HEAD" ] || [ -n "$(git -C "$REPO_ROOT" status --porcelain --untracked-files=no 2>/dev/null)" ]; then
    git -C "$REPO_ROOT" checkout --quiet --force --detach "$OLD_HEAD" || { echo "   git checkout $OLD_HEAD failed" >&2; ok=1; }
  fi
  case "$PHASE" in
    stopping | stopped) ;;
    *) restore_db || { echo "   failed to restore the database files" >&2; ok=1; } ;;
  esac

  # Proof
  [ -f "$LIVE_DB" ] || { echo "   database $LIVE_DB is missing" >&2; ok=1; }
  [ "$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null)" = "$OLD_HEAD" ] || { echo "   HEAD is not $OLD_HEAD" >&2; ok=1; }
  [ -z "$(git -C "$REPO_ROOT" status --porcelain --untracked-files=no 2>/dev/null)" ] || { echo "   tracked files are modified" >&2; ok=1; }
  [ "$(cat "$REPO_ROOT/.next-prod/BUILD_ID" 2>/dev/null)" = "$OLD_BUILD_ID" ] || { echo "   .next-prod is not the previous build $OLD_BUILD_ID" >&2; ok=1; }
  (cd "$REPO_ROOT" && BOKLI_REPO_DIR="$REPO_ROOT" ./scripts/verify_build_stamp.sh >/dev/null) || { echo "   previous build stamp does not verify" >&2; ok=1; }
  case "$PHASE" in
    stopping | stopped)
      # Never swapped: this is the original DB. The unchanged old release may have
      # written to it since (e.g. auto-started after a reboot); keep those writes.
      db_integrity_ok "$LIVE_DB" || { echo "   database integrity_check failed" >&2; ok=1; }
      ;;
    *)
      if [ -n "${SNAP_DIGEST:-}" ]; then
        [ "$(db_digest "$LIVE_DB" 2>/dev/null)" = "$SNAP_DIGEST" ] || { echo "   database content does not match the verified snapshot" >&2; ok=1; }
        db_integrity_ok "$LIVE_DB" || { echo "   database integrity_check failed" >&2; ok=1; }
      fi
      ;;
  esac
  [ "$ok" = 0 ] || return 1

  # The restored renames must be on disk before the old release may write again.
  local d dirs=()
  for d in "$(dirname "$LIVE_DB")" "$RUN_DIR/prev-db" "$RUN_DIR/rolled-back-db" "$REPO_ROOT" "$RUN_DIR/prev" "$RUN_DIR/rolled-back" "$RUN_DIR"; do
    [ ! -d "$d" ] || dirs+=("$d")
  done
  fsync_paths "${dirs[@]}" || { echo "   could not make the restored files durable" >&2; return 1; }

  systemctl --user start "$SERVICE" || { echo "   systemctl --user start $SERVICE failed" >&2; return 1; }
  if ! wait_for_service "$OLD_BUILD_ID"; then
    echo "   old release did not become healthy: $LAST_HEALTH" >&2
    return 1
  fi
  return 0
}

manual_recovery_message() {
  cat >&2 <<EOF

🚨 MANUAL RECOVERY REQUIRED — the deploy script will not guess.
   Reason: $1
   Tag being deployed : ${TAG:-?} (${TAG_COMMIT:-?})
   Previous release   : ${OLD_TAG:-?} (${OLD_HEAD:-?}), build ${OLD_BUILD_ID:-?}
   Cutover phase      : ${PHASE:-?}
   Run directory      : ${RUN_DIR:-?}
     snapshot.db       verified pre-migration snapshot taken after the service stopped
     prev-db/          original DB files (as they were at stop time)
     prev/             previous .next-prod and node_modules
   Journal            : ${JOURNAL:-?} (further deploys are refused while it exists)
   The live DB may contain writes made after the snapshot. Restoring the snapshot
   would discard them. Follow "Manual recovery" in deploy/README.md, then archive
   the journal as described there.
EOF
}

# Decide and perform recovery for an interrupted cutover. Returns the exit code.
recover_cutover() {
  ROLLBACK_BLOCKED_BY_WRITES=0
  case "$PHASE" in
    done)
      return 0
      ;;
    stopping | stopped)
      # Code and DB not yet touched: nothing to restore, just bring the old service back.
      ;;
    *)
      if writes_possible; then
        manual_recovery_message "the service's main process has run since the cutover stopped it (phase $PHASE); it may have accepted writes on the migrated database."
        return 3
      fi
      ;;
  esac
  if rollback_all; then
    journal_archive rolled-back
    local db_proof="DB content = snapshot"
    case "$PHASE" in stopping | stopped) db_proof="original DB never swapped, integrity ok" ;; esac
    echo "❌ Deploy of ${TAG} did not complete; production was ROLLED BACK to ${OLD_TAG} and verified (HEAD, build stamp, ${db_proof}, service serving build ${OLD_BUILD_ID})." >&2
    return 2
  fi
  if [ "$ROLLBACK_BLOCKED_BY_WRITES" = 1 ]; then
    manual_recovery_message "the service's main process started during rollback; it may have accepted writes on the migrated database."
  else
    manual_recovery_message "automatic rollback could not be proven (see messages above)."
  fi
  return 3
}

on_exit() {
  local rc=$?
  trap '' INT TERM HUP
  set +e
  stop_smoke
  if [ "$IN_CUTOVER" = 1 ] && [ "$PHASE" != "done" ]; then
    echo "❌ Deploy failed during cutover (phase $PHASE, exit $rc)." >&2
    recover_cutover
    rc=$?
  elif [ "$IN_PREPARE" = 1 ] && [ "$rc" != 0 ]; then
    echo "❌ Deploy failed before cutover; production was not touched (service, checkout, build, node_modules and DB unchanged)." >&2
    # A journal here can only be this run's first record (PHASE=stopping, written
    # before the stop and not proven durable): main() refuses to start while one exists.
    rm -f "$JOURNAL" "$JOURNAL.tmp"
    if [ -n "$RUN_DIR" ]; then rm -rf "$RUN_DIR/src" "$RUN_DIR"/*.db "$RUN_DIR"/*.db-wal "$RUN_DIR"/*.db-shm; fi
  fi
  exit "$rc"
}

# ------------------------------------------------------------------------------
# Preflight (read-only apart from the lock file and git fetch)
# ------------------------------------------------------------------------------
parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --allow-rollback) ALLOW_ROLLBACK=1 ;;
      --recover) RECOVER=1 ;;
      -*)
        echo "❌ Unknown option: $1" >&2
        usage
        exit 1
        ;;
      *)
        if [ -n "$TAG" ]; then
          echo "❌ Unexpected extra argument: $1" >&2
          usage
          exit 1
        fi
        TAG="$1"
        ;;
    esac
    shift
  done
  if [ "$RECOVER" = 1 ]; then
    if [ -n "$TAG" ] || [ "$ALLOW_ROLLBACK" = 1 ]; then
      echo "❌ --recover takes no tag and no other options." >&2
      usage
      exit 1
    fi
    return 0
  fi
  if [ -z "$TAG" ]; then
    usage
    exit 1
  fi
  if [[ ! "$TAG" =~ ^[A-Za-z0-9._-]+$ ]]; then
    refuse "invalid tag format '$TAG'. Tags must only contain alphanumeric characters, dots, underscores, and hyphens (^[A-Za-z0-9._-]+$)."
  fi
}

check_overrides() {
  local v bad=()
  while IFS= read -r v; do
    [ "$v" = "BOKLI_DEPLOY_HEALTH_TIMEOUT_SECS" ] || bad+=("$v")
  done < <(compgen -e | grep '^BOKLI_DEPLOY_' || true)
  if [ ${#bad[@]} -gt 0 ]; then
    refuse "unsupported deploy override(s) set: ${bad[*]}" \
      "The SKIP_*/BUILD_CMD/TEST_MODE/HEALTHCHECK_URL seams were removed: they let a deploy report" \
      "success without a real migrate/build/restart/health check. Unset them and re-run."
  fi
  HEALTH_TIMEOUT="${BOKLI_DEPLOY_HEALTH_TIMEOUT_SECS:-60}"
  if [[ ! "$HEALTH_TIMEOUT" =~ ^[0-9]+$ ]] || [ "$HEALTH_TIMEOUT" -lt 1 ] || [ "$HEALTH_TIMEOUT" -gt 600 ]; then
    refuse "BOKLI_DEPLOY_HEALTH_TIMEOUT_SECS must be an integer between 1 and 600."
  fi
}

check_tools() {
  local t
  for t in git flock sqlite3 curl node npm systemctl tar sha256sum realpath stat readlink; do
    command -v "$t" >/dev/null 2>&1 || refuse "required tool '$t' not found in PATH."
  done
}

resolve_targets() {
  local script_path script_dir top
  script_path=$(realpath "${BASH_SOURCE[0]}")
  script_dir=$(dirname "$script_path")
  SCRIPT_REPO=$(git -C "$script_dir" rev-parse --show-toplevel 2>/dev/null) ||
    refuse "this deploy script is not inside a git checkout ($script_dir)." \
      "Run it from a deployer checkout at origin/main (see deploy/README.md → Deploying a release)."
  SCRIPT_REPO=$(realpath "$SCRIPT_REPO")

  [ -n "${BOKLI_REPO_DIR:-}" ] ||
    refuse "BOKLI_REPO_DIR is not set." \
      "Set it to the production checkout the $SERVICE service runs from (its WorkingDirectory)."
  [ -d "$BOKLI_REPO_DIR" ] || refuse "BOKLI_REPO_DIR ($BOKLI_REPO_DIR) is not a directory."
  REPO_ROOT=$(realpath "$BOKLI_REPO_DIR")
  safe_path "$REPO_ROOT"
  top=$(git -C "$REPO_ROOT" rev-parse --show-toplevel 2>/dev/null) || top=""
  [ -n "$top" ] && [ "$(realpath "$top")" = "$REPO_ROOT" ] ||
    refuse "BOKLI_REPO_DIR ($REPO_ROOT) is not the top level of a git checkout."

  case "$script_path" in
    "$REPO_ROOT"/*)
      refuse "this script must not run from inside the production checkout ($REPO_ROOT)." \
        "The deploy rewrites that checkout; a script inside it is the OLD release's script." \
        "Run the release's script from a separate deployer checkout at origin/main, e.g.:" \
        "  git -C ~/projects/bokli-deployer fetch origin --tags && git -C ~/projects/bokli-deployer checkout --detach origin/main" \
        "  BOKLI_REPO_DIR=$REPO_ROOT BOKLI_DB_PATH=<prod db> ~/projects/bokli-deployer/scripts/bokli_deploy.sh <tag>"
      ;;
  esac
  [ "$SCRIPT_REPO" != "$REPO_ROOT" ] || refuse "this script must not run from inside the production checkout ($REPO_ROOT)."

  [ -n "${BOKLI_DB_PATH:-}" ] && [ -n "$(printf '%s' "$BOKLI_DB_PATH" | tr -d '[:space:]')" ] ||
    refuse "BOKLI_DB_PATH is not set." \
      "Set it explicitly to the production database the $SERVICE service uses (there is no default and no .env fallback)."
  [[ "$BOKLI_DB_PATH" == /* ]] ||
    refuse "BOKLI_DB_PATH ($BOKLI_DB_PATH) must be an absolute path; a relative path depends on the caller's directory."
  # --recover alone may find the live DB absent: a kill between moving the original
  # aside and moving the migrated DB in. do_recover then requires a pending journal.
  LIVE_DB_ABSENT=0
  if [ "$RECOVER" = 1 ] && [ ! -e "$BOKLI_DB_PATH" ] && [ -d "$(dirname "$BOKLI_DB_PATH")" ]; then
    LIVE_DB_ABSENT=1
  else
    [ -f "$BOKLI_DB_PATH" ] || refuse "database $BOKLI_DB_PATH does not exist (a deploy never creates the production DB)."
  fi
  LIVE_DB=$(realpath "$BOKLI_DB_PATH")
  safe_path "$LIVE_DB"
  case "$LIVE_DB" in
    */data-dev/*) refuse "BOKLI_DB_PATH ($LIVE_DB) is under a data-dev/ directory; production deploys only target the production DB." ;;
  esac

  STATE_DIR="$(dirname "$REPO_ROOT")/.bokli-deploy-$(basename "$REPO_ROOT")"
  JOURNAL="$STATE_DIR/ACTIVE_CUTOVER"
}

check_service_identity() {
  local load wd pre start envfiles envfile="" line unit_env eff_db eff_port
  load=$(svc_prop LoadState 2>/dev/null || true)
  [ "$load" = "loaded" ] || refuse "systemd user unit '$SERVICE' is not loaded (LoadState=${load:-?})."

  wd=$(svc_prop WorkingDirectory)
  [ -n "$wd" ] && [ -d "$wd" ] && [ "$(realpath "$wd")" = "$REPO_ROOT" ] ||
    refuse "BOKLI_REPO_DIR ($REPO_ROOT) is not the $SERVICE service WorkingDirectory (${wd:-<unset>})."

  pre=$(svc_prop ExecStartPre)
  [[ "$pre" == *"path=$REPO_ROOT/scripts/verify_build_stamp.sh "* ]] ||
    refuse "the $SERVICE unit does not run $REPO_ROOT/scripts/verify_build_stamp.sh as ExecStartPre;" \
      "the build-stamp gate this deploy relies on is missing. Fix the unit first (escalate; do not bypass)."

  start=$(svc_prop ExecStart)
  SERVICE_NODE=$(sed -n 's/^{ path=\([^ ;]*\) ;.*/\1/p' <<<"$start")
  [ -n "$SERVICE_NODE" ] && [[ "$start" == *"argv[]=$SERVICE_NODE .next-prod/standalone/server.js "* ]] ||
    refuse "the $SERVICE unit ExecStart is not '<node> .next-prod/standalone/server.js' (got: $start)."
  [ -x "$SERVICE_NODE" ] || refuse "service node binary $SERVICE_NODE is not executable."
  [ "$("$SERVICE_NODE" -v)" = "$(node -v)" ] ||
    refuse "node on PATH ($(node -v)) differs from the service's $SERVICE_NODE ($("$SERVICE_NODE" -v))." \
      "Native modules built by npm ci must match the runtime; fix PATH and re-run."

  envfiles=$(svc_prop EnvironmentFiles)
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    line="${line% (ignore_errors=*}"
    [ "$line" = "$REPO_ROOT/.env" ] ||
      refuse "the $SERVICE unit loads an unexpected EnvironmentFile ($line); cannot prove which DB it uses."
    envfile="$line"
  done <<<"$envfiles"

  # EnvironmentFile= overrides Environment= in systemd.
  unit_env=$(svc_prop Environment)
  eff_db=$(unit_env_value BOKLI_DB_PATH "$unit_env")
  eff_port=$(unit_env_value PORT "$unit_env")
  # An assignment there wins even when empty (the service then gets an empty value),
  # so an empty one is refused rather than falling back to Environment=.
  if [ -n "$envfile" ] && [ -f "$envfile" ]; then
    if env_file_has BOKLI_DB_PATH "$envfile"; then
      eff_db=$(env_file_value BOKLI_DB_PATH "$envfile")
      [ -n "$eff_db" ] || refuse "$envfile sets BOKLI_DB_PATH to an empty value; the $SERVICE service would run without a database path."
    fi
    if env_file_has PORT "$envfile"; then
      eff_port=$(env_file_value PORT "$envfile")
      [ -n "$eff_port" ] || refuse "$envfile sets PORT to an empty value; cannot tell which port the $SERVICE service listens on."
    fi
  fi
  [ -n "$eff_db" ] || refuse "cannot determine which database the $SERVICE service uses."
  # The app resolves a relative path from its own cwd (.next-prod/standalone), not ours.
  [[ "$eff_db" == /* ]] ||
    refuse "the $SERVICE service's BOKLI_DB_PATH ($eff_db) must be an absolute path; cannot prove which file a relative path names."
  [ "$(realpath -m "$eff_db")" = "$LIVE_DB" ] ||
    refuse "BOKLI_DB_PATH ($LIVE_DB) is not the database the $SERVICE service uses ($eff_db)."
  [[ "$eff_port" =~ ^[0-9]+$ ]] || refuse "cannot determine the $SERVICE service PORT."
  SERVICE_PORT="$eff_port"
}

check_same_filesystem() {
  mkdir -p -m 700 "$STATE_DIR"
  chmod 700 "$STATE_DIR"
  safe_path "$STATE_DIR"
  local d1 d2 d3
  d1=$(stat -c %d "$REPO_ROOT")
  d2=$(stat -c %d "$(dirname "$LIVE_DB")")
  d3=$(stat -c %d "$STATE_DIR")
  [ "$d1" = "$d2" ] && [ "$d1" = "$d3" ] ||
    refuse "$REPO_ROOT, $(dirname "$LIVE_DB") and $STATE_DIR must be on one filesystem (cutover relies on atomic rename)."
}

take_lock() {
  exec 9>"$REPO_ROOT/.deploy.lock"
  if ! flock -n 9; then
    refuse "another deploy is already running (lock held on $REPO_ROOT/.deploy.lock)." \
      "Wait for it to finish, or check with: fuser -v $REPO_ROOT/.deploy.lock"
  fi
}

check_release_gates() {
  echo "==> Fetching origin (--tags --prune)..."
  git -C "$REPO_ROOT" fetch --quiet origin --tags --prune

  if ! TAG_COMMIT=$(git -C "$REPO_ROOT" rev-parse --verify "refs/tags/${TAG}^{commit}" 2>/dev/null); then
    refuse "tag '$TAG' does not exist locally after fetch."
  fi
  if ! MAIN_COMMIT=$(git -C "$REPO_ROOT" rev-parse --verify "origin/main^{commit}" 2>/dev/null); then
    refuse "origin/main ref does not exist or cannot be resolved."
  fi
  if [ "$TAG_COMMIT" = "$MAIN_COMMIT" ]; then
    echo "==> Tag '$TAG' matches tip of origin/main ($MAIN_COMMIT)."
  else
    if [ "$ALLOW_ROLLBACK" -ne 1 ]; then
      echo "❌ Refusing deploy: tag '$TAG' commit ($TAG_COMMIT) does not match origin/main tip ($MAIN_COMMIT)." >&2
      echo "    To roll back to a previously released ancestor tag, re-run with: --allow-rollback" >&2
      exit 1
    fi
    if ! git -C "$REPO_ROOT" merge-base --is-ancestor "$TAG_COMMIT" "$MAIN_COMMIT"; then
      echo "❌ Refusing rollback: tag '$TAG' commit ($TAG_COMMIT) is not an ancestor of origin/main ($MAIN_COMMIT)." >&2
      echo "    Rollback is only allowed for commits that exist in origin/main's history." >&2
      exit 1
    fi
    echo "⚠️  Rollback allowed: tag '$TAG' ($TAG_COMMIT) is a valid ancestor of origin/main ($MAIN_COMMIT)."
  fi

  # The script that runs must be the newest released one, byte for byte.
  local deployer_head deployer_dirty
  deployer_head=$(git -C "$SCRIPT_REPO" rev-parse HEAD)
  deployer_dirty=$(git -C "$SCRIPT_REPO" status --porcelain --untracked-files=no)
  if [ -n "$deployer_dirty" ]; then
    refuse "the deployer checkout $SCRIPT_REPO has modified tracked files:" "$deployer_dirty"
  fi
  if [ "$deployer_head" != "$MAIN_COMMIT" ]; then
    refuse "this deploy script's checkout ($SCRIPT_REPO @ $deployer_head) is not origin/main ($MAIN_COMMIT)." \
      "Only the newest released deploy script may deploy or roll back:" \
      "  git -C $SCRIPT_REPO fetch origin --tags && git -C $SCRIPT_REPO checkout --detach origin/main"
  fi
}

check_live_checkout() {
  local dirty added p collide=()
  dirty=$(git -C "$REPO_ROOT" status --porcelain --untracked-files=no)
  if [ -n "$dirty" ]; then
    echo "❌ Refusing deploy: working tree has modified tracked files. Deploy requires clean tracked files." >&2
    echo "Dirty tracked files:" >&2
    echo "$dirty" >&2
    exit 1
  fi
  OLD_HEAD=$(git -C "$REPO_ROOT" rev-parse HEAD)
  if ! (cd "$REPO_ROOT" && BOKLI_REPO_DIR="$REPO_ROOT" ./scripts/verify_build_stamp.sh >/dev/null); then
    refuse "the current production build stamp does not verify ($REPO_ROOT/.next-prod/BUILD_MANIFEST)." \
      "A cutover can only roll back to a verified release; resolve the current state manually first."
  fi
  OLD_TAG=$(sed -n 's/^TAG=//p' "$REPO_ROOT/.next-prod/BUILD_MANIFEST" | tail -n 1)
  OLD_BUILD_ID=$(cat "$REPO_ROOT/.next-prod/BUILD_ID" 2>/dev/null || true)
  [[ "$OLD_BUILD_ID" =~ ^[A-Za-z0-9_-]+$ ]] && [ -f "$REPO_ROOT/.next-prod/standalone/.next-prod/static/$OLD_BUILD_ID/_buildManifest.js" ] ||
    refuse "the current production build has no verifiable BUILD_ID/static manifest; cannot prove a rollback."

  # Untracked/ignored files the tag would overwrite on checkout.
  added=$(git -C "$REPO_ROOT" diff --name-only --diff-filter=A "$OLD_HEAD" "$TAG_COMMIT")
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    if [ -e "$REPO_ROOT/$p" ] || [ -L "$REPO_ROOT/$p" ]; then collide+=("$p"); fi
  done <<<"$added"
  [ ${#collide[@]} -eq 0 ] ||
    refuse "untracked files in $REPO_ROOT would be overwritten by $TAG:" "${collide[@]}"
}

# ------------------------------------------------------------------------------
# Phase 1: prepare (production untouched)
# ------------------------------------------------------------------------------
prepare() {
  IN_PREPARE=1
  RUN_DIR="$STATE_DIR/runs/$(date -u +%Y%m%dT%H%M%SZ)-$$"
  mkdir -p "$RUN_DIR/src" "$RUN_DIR/prev" "$RUN_DIR/prev-db"
  say "Preparing $TAG ($TAG_COMMIT) in $RUN_DIR (production untouched)"

  git -C "$REPO_ROOT" archive --format=tar "$TAG_COMMIT" | tar -x -C "$RUN_DIR/src"

  say "Taking online backup of $LIVE_DB for rehearsal..."
  db_backup "$LIVE_DB" "$RUN_DIR/rehearsal.db" || fail "online backup of $LIVE_DB failed."
  db_integrity_ok "$RUN_DIR/rehearsal.db" || fail "integrity_check failed on the online backup."

  say "Installing dependencies (npm ci)..."
  (cd "$RUN_DIR/src" && env -u NODE_ENV -u BOKLI_DB_PATH npm ci --include=dev --no-audit --no-fund) 9>&- ||
    fail "npm ci failed for $TAG."

  say "Rehearsing migrations on a copy of the production DB..."
  run_migrate "$RUN_DIR/rehearsal.db" || fail "migration rehearsal failed for $TAG (live DB untouched)."
  db_integrity_ok "$RUN_DIR/rehearsal.db" || fail "migration rehearsal failed: integrity_check is not ok."
  db_fk_ok "$RUN_DIR/rehearsal.db" || fail "migration rehearsal failed: foreign_key_check reported violations."
  db_finalize "$RUN_DIR/rehearsal.db" || fail "migration rehearsal failed: could not checkpoint the rehearsal DB."

  say "Building $TAG (staging)..."
  cp "$RUN_DIR/rehearsal.db" "$RUN_DIR/build.db"
  (cd "$RUN_DIR/src" && env -u NODE_ENV BOKLI_BUILD_DIR=.next-prod BOKLI_DB_PATH="$RUN_DIR/build.db" npm run build) 9>&- ||
    fail "build failed for $TAG."

  local b="$RUN_DIR/src/.next-prod"
  NEW_BUILD_ID=$(cat "$b/BUILD_ID" 2>/dev/null || true)
  [[ "$NEW_BUILD_ID" =~ ^[A-Za-z0-9_-]+$ ]] || fail "build produced no valid .next-prod/BUILD_ID."
  [ -f "$b/standalone/server.js" ] || fail "build produced no .next-prod/standalone/server.js."
  [ "$(cat "$b/standalone/.next-prod/BUILD_ID" 2>/dev/null)" = "$NEW_BUILD_ID" ] ||
    fail "standalone BUILD_ID does not match .next-prod/BUILD_ID."
  [ -f "$b/standalone/.next-prod/static/$NEW_BUILD_ID/_buildManifest.js" ] ||
    fail "standalone static assets missing: .next-prod/standalone/.next-prod/static/$NEW_BUILD_ID/_buildManifest.js"

  say "Smoke-testing candidate build $NEW_BUILD_ID (loopback, DB copy)..."
  cp "$RUN_DIR/rehearsal.db" "$RUN_DIR/smoke-stage.db"
  smoke_server "$b/standalone/server.js" "$RUN_DIR/smoke-stage.db" "$NEW_BUILD_ID" stage ||
    fail "candidate smoke test failed: $LAST_HEALTH"

  local built_at
  built_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  printf 'TAG=%s\nCOMMIT=%s\nBUILT_AT=%s\nDEPLOYED_BY=bokli_deploy.sh\nBUILD_ID=%s\n' \
    "$TAG" "$TAG_COMMIT" "$built_at" "$NEW_BUILD_ID" >"$b/BUILD_MANIFEST.tmp"
  mv -f "$b/BUILD_MANIFEST.tmp" "$b/BUILD_MANIFEST"
  rm -f "$RUN_DIR"/rehearsal.db* "$RUN_DIR"/build.db* "$RUN_DIR"/smoke-*.db*
}

# ------------------------------------------------------------------------------
# Phase 2: cutover
# ------------------------------------------------------------------------------
swap_in() {
  local n="$1"
  if [ -e "$REPO_ROOT/$n" ]; then
    mv -T "$REPO_ROOT/$n" "$RUN_DIR/prev/$n"
  else
    : >"$RUN_DIR/prev/$n.absent"
  fi
  mv -T "$RUN_DIR/src/$n" "$REPO_ROOT/$n"
}

cutover() {
  local base s
  base=$(basename "$LIVE_DB")
  PID=$$
  BOOT_ID=$(boot_id)
  MAIN_TS=""
  SNAP_DIGEST=""
  # Still "prepare" until the first phase is durable: a failure here leaves production untouched.
  journal_begin || fail "could not fsync the deploy state directories."
  journal_phase stopping
  IN_CUTOVER=1
  IN_PREPARE=0
  systemctl --user stop "$SERVICE" || fail "systemctl --user stop $SERVICE failed."
  service_stopped || fail "$SERVICE is still running after stop."
  MAIN_TS=$(svc_prop ExecMainStartTimestampMonotonic)
  journal_phase stopped

  db_backup "$LIVE_DB" "$RUN_DIR/snapshot.db" || fail "snapshot of $LIVE_DB failed."
  db_integrity_ok "$RUN_DIR/snapshot.db" || fail "snapshot integrity_check failed."
  SNAP_DIGEST=$(db_digest "$RUN_DIR/snapshot.db")
  [ "$(db_digest "$LIVE_DB")" = "$SNAP_DIGEST" ] || fail "snapshot content differs from $LIVE_DB."
  fsync_paths "$RUN_DIR/snapshot.db" "$RUN_DIR" || fail "could not make the snapshot durable."
  journal_write || fail "could not durably record the snapshot digest in $JOURNAL."
  say "Verified snapshot: $RUN_DIR/snapshot.db"

  say "Migrating a copy of the snapshot..."
  cp "$RUN_DIR/snapshot.db" "$RUN_DIR/candidate.db"
  run_migrate "$RUN_DIR/candidate.db" || fail "migration failed on the production snapshot."
  db_integrity_ok "$RUN_DIR/candidate.db" || fail "migrated DB integrity_check failed."
  db_fk_ok "$RUN_DIR/candidate.db" || fail "migrated DB foreign_key_check reported violations."
  # Last touch before the swap: fold the WAL in so exactly one self-contained file moves.
  db_finalize "$RUN_DIR/candidate.db" || fail "could not checkpoint the migrated DB."
  chmod --reference="$LIVE_DB" "$RUN_DIR/candidate.db"
  fsync_paths "$RUN_DIR/candidate.db" || fail "could not make the migrated DB durable."

  # Identify the original DB files by inode so a rollback can always tell them apart.
  ORIG_DB_INO=$(ino_of "$LIVE_DB")
  ORIG_WAL_INO=$(ino_of "$LIVE_DB-wal")
  ORIG_SHM_INO=$(ino_of "$LIVE_DB-shm")
  [ -n "$ORIG_DB_INO" ] || fail "cannot read the inode of $LIVE_DB."
  journal_phase db-swapping
  db_move_set "$LIVE_DB" "$RUN_DIR/prev-db/$base" || fail "could not move the old DB files aside."
  for s in "" -wal -shm; do
    [ ! -e "$LIVE_DB$s" ] || fail "$LIVE_DB$s still exists after moving the old DB aside."
  done
  mv -T "$RUN_DIR/candidate.db" "$LIVE_DB" || fail "could not move the migrated DB into place."
  fsync_paths "$(dirname "$LIVE_DB")" "$RUN_DIR/prev-db" "$RUN_DIR" || fail "could not make the DB swap durable."
  journal_phase db-swapped

  journal_phase code-switching
  swap_in .next-prod || fail "could not switch .next-prod."
  swap_in node_modules || fail "could not switch node_modules."
  echo "==> Checking out $TAG..."
  git -C "$REPO_ROOT" checkout --quiet --detach "$TAG_COMMIT" || fail "git checkout $TAG failed."
  fsync_paths "$REPO_ROOT" "$RUN_DIR/prev" "$RUN_DIR/src" || fail "could not make the code switch durable."
  journal_phase code-switched

  [ "$(git -C "$REPO_ROOT" rev-parse HEAD)" = "$TAG_COMMIT" ] || fail "HEAD is not $TAG_COMMIT after checkout."
  (cd "$REPO_ROOT" && BOKLI_REPO_DIR="$REPO_ROOT" ./scripts/verify_build_stamp.sh) || fail "build stamp does not verify after switch."
  db_backup "$LIVE_DB" "$RUN_DIR/smoke-live.db" || fail "could not copy the migrated DB for the live-path smoke test."
  say "Smoke-testing $NEW_BUILD_ID at its live path (loopback, DB copy)..."
  smoke_server "$REPO_ROOT/.next-prod/standalone/server.js" "$RUN_DIR/smoke-live.db" "$NEW_BUILD_ID" live ||
    fail "live-path smoke test failed: $LAST_HEALTH"
  rm -f "$RUN_DIR"/smoke-live.db*
  journal_phase verified

  # From here the new service may accept writes: a failure no longer restores the DB.
  journal_phase start-invoked
  systemctl --user start "$SERVICE" || fail "systemctl --user start $SERVICE failed."
  if ! wait_for_service "$NEW_BUILD_ID"; then
    echo "❌ FAIL: deployed $TAG, but http://127.0.0.1:$SERVICE_PORT/login returned HTTP $LAST_LOGIN_CODE (expected 200 and build $NEW_BUILD_ID within ${HEALTH_TIMEOUT}s; $LAST_HEALTH)." >&2
    echo "Hint: check service logs with 'journalctl --user -u bokli' or 'journalctl --user -u bokli -n 50 --no-pager'." >&2
    exit 1
  fi
  journal_phase done
  journal_archive done
  IN_CUTOVER=0
  rm -rf "$RUN_DIR/src"
  prune_old_runs || echo "⚠️  Could not prune old runs in $STATE_DIR/runs (deploy itself succeeded)." >&2
}

# Retention: after a successful deploy keep this run and one prior SUCCESSFUL run
# (journal.done); delete older successful runs, which hold DB snapshots. Runs that
# rolled back, need/needed manual recovery or never finished are never pruned, and
# nothing outside $STATE_DIR/runs is touched (nightly backups live elsewhere).
readonly KEEP_DONE_RUNS=2
prune_old_runs() {
  local d n=0
  [ ! -e "$JOURNAL" ] || return 0
  while IFS= read -r d; do
    [ -f "$d/journal.done" ] || continue
    [ ! -e "$d/journal.manual" ] && [ ! -e "$d/journal.rolled-back" ] || continue
    n=$((n + 1))
    [ "$n" -gt "$KEEP_DONE_RUNS" ] || continue
    [ "$d" != "$RUN_DIR" ] || continue
    rm -rf -- "$d" && say "Pruned old completed run $(basename "$d")"
  done < <(find "$STATE_DIR/runs" -mindepth 1 -maxdepth 1 -type d -regextype posix-extended \
    -regex '.*/[0-9]{8}T[0-9]{6}Z-[0-9]+' | LC_ALL=C sort -r)
}

do_recover() {
  if [ ! -e "$JOURNAL" ]; then
    [ "$LIVE_DB_ABSENT" = 0 ] ||
      refuse "database $LIVE_DB does not exist and there is no cutover journal ($JOURNAL) to restore it from." \
        "Nothing was changed. Restore the DB manually (deploy/README.md → Manual recovery)."
    echo "No incomplete cutover (no journal at $JOURNAL); nothing to recover."
    exit 0
  fi
  local want_repo="$REPO_ROOT" want_db="$LIVE_DB"
  journal_read
  [ "$REPO_ROOT" = "$want_repo" ] && [ "$LIVE_DB" = "$want_db" ] ||
    refuse "journal $JOURNAL belongs to $REPO_ROOT / $LIVE_DB, not $want_repo / $want_db."
  [ -d "$RUN_DIR" ] || refuse "journal points at missing run directory $RUN_DIR."
  if [ "$PHASE" = "done" ]; then
    [ "$LIVE_DB_ABSENT" = 0 ] || refuse "database $LIVE_DB does not exist although the journal says the cutover completed."
    journal_archive done
    echo "Cutover of $TAG had completed (phase done); journal archived, nothing to recover."
    exit 0
  fi
  echo "==> Recovering interrupted cutover of $TAG (phase $PHASE, run $RUN_DIR)"
  local rc=0
  trap '' INT TERM HUP
  set +e
  recover_cutover
  rc=$?
  set -e
  if [ "$rc" = 2 ]; then
    echo "✅ Recovery complete: production is ROLLED BACK to $OLD_TAG and verified."
    exit 0
  fi
  exit "$rc"
}

main() {
  parse_args "$@"
  check_overrides
  check_tools
  resolve_targets
  check_service_identity
  take_lock
  check_same_filesystem
  trap on_exit EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  trap 'exit 129' HUP

  if [ "$RECOVER" = 1 ]; then
    do_recover
  fi
  if [ -e "$JOURNAL" ]; then
    refuse "an earlier cutover did not finish (journal $JOURNAL)." \
      "Run: BOKLI_REPO_DIR=$REPO_ROOT BOKLI_DB_PATH=$LIVE_DB $0 --recover"
  fi
  check_release_gates
  check_live_checkout
  prepare
  cutover
  echo "✅ deployed $TAG, /login returns 200 and serves build $NEW_BUILD_ID (previous: $OLD_TAG). Run: $RUN_DIR"
}

# Parsed in full before anything runs.
main "$@"
exit $?
