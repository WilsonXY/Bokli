# AGENTS.md — Bokli

Working rules for any agent (Hermes, T3 Code/Antigravity, OpenCode) touching this repo.
Human = Katte; only he merges, deploys, and approves PRs.

## Domain language
`CONTEXT.md` is the glossary. Use those exact terms; never the "Avoid" synonyms.

## Knowledge Base (vault): out of date, read-only
The markdown vault (path is machine-specific) has not been maintained since
mid-October 2026 and is marked [OUT OF DATE]. Do not rely on it; this repo
(`docs/`, this file) is the source of truth. Never write to it.

## Where it runs
Production is Cloudflare only: static pages from `npm run build` (`out/`), the
Worker in `workers/`, and the D1 database `bokli`. The laptop server was retired
on 2026-11-01. `docs/runbook-cloud.md` covers deploys, backups and restores.
- Never run a command against the remote D1 database (`--remote`) unless Katte
  asked for it in this task. Use `npm run cloud:local` or the tests (fake data).
- `src/services/` and `src/db/index.ts` (SQLite) no longer run in production.
  They stay as the reference the Worker tests compare against; tests pass their
  own temp DB via `BOKLI_DB_PATH`.

## Verification (before claiming any change done)
```bash
npx tsc --noEmit
npm run lint           # ESLint, zero warnings allowed
npm run test:unit      # fast (~20 s)
npm run test:d1        # Worker + local D1 tests: when touching workers/, drizzle/,
                       # src/db/, src/lib/ or src/services/
npm run test:deploy    # Worker bundle + migration folder: when touching workers/,
                       # drizzle/, package*.json or .nvmrc
npm run build          # static pages into out/
```

UI or user-visible changes also need proof of the changed interaction:
`node scripts/cloud-verify.mjs <flow.mjs> [mom|katte] [--mobile]`. It builds, starts
the local Worker with fake data and test logins on a free 127.0.0.1 port, and stops
it itself (not a preview, so the dev-server ban below does not apply). It records
video + screenshots under `.evidence/<sha>/`; `scripts/cloud-flows/` has examples.
Run it on the final commit (after review fixes) and attach the files to the PR:
`gh pr edit <n> --attach <file>`.

CI (`.github/workflows/ci.yml`) runs on every PR and gates merging: `check`
(typecheck, lint, unit tests, schema changes have a migration), `build` (static
build), `deploy-scripts` (Worker bundle and migration-folder tests) and
`d1-foundation` (`test:d1`). A PR is not done until `gh pr checks` is green.

## Git & deploy (hard rules)
- Never commit straight to `main`; never push without the checks above passing.
- NEVER merge or deploy without Katte's explicit per-PR approval.
- Deploys happen only through a `vX.Y.Z` release tag, which only Katte creates
  (`docs/runbook-cloud.md`). Don't improvise.

## Workflow
Every task runs the full cycle: implement on a feature branch, verify,
independent review, commit, push, open the PR against `main`, fix CI and review
comments, then report. Don't stop to ask permission to commit, push the feature
branch, or open the PR; merge and deploy stay with Katte (see Git & deploy).

Start with the `full-cycle` skill; it owns the order of steps. Then use:
- Bug or failing test, cause unknown → `systematic-debugging`
- New behaviour or bug fix → `test-driven-development`
- Test or build over a minute → `long-running-commands`
- Before opening a PR → `requesting-code-review`
- Commit, PR, CI, review comments → `github`

The skills are installed at user level on this machine (`~/.claude/skills`).
Skill details live in the skills, not in this file.

### Dev preview
- When Katte asks to try a change (or it is user-visible and you'd write "please
  test it"): push the branch, run `bash ~/.hermes/scripts/bokli_preview.sh <branch>`.
  Only READY confirms https://boklidev.ktte.me serves it: send Katte that link plus
  1-2 concrete things to try. Otherwise report the output; don't claim it's ready.
- The script is the only allowed way. NEVER start your own long-running server for
  Katte (`npm run cloud:local`, `wrangler dev`) or expose ports with
  Tailscale/ngrok/`tailscale serve`. It holds a lock: if another preview is
  running, wait and retry; don't work around it.
- It runs the local Worker behind Cloudflare Access with fake data that resets on
  every preview. It only checks page + CSS load and cannot log in: say Katte must
  verify the feature.
- It switches the shared dev folder to your branch (detached), replacing the previous
  preview: say in your report which branch the dev site now shows.

## Status & reporting
- Escalate decisions, don't assume them. Mid-task plan changes → ask the driver
  agent / Katte first (unless already agreed). Scope drift in a fix round → stop
  and escalate.
- Report: what changed, verification results, what Katte must decide. No filler.
