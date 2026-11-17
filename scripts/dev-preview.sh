#!/bin/bash
# Serve a branch on the Bokli dev site (https://boklidev.ktte.me) safely.
# Usage: bash scripts/dev-preview.sh <branch-name>   (from any checkout)
# Runs the branch's local Worker (npm run cloud:local: static build + Worker +
# fresh local D1 with fake data) on 127.0.0.1:3000 behind Cloudflare Access.
# The fake data resets on every preview. Never touches the cloud database.
# Safe by design: one run at a time (lock), refuses if the dev folder has
# uncommitted work, only stops the preview this script started.
# Machine paths: BOKLI_DEV_DIR (dev folder), BOKLI_DEV_VARS (Access settings).
set -u
# Braces: bash reads the whole script before running it, so the checkout below
# can safely replace this file when it runs from inside the dev folder.
{
BRANCH="${1:-}"
[ -n "$BRANCH" ] || { echo "Usage: dev-preview.sh <branch-name>"; exit 2; }
DEV="${BOKLI_DEV_DIR:-$HOME/projects/bokli-dev}"
STATE="$HOME/.local/state"; LOG="$STATE/bokli-dev.log"; PGID_FILE="$STATE/bokli-preview.pgid"
exec 9>/tmp/bokli_preview.lock
flock -n 9 || { echo "REFUSED: another preview is running right now. Wait 5 minutes and retry."; exit 3; }
cd "$DEV" || exit 1
DEV="$(pwd -P)"   # resolved, to match /proc/<pid>/cwd below
DEV_VARS="${BOKLI_DEV_VARS:-$HOME/.config/bokli/boklidev.dev.vars}"   # Access settings for boklidev.ktte.me
[ -f "$DEV_VARS" ] || { echo "REFUSED: $DEV_VARS is missing."; exit 8; }
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "REFUSED: dev folder has uncommitted changes; not touching it."; exit 4
fi
git fetch -q origin "$BRANCH" || { echo "REFUSED: branch '$BRANCH' not found on origin (push it first)."; exit 5; }
git checkout -q --detach "origin/$BRANCH" || { echo "checkout failed"; exit 6; }
echo "Dev folder now on $BRANCH @ $(git rev-parse --short HEAD)"
[ -f scripts/cloud-local.mjs ] || { echo "REFUSED: $BRANCH has no scripts/cloud-local.mjs (too old to preview)."; exit 6; }
install -m 600 "$DEV_VARS" workers/.dev.vars
# Stop the previous preview, and only that: the saved group leader must still be
# this folder's `npm run cloud:local` (a reused PID after a reboot is left alone).
stop_preview() {
  local pgid; pgid="$(cat "$PGID_FILE" 2>/dev/null)"; rm -f "$PGID_FILE"
  [[ "$pgid" =~ ^[0-9]+$ ]] || return 0
  [ "$(readlink -f "/proc/$pgid/cwd" 2>/dev/null)" = "$DEV" ] || return 0
  tr '\0' ' ' < "/proc/$pgid/cmdline" 2>/dev/null | grep -q 'cloud:local' || return 0
  kill -TERM -- "-$pgid" 2>/dev/null
  for _ in $(seq 1 20); do fuser -n tcp 3000 >/dev/null 2>&1 || return 0; sleep 1; done
}
stop_preview
if fuser -n tcp 3000 >/dev/null 2>&1; then echo "FAILED: port 3000 is used by something this script did not start."; exit 7; fi
mkdir -p "$STATE"
LOCK_SUM="$(sha256sum package-lock.json | cut -d' ' -f1)"
if [ "$(cat node_modules/.preview-lock-sum 2>/dev/null)" != "$LOCK_SUM" ]; then
  echo "Installing dependencies (package-lock.json changed)..."
  npm ci --no-audit --no-fund > "$LOG" 2>&1 || { echo "FAILED: npm ci, see $LOG"; exit 7; }
  echo "$LOCK_SUM" > node_modules/.preview-lock-sum
fi
# Detached in its own session: the calling agent must never track a forever-running process.
setsid nohup npm run cloud:local -- --port 3000 --public-origin https://boklidev.ktte.me >> "$LOG" 2>&1 < /dev/null 9>&- &
echo $! > "$PGID_FILE"
# Wait for page + CSS (the static build takes a few minutes).
for _ in $(seq 1 60); do
  sleep 5
  CSS=$(curl -sf -m 30 http://127.0.0.1:3000/ | grep -o '/_next/static/css/[^"]*' | head -1)
  if [ -n "$CSS" ] && curl -sf -o /dev/null -m 10 "http://127.0.0.1:3000$CSS"; then
    echo "READY: https://boklidev.ktte.me  (branch $BRANCH, fake data)"
    echo "Note: you cannot log in for the owner; only page+CSS were checked."
    exit 0
  fi
done
stop_preview
echo "FAILED: preview did not become healthy in 5 min (stopped it). See $LOG"; exit 7
}
