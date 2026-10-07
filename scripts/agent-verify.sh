#!/usr/bin/env bash
# ==============================================================================
# Agent UI proof: run one user flow against a freshly built server and a
# throwaway DB, recording video and screenshots for the PR. Not a preview.
#
# Usage (after `npm run build`, from the repo root):
#   bash scripts/agent-verify.sh <flow.mjs> [mom|katte]
#
# The flow is an ES module whose default export receives a logged-in page:
#   export default async ({ page, shot }) => {
#     await page.goto("/expenses");
#     await page.getByRole("button", { name: "Add" }).click();
#     await page.getByText("Saved").waitFor(); // throw when the result is wrong
#     await shot("saved");  // .evidence/<sha>/<flow>-<user>/01-saved.png
#   };
# The DB holds only the seeded users (mom = Operator, katte = Admin); create
# any other data the flow needs through the UI.
#
# Starts the server from scripts/lib/throwaway-server.sh, logs in, runs the
# flow via scripts/agent-verify.mjs and writes .evidence/<sha>/<flow>-<user>/
# (flow.webm and screenshots; <sha>-dirty with uncommitted changes). Server
# and DB are removed on exit; the evidence stays. Exit 0 only if the flow
# finished without throwing.
# ==============================================================================

set -Eeuo pipefail

[ $# -ge 1 ] || { echo "usage: bash scripts/agent-verify.sh <flow.mjs> [mom|katte]" >&2; exit 2; }
FLOW="$(realpath "$1")"
VERIFY_USER="${2:-mom}"
[ -f "$FLOW" ] || { echo "FAIL: flow $1 not found." >&2; exit 2; }
case "$VERIFY_USER" in
  mom|katte) ;;
  *) echo "FAIL: user must be mom or katte, got '$VERIFY_USER'." >&2; exit 2 ;;
esac

cd "$(dirname "$0")/.."

source scripts/lib/throwaway-server.sh
trap stop_throwaway_server EXIT

SHA="$(git rev-parse --short HEAD)"
[ -z "$(git status --porcelain)" ] || SHA="${SHA}-dirty"
# One dir per flow and user, so other flows' proof for this commit survives.
EVIDENCE_DIR="$PWD/.evidence/$SHA/$(basename "$FLOW" .mjs)-$VERIFY_USER"

start_throwaway_server
rm -rf "$EVIDENCE_DIR"
mkdir -p "$EVIDENCE_DIR"

VERIFY_PASS="$MOM_PASSWORD"
[ "$VERIFY_USER" = katte ] && VERIFY_PASS="$ADMIN_PASSWORD"

echo "==> Running $FLOW as $VERIFY_USER"
export BASE_URL
if ! VERIFY_USER="$VERIFY_USER" VERIFY_PASS="$VERIFY_PASS" EVIDENCE_DIR="$EVIDENCE_DIR" \
  node scripts/agent-verify.mjs "$FLOW"; then
  dump_server_log
  exit 1
fi
