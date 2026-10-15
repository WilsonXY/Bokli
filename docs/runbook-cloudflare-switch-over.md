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

1. Freeze cloud saves (the Worker refuses every save from now on, also ones already on their way):
   `npx wrangler d1 execute BOKLI_DB --remote --env production --config workers/wrangler.json --command "UPDATE cloud_write_guard SET maintenance=1 WHERE id=1"`
2. `bash scripts/cloud-route.sh off` — the tunnel (laptop) answers again within seconds.
3. Take a fresh full copy of the cloud database (the nightly one may miss today's entries):
   `bash scripts/cloud-backup.sh production` → `~/bokli-cloud-backups/bokli-production-<today>.db`.
4. List everything that differs from the laptop: new or changed days, deleted days, new, changed or deleted
   Operating Expenses, and Month Close/Reopen actions. The laptop database is only read.
   ```bash
   B=~/bokli-cloud-backups/bokli-production-$(date +%F).db
   sqlite3 -readonly ~/projects/bokli/data/bokli.db "ATTACH '$B' AS c;
   SELECT 'day new/changed', date FROM (SELECT id,date,updated_at FROM c.daily_sheets EXCEPT SELECT id,date,updated_at FROM daily_sheets);
   SELECT 'day deleted', date FROM daily_sheets WHERE date NOT IN (SELECT date FROM c.daily_sheets);
   SELECT 'expense deleted', month, type, amount_sen, note FROM operating_expenses WHERE id NOT IN (SELECT id FROM c.operating_expenses);
   SELECT 'expense new/changed', month, type, amount_sen, note FROM c.operating_expenses WHERE id IN (SELECT id FROM (SELECT id,updated_at FROM c.operating_expenses EXCEPT SELECT id,updated_at FROM operating_expenses));
   SELECT 'month '||action, month FROM (SELECT id,month,action FROM c.month_close_events EXCEPT SELECT id,month,action FROM month_close_events);
   SELECT 'month end state', month, CASE WHEN reopened_at IS NULL THEN 'closed' ELSE 'open' END, cash_on_hand_sen, tng_on_hand_sen, note
     FROM c.month_closes WHERE month IN (SELECT month FROM c.month_close_events WHERE id NOT IN (SELECT id FROM month_close_events));"
   ```
5. `systemctl --user start bokli`, then in the laptop app, in this order:
   1. Reopen every listed month (any line) that is closed on the laptop.
   2. Redo each listed day (amounts: open `$B` with `sqlite3`). Expenses: first handle every `expense deleted`
      line (delete it), then every `expense new/changed` line: delete that month's expense of that type and note
      if the laptop still has one, then add it once with the listed amount (adding on top would sum the two).
   3. Close again every month whose `month end state` is `closed`, with the listed cash and TnG on hand and note,
      and close again any month you reopened in 1. that has no `month end state` line.
   The cloud's step-by-step close history stays in `$B` for reference.
   Restore the two laptop crons; remove the cloud backup cron.
6. `npx wrangler secret delete HEALTHCHECK_URL --config workers/wrangler.json --env production`
   (otherwise the idle Worker keeps the health check green).

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
