# Runbook: move bokli.ktte.me from the laptop to Cloudflare

Cloudflare Workers Free ($0): static pages + the Worker in `workers/` + D1 database `bokli`.
The laptop app, its database and the tunnel stay intact for 30 days as the rollback.

Every command needs the Cloudflare token in the environment:

```bash
export CLOUDFLARE_API_TOKEN="$(cat ~/.config/bokli/cloudflare-staging.token)"
export CLOUDFLARE_ACCOUNT_ID="$(cat ~/.config/bokli/cloudflare-account-id)"
```

Run commands from `~/projects/bokli-cloud`, a checkout of `main` used only for the cloud
(`git -C ~/projects/bokli worktree add ~/projects/bokli-cloud main && cd ~/projects/bokli-cloud && npm ci`).
Do not change `~/projects/bokli`: it is the laptop rollback for 30 days.

## Before the evening

- The final migration PR is merged; `bash scripts/cloud-route.sh status` says `LAPTOP`.
- Pick an evening outside the 1st–3rd of a month. Tell Mom: no entries for about 30 minutes,
  and afterwards Bokli asks only for the email PIN (no app password any more).

## Switch-over (~30 minutes)

1. Stop writes on the laptop: `systemctl --user stop bokli`.
2. Copy the data. It must print `All checks EQUAL`; otherwise stop and start the laptop again (step 1 reversed).
   Mom's username and both Access emails are in `~/.config/bokli/access-emails.env` (not in this public repo).
   ```bash
   source ~/.config/bokli/access-emails.env
   node scripts/cloud-copy-data.mjs --source ~/projects/bokli/data/bokli.db --env production \
     --email "$MOM_USERNAME=$MOM_EMAIL" --email "katte=$KATTE_EMAIL"
   ```
3. Deploy the merged code: `npm run build:cloud && npx wrangler deploy --config workers/wrangler.json --env production`.
4. Turn on the Worker's health ping (same Healthchecks check as the laptop's):
   `npx wrangler secret put HEALTHCHECK_URL --config workers/wrangler.json --env production < ~/bokli-hc-ping.txt`
5. Point the address at the Worker: `bash scripts/cloud-route.sh on`.
6. Check: Katte opens bokli.ktte.me, logs in with the PIN, sees the real months and adds/deletes a
   test expense in the current month; then Mom opens it on her phone.
   `npx wrangler tail bokli` must show those requests (proves the Worker, not the laptop, answered).
7. Laptop crons (`crontab -e`): comment out `bokli_ping.sh` and `bokli_backup.sh`; add the cloud backup:
   `0 1 * * * cd ~/projects/bokli-cloud && bash scripts/cloud-backup.sh production >> ~/bokli-cloud-backup.log 2>&1`
   (`~/.config/bokli/cloud-backup.env` holds the Drive path and Discord webhook.)
8. After this and any later `wrangler deploy`: `bash scripts/cloud-route.sh status` must say `CLOUD`
   (tested 2026-10-15: deploys keep the route, also with the empty `routes` in config).
9. Leave `bokli.service` stopped but installed, the tunnel running, and `data/bokli.db` untouched.

## Rollback (under 10 minutes)

1. `bash scripts/cloud-route.sh off` — the tunnel (laptop) answers again within seconds.
2. `systemctl --user start bokli`; restore the two laptop crons; remove the cloud backup cron.
3. `npx wrangler secret delete HEALTHCHECK_URL --config workers/wrangler.json --env production`
   (otherwise the idle Worker keeps the health check green).
4. Entries made on Cloudflare after the switch are not on the laptop. Find them in the latest cloud
   backup on Drive (`Bokli/D1 Backup`, a normal SQLite file) or with `npx wrangler d1 execute BOKLI_DB
   --remote --env production --command "SELECT * FROM daily_sheets WHERE updated_at > '<switch time>'"`
   and re-enter them on the laptop.

## Undo a bad change (Time Travel, last 7 days)

Restores the whole database to a moment; entries after that moment are lost, so note them first.

```bash
npx wrangler d1 time-travel restore BOKLI_DB --config workers/wrangler.json --env production --timestamp 2026-10-20T13:05:00Z
```

Drill on 2026-10-14 (staging): numbers EQUAL to the snapshot again in under a minute; saving afterwards worked.

## $0 test result (staging, 2026-10-14, 8 hours, 33 rounds)

453 Worker requests, 0 errors, 0 CPU-limit kills (1102), 0 double saves on retry. CPU median 8.6 ms,
99% 26.6 ms, max 31.6 ms: about a third of requests exceed the free plan's 10 ms and still pass on
Cloudflare's burst allowance. If 1102s ever appear, trim the heaviest routes (identity check, Month Close,
cold Daily Sheet load) before anything else.
