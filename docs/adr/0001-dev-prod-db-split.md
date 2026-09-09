# Bokli Dev/Prod Database Split

Status: Active (set up 2026-09-08)

## Context

During frontend/backend iterations we need to test against Bokli's API (month
closes, reopens, reconciliation) without polluting real family data. Originally
there was only one database: `data/bokli.db`, used by both the dev server
(`next dev`, port 3000) and production — every test write landed in prod data.

## Decision

Split dev and prod via the existing `BOKLI_DB_PATH` contract
(`src/db/index.ts`, documented in `.env.example`):

- `.env.local` at the repo root (git-ignored) sets
  `BOKLI_DB_PATH=/home/penguin/projects/bokli/data-dev/bokli.db`, so `next dev`
  writes only to `data-dev/bokli.db`.
- Dev-only seed credentials live in the same file
  (`BOKLI_MOM_PASSWORD` / `BOKLI_ADMIN_PASSWORD`) — they are not prod secrets.
- `data-dev/bokli.db` is created with `npm run db:push` (schema) +
  `npm run db:seed` (users `mom` = Operator, `katte` = Admin).
- Production keeps its own absolute `BOKLI_DB_PATH` (see `.env.example`)
  pointing at `data/bokli.db` and never reads `.env.local`.

This is a one-time setup: `.env.local` and `data-dev/` are plain files on disk,
unaffected by branch switches or new iterations.

## Consequences

- Testing (month closes, reopens, mismatches) is safe on the dev server.
- Reset a messy dev DB: delete `data-dev/bokli.db*`, re-run push + seed with
  `BOKLI_DB_PATH` pointed at it, restart dev server.
- Removing `.env.local` without a replacement `BOKLI_DB_PATH` silently falls
  back to the prod DB — do not remove it casually.
- `db:seed` requires both `BOKLI_*_PASSWORD` env vars (no defaults by design).
