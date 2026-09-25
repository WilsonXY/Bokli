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
npm test
```
Auth-related changes also require the login smoke test (see repo `scripts/`).

## Git & deploy (hard rules)
- Never commit straight to `main`; never push without the checks above passing.
- NEVER merge or deploy without Katte's explicit per-PR approval.
- Deploy flow and tag rules are documented in the vault's Deployment note —
  follow it; don't improvise.

## Status & reporting
- Escalate decisions, don't assume them. Mid-task plan changes → ask the driver
  agent / Katte first (unless already agreed). Scope drift in a fix round → stop
  and escalate.
- Report: what changed, verification results, what Katte must decide. No filler.
