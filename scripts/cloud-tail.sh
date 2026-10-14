#!/usr/bin/env bash
# Record every request a deployed cloud Worker handles (CPU ms, wall ms, outcome,
# URL, status) for the $0 soak test. Reconnects if the tail drops.
#   bash scripts/cloud-tail.sh <worker-name> <out-dir>
# Reads the token/account from ~/.config/bokli/ (never from the command line).
set -u
worker="${1:?worker name}"; out="${2:?out dir}"
mkdir -p "$out" && chmod 700 "$out"
cd "$(dirname "$0")/.."
export CLOUDFLARE_API_TOKEN="$(cat ~/.config/bokli/cloudflare-staging.token)"
export CLOUDFLARE_ACCOUNT_ID="$(cat ~/.config/bokli/cloudflare-account-id)"
export CI=1 WRANGLER_SEND_METRICS=false
while true; do
  node_modules/.bin/wrangler tail "$worker" --format json >> "$out/tail.jsonl" 2>> "$out/tail.err"
  echo "$(date -Is) tail exited ($?), reconnecting" >> "$out/tail.err"
  sleep 10
done
