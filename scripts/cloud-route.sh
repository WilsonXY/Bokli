#!/usr/bin/env bash
# Switch bokli.ktte.me between the laptop (Cloudflare Tunnel) and the cloud Worker.
#   bash scripts/cloud-route.sh status|on|off
# on:  adds the Worker route bokli.ktte.me/* -> Worker "bokli"; the Worker now answers.
# off: deletes that route; requests fall through to the tunnel (the laptop) again.
# No DNS change either way. Reads the token/account from ~/.config/bokli/.
set -euo pipefail
PATTERN="bokli.ktte.me/*"; SCRIPT="bokli"; ZONE_NAME="ktte.me"
T="$(cat ~/.config/bokli/cloudflare-staging.token)"
api() { curl -fsS --max-time 30 -H "Authorization: Bearer $T" -H "Content-Type: application/json" "$@"; }
Z="$(api "https://api.cloudflare.com/client/v4/zones?name=$ZONE_NAME" | python3 -c 'import sys,json;print(json.load(sys.stdin)["result"][0]["id"])')"
ROUTES="https://api.cloudflare.com/client/v4/zones/$Z/workers/routes"
# "<id> <script>" of the route on PATTERN, or empty. A route to another script (or none) is a conflict.
route() { api "$ROUTES" | python3 -c "import sys,json;print(next((f\"{r['id']} {r.get('script') or '-'}\" for r in json.load(sys.stdin)['result'] if r['pattern']=='$PATTERN'),''))"; }
case "${1:-status}" in
  status) read -r id script <<<"$(route)"
          if [ -z "${id:-}" ]; then echo "LAPTOP: no Worker route on $PATTERN (tunnel answers)"
          elif [ "$script" = "$SCRIPT" ]; then echo "CLOUD: $PATTERN -> Worker $SCRIPT"
          else echo "CONFLICT: $PATTERN -> '$script', not $SCRIPT; fix it in the dashboard" >&2; exit 1; fi;;
  on)     read -r id script <<<"$(route)"
          [ -n "${id:-}" ] && [ "$script" = "$SCRIPT" ] && { echo "already on"; exit 0; }
          [ -n "${id:-}" ] && { echo "CONFLICT: $PATTERN -> '$script'; not touching it" >&2; exit 1; }
          api -X POST "$ROUTES" -d "{\"pattern\":\"$PATTERN\",\"script\":\"$SCRIPT\"}" >/dev/null && echo "ON: $PATTERN -> Worker $SCRIPT";;
  off)    read -r id script <<<"$(route)"; [ -z "${id:-}" ] && { echo "already off"; exit 0; }
          api -X DELETE "$ROUTES/$id" >/dev/null && echo "OFF: $PATTERN back to the tunnel (laptop)";;
  *) echo "usage: $0 status|on|off" >&2; exit 2;;
esac
