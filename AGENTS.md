# AGENTS.md — Bokli

Working rules for any agent (Hermes, T3 Code/Antigravity, OpenCode) touching this repo.
Human = Katte; only he merges, deploys, and approves PRs.

## Domain language
`CONTEXT.md` is the glossary. Use those exact terms; never the "Avoid" synonyms.

## Knowledge Base (vault) — READ-ONLY for agents
Project facts and decisions live in a markdown vault maintained by Katte and the
driver agent (path is machine-specific; the driver agent supplies it). Treat the
vault as read-only context: read it to ground your work, but do NOT write, edit,
or create files there. If you learn something that belongs in the vault, include
it in your report — the driver agent filters and records it.

## Database (critical)
- Prod DB lives at `data/bokli.db` (relative to repo root); dev DB at `data-dev/`.
- The active DB is selected ONLY via the `BOKLI_DB_PATH` env var, normally set in
  `.env.local` (git-ignored) for dev and `.env` / the systemd unit for prod.
  There is NO fallback: if `BOKLI_DB_PATH` is unset, the app, migrations, and
  drizzle-kit throw a hard error. Never "fix" that error by pointing dev at the
  prod DB path.
- Any destructive command on a DB: first verify the resolved path points at
  `data-dev/`.

## Verification (before claiming any change done)
```bash
npx tsc --noEmit
npm run test:unit      # fast (~20 s)
npm run test:deploy    # slow (~13 min): when touching scripts/, deploy/, drizzle/, src/db/,
                       # package*.json, next/vitest config, .nvmrc or .github/workflows/
```
`npm test` runs both. Auth-related changes also require the login smoke test:
`npm run build && npm run smoke:ci`. It uses a throwaway DB and a temporary
server on 127.0.0.1:3999 that it stops itself; it is not a preview (see Dev preview).

CI (`.github/workflows/ci.yml`) runs on every PR and gates merging: `check`
(typecheck, unit tests, schema changes have a migration), `build` (production
build + login smoke test) and `deploy-scripts` (on PRs only when deploy-related
paths change). A PR is not done until `gh pr checks` is green.

## Git & deploy (hard rules)
- Never commit straight to `main`; never push without the checks above passing.
- NEVER merge or deploy without Katte's explicit per-PR approval.
- Deploy flow and tag rules are documented in the vault's Deployment note —
  follow it; don't improvise.

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
- The script is the only allowed way. NEVER start your own dev server (`next dev`,
  `npm run dev`), use Tailscale/ngrok/`tailscale serve`, edit AUTH_URL/NEXTAUTH_URL
  in `.env.local`, or `pkill next-server` (prod on :5000 has the same name). It holds
  a lock: if another preview is running, wait and retry; don't work around it.
- It only checks page + CSS load and cannot log in: say Katte must verify the feature.
- It switches the shared dev folder to your branch (detached), replacing the previous
  preview: say in your report which branch the dev site now shows.

## Status & reporting
- Escalate decisions, don't assume them. Mid-task plan changes → ask the driver
  agent / Katte first (unless already agreed). Scope drift in a fix round → stop
  and escalate.
- Report: what changed, verification results, what Katte must decide. No filler.
