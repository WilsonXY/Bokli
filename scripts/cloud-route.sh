#!/usr/bin/env bash
# Check (or restore) the Worker route that serves bokli.ktte.me.
#   bash scripts/cloud-route.sh status|on
# on: adds the Worker route bokli.ktte.me/* -> Worker "bokli" if it is missing.
# The laptop was retired on 2026-11-01, so without the route nothing answers.
# No DNS change. Reads the token/account from ~/.config/bokli/.
set -euo pipefail
PATTERN="bokli.ktte.me/*"; SCRIPT="bokli"; ZONE_NAME="ktte.me"
T="${CLOUDFLARE_API_TOKEN:-$(cat ~/.config/bokli/cloudflare-staging.token)}"   # GitHub deploy job passes its own
api() { curl -fsS --max-time 30 -H "Authorization: Bearer $T" -H "Content-Type: application/json" "$@"; }
Z="$(api "https://api.cloudflare.com/client/v4/zones?name=$ZONE_NAME" | python3 -c 'import sys,json;print(json.load(sys.stdin)["result"][0]["id"])')"
ROUTES="https://api.cloudflare.com/client/v4/zones/$Z/workers/routes"
# "<id> <script>" of the route on PATTERN, or empty. A route to another script (or none) is a conflict.
route() { api "$ROUTES" | python3 -c "import sys,json;print(next((f\"{r['id']} {r.get('script') or '-'}\" for r in json.load(sys.stdin)['result'] if r['pattern']=='$PATTERN'),''))"; }
R="$(route)"   # a failed lookup stops here (set -e) instead of looking like "no route"
read -r id script <<<"$R"
case "${1:-status}" in
  status) if [ -z "${id:-}" ]; then echo "NONE: no Worker route on $PATTERN, the site is down (run: $0 on)"
          elif [ "$script" = "$SCRIPT" ]; then echo "CLOUD: $PATTERN -> Worker $SCRIPT"
          else echo "CONFLICT: $PATTERN -> '$script', not $SCRIPT; fix it in the dashboard" >&2; exit 1; fi;;
  on)     [ -n "${id:-}" ] && [ "$script" = "$SCRIPT" ] && { echo "already on"; exit 0; }
          [ -n "${id:-}" ] && { echo "CONFLICT: $PATTERN -> '$script'; not touching it" >&2; exit 1; }
          api -X POST "$ROUTES" -d "{\"pattern\":\"$PATTERN\",\"script\":\"$SCRIPT\"}" >/dev/null && echo "ON: $PATTERN -> Worker $SCRIPT";;
  *) echo "usage: $0 status|on" >&2; exit 2;;
esac
