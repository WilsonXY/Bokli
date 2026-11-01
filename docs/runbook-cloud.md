# Runbook: Bokli on Cloudflare

Cloudflare Workers Free ($0): static pages + the Worker in `workers/` + D1 database `bokli`.
Live at bokli.ktte.me since 2026-10-16. The laptop app was retired on 2026-11-01; its final
database is kept in `~/backups/bokli-laptop-retired-2026-11-01/` and on Google Drive
(`Bokli/DB Backup/bokli-laptop-final-2026-11-01.db`).

Commands below need the Cloudflare token in the environment:

```bash
export CLOUDFLARE_API_TOKEN="$(cat ~/.config/bokli/cloudflare-staging.token)"
export CLOUDFLARE_ACCOUNT_ID="$(cat ~/.config/bokli/cloudflare-account-id)"
```

Run them from `~/projects/bokli-cloud`, a checkout of `main` used only for the cloud.
Before each use, bring it to the latest `main`: `git -C ~/projects/bokli-cloud pull --ff-only && (cd ~/projects/bokli-cloud && npm ci)`.

## Deploy a new version

Only GitHub deploys (`.github/workflows/deploy-cloud.yml`); the local token cannot.
- **Production:** merge the PR, then create a release tag `vX.Y.Z` on `main` (GitHub → Releases → Draft a new
  release → new tag). The workflow checks the tag is on `main` and the database has no steps that commit lacks
  (so an older commit can still be released if no database step came after it), applies new database steps,
  deploys, and checks bokli.ktte.me still points to the Worker. `https://bokli.ktte.me/api/health` is behind the login; the
  version shows in Cloudflare (Workers & Pages → bokli → Deployments, message `vX.Y.Z <commit>`).
- **Try a change first:** `npm run cloud:local` (local Worker and database, fake data). There is no
  staging deploy any more (dropped 2026-10-16, so the deploy token only ever serves release tags).
- **Undo a bad deploy:** Cloudflare → Workers & Pages → bokli → Deployments → the previous version → Rollback.
- **Worker secrets** (`ACCESS_ALLOWED_EMAILS`, `HEALTHCHECK_URL`): Workers & Pages → bokli → Settings →
  Variables and Secrets.

## Nightly backup

A laptop cron runs `scripts/cloud-backup.sh production` from `~/projects/bokli-cloud` at 1 a.m.
(log: `~/bokli-cloud-backup.log`). It keeps 14 daily SQLite copies in `~/bokli-cloud-backups/` and on
Google Drive, and posts the result to Discord. Moving it off the laptop: issue #82.

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
