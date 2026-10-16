#!/usr/bin/env bash
# Nightly off-Cloudflare copy of the cloud database (replaces the laptop's
# bokli_backup.sh after switch-over). Cloudflare Time Travel covers 7 days of
# point-in-time restore; this keeps 14 daily SQLite files on Google Drive.
#   bash scripts/cloud-backup.sh [production|staging]
# Config (outside the repo): ~/.config/bokli/cloud-backup.env with REMOTE=<rclone path>,
# WEBHOOK_URL=<discord webhook> (optional). Tests: BACKUP_REMOTE=<other path> NOTIFY=0 STAGING_DIR=<dir>.
set -u
ENV_NAME="${1:-production}"
cd "$(dirname "$0")/.."
source ~/.config/bokli/cloud-backup.env
REMOTE="${BACKUP_REMOTE:-${REMOTE:?set REMOTE in ~/.config/bokli/cloud-backup.env}}"   # test override
export CLOUDFLARE_API_TOKEN="$(cat ~/.config/bokli/cloudflare-staging.token)"
export CLOUDFLARE_ACCOUNT_ID="$(cat ~/.config/bokli/cloudflare-account-id)"
export CI=1 WRANGLER_SEND_METRICS=false
STAGING_DIR="${STAGING_DIR:-$HOME/bokli-cloud-backups}"; KEEP_DAYS=14
# Environment in the name: a staging run never overwrites a production backup. Built as
# .part and renamed only after the integrity check, so a failed run is never uploaded.
STAMP="$(date +%F)"; DEST="$STAGING_DIR/bokli-$ENV_NAME-$STAMP.db"; PART="$DEST.part"; SQL="$STAGING_DIR/bokli-$ENV_NAME-$STAMP.sql"
# Discord message: jq builds the JSON so line breaks and quotes are safe.
TAG=""; [ "$ENV_NAME" = production ] || TAG=" ($ENV_NAME)"
day() { date -d "$1" "+%a %-d %b %Y" 2>/dev/null || echo "$1"; }   # 2026-10-16 -> Fri 16 Oct 2026
notify() { [ "${NOTIFY:-1}" = 0 ] || [ -z "${WEBHOOK_URL:-}" ] || jq -nc --arg c "$1" '{content:$c}' | curl -s -m 15 -X POST "$WEBHOOK_URL" -H "Content-Type: application/json" --data-binary @- >/dev/null 2>&1 || true; }
failed() { printf '**Bokli cloud backup FAILED**%s · %s\n%s' "$TAG" "$(day "$STAMP")" "$1"; }
fail() { echo "[cloud-backup $(date '+%F %T')] FAIL: $1"; notify "$(failed "$1")"; rm -f "$SQL" "$PART"; exit 1; }
mkdir -p "$STAGING_DIR" && chmod 700 "$STAGING_DIR"
# One run at a time (cron + manual never share .part). If still busy, leave its files alone.
exec 9>"$STAGING_DIR/.lock"
flock -w 900 9 || { echo "[cloud-backup $(date '+%F %T')] FAIL: another backup run is still busy"; notify "$(failed "another run is still busy")"; exit 1; }
rm -f "$PART" "$SQL"
node_modules/.bin/wrangler d1 export BOKLI_DB --remote --env "$ENV_NAME" --config workers/wrangler.json --output "$SQL" >/dev/null || fail "D1 export failed (wrangler error above)"
sqlite3 -bail "$PART" < "$SQL" || fail "export did not load into SQLite"
rm -f "$SQL"; chmod 600 "$PART"
[ "$(sqlite3 "$PART" 'PRAGMA integrity_check;')" = ok ] || fail "integrity check failed"
IFS='|' read -r DAYS FIRST LAST EXPENSES <<<"$(sqlite3 "$PART" 'SELECT count(*), coalesce(min(date),"-"), coalesce(max(date),"-"), (SELECT count(*) FROM operating_expenses) FROM daily_sheets')"
ROWS="$DAYS days, $EXPENSES expenses"
mv "$PART" "$DEST" || fail "could not rename the checked backup"
rclone copy "$STAGING_DIR" "$REMOTE" --include "bokli-*.db" -q || fail "upload to Google Drive failed (copy kept locally)"
rclone delete "$REMOTE" --include "bokli-*.db" --min-age "${KEEP_DAYS}d" -q || echo "WARN: cloud retention failed"
find "$STAGING_DIR" -name "bokli-*.db" -mtime "+$KEEP_DAYS" -delete
echo "[cloud-backup $(date '+%F %T')] OK: $DEST ($ROWS)"
notify "$(printf '**Bokli cloud backup OK**%s · %s\nDaily Sheet days: %s (%s → %s)\nOperating Expenses: %s\nGoogle Drive › %s · kept %s days' \
  "$TAG" "$(day "$STAMP")" "$DAYS" "$(day "$FIRST")" "$(day "$LAST")" "$EXPENSES" "${REMOTE#*:}" "$KEEP_DAYS")"
