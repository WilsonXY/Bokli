# Bokli Deployment Guide (Ubuntu Server & systemd)

This document provides the deployment guide and environment variable contract for Bokli on Ubuntu Server (Node v22).

---

## 1. Overview & Architecture

Bokli is deployed as a single-process modular monolith (per [ADR-0001](file:///home/penguin/projects/bokli/docs/adr/0001-modular-monolith-nextjs-sqlite.md)):
- **Runtime:** Ubuntu Server with Node.js v22 (LTS) executing Next.js in standalone mode (`.next-prod/standalone/server.js`). Production builds output to `.next-prod` so running `next dev` cannot clobber or delete production standalone artifacts.
- **Process Manager:** `systemd` user service (`systemctl --user`), running under the host user account (e.g. `penguin`).
- **Reboot Survival:** Enabled via `loginctl enable-linger $USER`, allowing the user service to boot automatically and persist across logouts and server restarts.
- **Database:** Single SQLite file with Write-Ahead Logging (`WAL` mode). The filesystem location is governed by `BOKLI_DB_PATH`, serving as the stable coupling point for the future Hermes backup job (ADR-0001, Spec User Story 18).
- **Authentication:** Credentials auth (Auth.js / NextAuth v5) using bcrypt password hashes and 30-day JWT sessions ([ADR-0003](file:///home/penguin/projects/bokli/docs/adr/0003-credentials-auth.md)).

---

## 2. Environment Variable Contract

All runtime configuration is managed via environment variables. The application loads defaults when variables are unset, and reads overrides from `.env` in the project root or the `systemd` unit environment.

A template is provided in [`.env.example`](file:///home/penguin/projects/bokli/.env.example).

| Variable | Required in Prod? | Default | Description & Contract |
| :--- | :--- | :--- | :--- |
| `PORT` | Optional | `3000` | HTTP port the Next.js standalone server listens on. Bound to `0.0.0.0` (all interfaces). |
| `NODE_ENV` | Yes | `production` | Set to `production` in production deployment. Enables secure cookie flags and optimized runtime. |
| `AUTH_SECRET` / `NEXTAUTH_SECRET` | **Yes** | Built-in fallback | High-entropy secret key (min 32 characters) used to sign and encrypt session tokens. Generate with `openssl rand -base64 32`. Both names are accepted interchangeably. |
| `AUTH_URL` / `NEXTAUTH_URL` | **Yes** | `http://localhost:3000` | Canonical public base URL for NextAuth redirects, callbacks, and cookie domains. MUST match the URL users actually visit (cookie scoping). Current prod: `https://bokli.ktte.me` (Cloudflare tunnel + Access). Dev: see `.env.local`. |
| `BOKLI_DB_PATH` | **Yes** | `<repo>/data/bokli.db` | Absolute filesystem path to the SQLite database file. **Critical:** Must be an absolute path (e.g. `/home/penguin/projects/bokli/data/bokli.db`) to ensure stability across working directory changes and as the coupling point for Hermes backups. |
| `BOKLI_MOM_PASSWORD` | **Yes (to seed)** | _none_ | Initial password used when executing `npm run db:seed` for the `mom` account (`Operator` role). Must be set explicitly — there is no default; `src/db/seed.ts` throws if it is unset. |
| `BOKLI_ADMIN_PASSWORD` | **Yes (to seed)** | _none_ | Initial password used when executing `npm run db:seed` for the `katte` account (`Admin` role). Must be set explicitly — there is no default; `src/db/seed.ts` throws if it is unset. |

### CLI Password Reset Contract
Family logins do not have self-registration or email recovery. Passwords can be reset at any time via the command-line utility:
```bash
npm run reset-password -- <username>
# Example:
npm run reset-password -- mom
npm run reset-password -- katte
```
Sessions are 30-day JWTs, so a password reset alone does **not** log out existing
sessions — `AUTH_SECRET` must be rotated afterwards (audit decision #6). The CLI
does not read `.env`/`.env.local`, so `BOKLI_DB_PATH` must be supplied on the
command line. Full procedure: [Runbook: Password Reset + AUTH_SECRET Rotation](../docs/runbook-password-reset.md).

---

## 3. Step-by-Step Installation on Ubuntu Server

### Step 3.1: System Requirements
Ensure Ubuntu Server has Node.js v22 and npm installed:
```bash
node -v   # Must be v22.x (e.g. v22.22.1)
npm -v    # npm v10+
```

### Step 3.2: Clone / Place Repository
Place the repository at a persistent path under the user's home directory (standard path: `~/projects/bokli`):
```bash
cd ~/projects/bokli
```

### Step 3.3: Configure Environment Variables
Copy `.env.example` to `.env` and set production secrets:
```bash
cp .env.example .env
chmod 600 .env
```
Edit `.env`:
```ini
PORT=5000
NODE_ENV=production
AUTH_SECRET=<output of openssl rand -base64 32>
NEXTAUTH_SECRET=<same as AUTH_SECRET>
AUTH_URL=https://bokli.ktte.me
NEXTAUTH_URL=https://bokli.ktte.me
BOKLI_DB_PATH=/home/penguin/projects/bokli/data/bokli.db
BOKLI_MOM_PASSWORD=<secure-password-for-mom>
BOKLI_ADMIN_PASSWORD=<secure-password-for-admin>
```

### Step 3.4: Install Dependencies & Build Application
```bash
# Clean install of dependencies
npm ci

# Build the Next.js application (generates .next-prod/standalone and copies static assets)
npm run build
```

### Step 3.5: Initialize Database & Seed Family Accounts
Run database schema migrations and seed the initial operator/admin logins:
```bash
# Apply migrations to the SQLite database specified by BOKLI_DB_PATH
npm run db:migrate

# Seed family users ('mom' and 'katte') idempotently.
# BOKLI_MOM_PASSWORD and BOKLI_ADMIN_PASSWORD must both be set (in .env or the
# environment) — seeding has no default passwords and refuses to run without them.
npm run db:seed
```

### Step 3.6: Install the systemd User Service
The systemd unit [`deploy/bokli.service`](file:///home/penguin/projects/bokli/deploy/bokli.service) runs under the user's systemd instance.

1. Create the systemd user service directory if it does not exist:
   ```bash
   mkdir -p ~/.config/systemd/user
   ```

2. Copy the unit file:
   ```bash
   cp deploy/bokli.service ~/.config/systemd/user/bokli.service
   ```

3. Reload user daemon configuration:
   ```bash
   systemctl --user daemon-reload
   ```

### Step 3.7: Enable Reboot Survival (User Lingering)
By default on Ubuntu, user systemd services only run while a user session is active. To make the service start automatically at boot and survive user logout/reboots:
```bash
loginctl enable-linger $USER
```
*(Verify with `loginctl show-user $USER --property=Linger` — should show `Linger=yes`)*.

### Step 3.8: Enable and Start the Service
```bash
systemctl --user enable --now bokli.service
```

---

## 4. Operational Runbook

### Service Management
- **Check service status:**
  ```bash
  systemctl --user status bokli.service
  ```
- **Stream live logs (stdout/stderr):**
  ```bash
  journalctl --user -u bokli.service -f
  ```
- **Restart the application (e.g. after code pull or env changes):**
  ```bash
  systemctl --user restart bokli.service
  ```
- **Stop the service:**
  ```bash
  systemctl --user stop bokli.service
  ```

### Health Check
Verify the server is running and responding:
```bash
curl -I http://localhost:5000/
# Should return HTTP/1.1 302 (redirect to /login) or 200
```

### Cloudflare Tunnel & Access (live since 2026-09-12/13)
- Connector: user service `cloudflared-bokli.service` running `cloudflared tunnel run bokli` (config `~/.cloudflared/config.yml`, ingress `bokli.ktte.me` → `http://localhost:5000`).
- DNS: CNAME `bokli.ktte.me` → tunnel (created via `cloudflared tunnel route dns`).
- Access gate: Cloudflare Zero Trust Access app on `bokli.ktte.me` — allow-listed emails with One-time PIN only. Requests without a valid Access session redirect to `<team>.cloudflareaccess.com` and never reach Bokli.
- Firewall: host ufw is default-deny; `sudo ufw allow 5000/tcp` was required for LAN access.

---

## 5. Database & Backup Contract (Hermes Coupling)

- **Location:** The database file is located at the path defined by `BOKLI_DB_PATH` (default: `~/projects/bokli/data/bokli.db`).
- **Journal Mode:** `WAL` (Write-Ahead Logging). During operation, `bokli.db-wal` and `bokli.db-shm` files may exist beside `bokli.db`.
- **Backup Readers (Hermes):** The future Hermes backup job reads directly from this stable path. To take safe, non-blocking online backups while the stall is operating:
  ```bash
  sqlite3 /home/penguin/projects/bokli/data/bokli.db ".backup /path/to/backup/bokli-$(date +%F).db"
  ```
  This creates an atomic snapshot without blocking active reads or writes by the operator.

---

## Build Stamp Verification (systemd-enforced)

Production may only run builds produced by `scripts/bokli_deploy.sh`. The service refuses to start otherwise.

**How it works:**
- The deploy script builds the release in a staging directory and writes `.next-prod/BUILD_MANIFEST` into that build before it is moved into the production checkout:
  ```
  TAG=<release tag>
  COMMIT=<full sha of the tag commit>
  BUILT_AT=<UTC ISO8601>
  DEPLOYED_BY=bokli_deploy.sh
  BUILD_ID=<Next.js build id>
  ```
- `deploy/bokli.service` declares `ExecStartPre=%h/projects/bokli/scripts/verify_build_stamp.sh` before `ExecStart`. On every start (or crash-restart), systemd first runs `scripts/verify_build_stamp.sh`, which fails (non-zero, with a clear stderr message) if the stamp file is missing, any field is empty/missing, `DEPLOYED_BY` is not `bokli_deploy.sh`, `COMMIT` does not match the currently checked-out `git rev-parse HEAD`, or `TAG` does not exist as a tag in the repo. systemd then never runs the server.

**If the service refuses to start** (`systemctl --user status bokli` shows the ExecStartPre failure):
1. Read the failure reason: `journalctl --user -u bokli -n 20 --no-pager`.
2. If `~/projects/.bokli-deploy-bokli/ACTIVE_CUTOVER` exists, a deploy was interrupted: run `--recover` (see [Recovery](#recovery-after-a-failed-or-interrupted-deploy)).
3. Otherwise re-run a full deploy for the release tag you want, **from the deployer checkout** (see [Deploying a release](#deploying-a-release-owner-procedure)).
Do NOT hand-edit or forge the stamp file; it is the audit trail that prod runs script-produced builds only.

---

## Deployment (release-tag flow)

Production only ever runs an audited release tag that points at the tip of `origin/main`
(or, for rollbacks, an ancestor of it). Design rationale: [ADR-0005](../docs/adr/0005-staged-production-deploy.md).

### How a deploy works

`scripts/bokli_deploy.sh` runs in two phases.

**Phase 1 — prepare (production untouched, the old service keeps serving):**
1. Refusal gates (see below), then `git fetch origin --tags --prune` in the production checkout.
2. `git archive <tag>` into a fresh staging directory `~/projects/.bokli-deploy-bokli/runs/<id>/src`.
3. Consistent online SQLite backup of the live DB (read-only connection, WAL-aware).
4. `npm ci` in staging, then **rehearse the pending migrations on the backup copy**
   (`tsx src/db/migrate.ts`) plus `PRAGMA integrity_check` and `foreign_key_check`.
5. `npm run build` in staging (`BOKLI_BUILD_DIR=.next-prod`); verify `BUILD_ID`,
   `standalone/server.js` and the standalone static assets
   (`standalone/.next-prod/static/<BUILD_ID>/_buildManifest.js`).
6. Smoke-test the candidate standalone server on a loopback port against a DB copy
   (throwaway `AUTH_SECRET`; the production `.env` is never read): `/login` must be 200 and the
   new build's static manifest must be served.
7. Write the build stamp into the staged build.
8. `fsync` every file and directory of the staged `.next-prod` and `node_modules`, and the
   fetched git `objects/`, `refs/` and `packed-refs` (the stamp check reads the tag from them).
   Cutover only *renames* these into place, which does not flush their contents. Takes a few
   seconds when the data has already been written back, up to ~30 s right after a build
   (measured: ~20k entries, a prod-sized build + `node_modules`, 3.6 s written back vs 29 s
   freshly written; git objects ~1 s), all while the old service still serves.

Any failure here exits `1` with *"production was not touched"*.

**Phase 2 — cutover (downtime starts at the stop):**
1. `systemctl --user stop bokli` and confirm it is stopped.
2. Fresh snapshot of the live DB → `runs/<id>/snapshot.db`, integrity-checked and
   content-compared with the live DB.
3. Migrate a *copy* of that snapshot, check it, fold its WAL in.
4. Swap DB files by rename: the original `bokli.db` (+ `-wal`/`-shm`) moves to
   `runs/<id>/prev-db/`, the migrated file takes its place.
5. Swap `.next-prod` and `node_modules` by rename (old ones kept in `runs/<id>/prev/`),
   then `git checkout --detach <tag>`; `fsync` the files the tag changed, their directories,
   `.git/HEAD` and `.git/index`; verify the stamp with the release's own `verify_build_stamp.sh`.
6. Smoke-test the build **at its live path** on a loopback port against a DB copy.
7. `systemctl --user start bokli`; success only when the unit is active, its main
   process runs from `<repo>/.next-prod/standalone`, `/login` is 200 on the service port
   and the **new** `BUILD_ID`'s static manifest is served (an old build cannot pass).

Each cutover step is recorded in the journal `~/projects/.bokli-deploy-bokli/ACTIVE_CUTOVER`
so an interrupted deploy (Ctrl-C, SSH drop, SIGKILL, power loss) can be recovered. Every
journal record is `fsync`ed, renamed into place and its directory `fsync`ed **before** the
step it names starts, and the DB/code swaps are `fsync`ed before the next phase is recorded.
If any `fsync` fails, the deploy stops. Before the service stop that means exit `1` with
production untouched; after it, the usual rollback rules apply.

Completion is recorded with a marker: once the new release is healthy, the deploy creates and
`fsync`s `runs/<id>/completion-pending`, then writes `PHASE=done`, and only after that record
is durable removes the marker (and `fsync`s the removal). While the marker exists, `--recover`
refuses (exit `3`) even when the journal reads `PHASE=done`: a failed `fsync` can leave that
record visible without it being on disk. If recording completion fails, the deploy exits `3`
(the new release may already hold writes) and never rolls the DB back.

### Refusal gates (all before any production change)
- Tag required, `^[A-Za-z0-9._-]+$`; must exist after fetch; must equal `origin/main`, or be
  an ancestor of it with `--allow-rollback`.
- The script must **not** live inside the production checkout, and its own checkout must be
  clean and exactly `origin/main` (so the newest released script always runs, including for rollbacks).
- `BOKLI_REPO_DIR` must be the `bokli` unit's `WorkingDirectory`, and the unit must run
  `<repo>/scripts/verify_build_stamp.sh` as `ExecStartPre` and `<node> .next-prod/standalone/server.js`.
- `BOKLI_DB_PATH` must be set explicitly as an **absolute** path and equal the DB the unit really
  uses (`.env` overrides the unit's `Environment=`); anything under `data-dev/` is refused. The
  unit's path must be absolute too: the app resolves a relative one from `.next-prod/standalone`,
  not from where the deploy runs. An empty `BOKLI_DB_PATH=` or `PORT=` line in `.env` is refused
  (systemd passes the empty value; it does not fall back to `Environment=`). So is an
  `export BOKLI_DB_PATH=` or `export PORT=` line: `.env` is read with systemd's `EnvironmentFile=`
  syntax, not by a shell, and systemd skips such a line, so the service would not use that value.
- `node` on `PATH` must be the same version as the unit's node (native modules).
- Production checkout: clean tracked files (untracked files are fine), and the **current**
  build stamp must verify — that release is what a failed cutover rolls back to.
- Single-deploy `flock` on `<repo>/.deploy.lock`; refused while a cutover journal is pending.
- The old test/skip seams (`BOKLI_DEPLOY_SKIP_*`, `BOKLI_DEPLOY_BUILD_CMD`,
  `BOKLI_DEPLOY_TEST_MODE`, `BOKLI_DEPLOY_HEALTHCHECK_URL`) are **refused**: they could report a
  success without a real migrate/build/restart/health check. The only accepted override is
  `BOKLI_DEPLOY_HEALTH_TIMEOUT_SECS` (1–600, default 60).

### Deploying a release (owner procedure)

**One-time setup — the deployer checkout.** Deploys never run the script that sits inside
`~/projects/bokli`. Create a separate plain clone (do not use `git worktree add` from the
production repo):
```bash
git clone https://github.com/WilsonXY/Bokli.git ~/projects/bokli-deployer
```
It needs no `npm install`; the deploy installs dependencies in its own staging directory.

**Every release:**
1. Merge the approved PR into `main` on GitHub.
2. Tag (owner-only): https://github.com/WilsonXY/Bokli/releases → **Draft a new release** →
   create tag `vX.Y.Z` on publish (target `main`), add notes, publish.
3. Move the deployer checkout to the new `origin/main` and confirm it is the tag:
   ```bash
   git -C ~/projects/bokli-deployer fetch origin --tags --prune
   git -C ~/projects/bokli-deployer checkout --detach origin/main
   git -C ~/projects/bokli-deployer describe --tags --exact-match   # must print vX.Y.Z
   ```
4. Deploy (the old service keeps serving while phase 1 runs, typically a few minutes):
   ```bash
   BOKLI_REPO_DIR=$HOME/projects/bokli \
   BOKLI_DB_PATH=$HOME/projects/bokli/data/bokli.db \
   ~/projects/bokli-deployer/scripts/bokli_deploy.sh vX.Y.Z
   ```
5. Read the result by exit code:
   | Exit | Meaning | Action |
   | :--- | :--- | :--- |
   | `0` | `✅ deployed vX.Y.Z …` — new build verified on the service port | Log in and check as usual. |
   | `1` | Refused, or failed in phase 1. Production was not touched. | Fix the cause, re-run. |
   | `2` | Cutover failed before the new release could accept writes; **ROLLED BACK** to the previous release and verified (HEAD, stamp, DB content = snapshot, old build serving). | Investigate, re-run later. |
   | `3` | **MANUAL RECOVERY REQUIRED** — see below. Further deploys are refused until resolved. | Follow [Recovery](#recovery-after-a-failed-or-interrupted-deploy). |

**First release after this change (the "first hop").** Production currently runs v1.1.1,
whose `~/projects/bokli/scripts/bokli_deploy.sh` is the old in-place script. **Never run that
file.** Use exactly the procedure above: the new script from `~/projects/bokli-deployer`,
with `BOKLI_REPO_DIR` pinned to `~/projects/bokli`. Before any change it checks that this
path is the `bokli` unit's `WorkingDirectory`, that `BOKLI_DB_PATH` is the unit's DB, and that
the current v1.1.1 stamp verifies. After the first hop, the copy inside `~/projects/bokli`
is the new script and refuses to run from there.

### Rollbacks
- **Application rollback** = deploy an earlier release tag, still with the newest script:
  ```bash
  BOKLI_REPO_DIR=$HOME/projects/bokli BOKLI_DB_PATH=$HOME/projects/bokli/data/bokli.db \
  ~/projects/bokli-deployer/scripts/bokli_deploy.sh --allow-rollback v1.1.0
  ```
  `--allow-rollback` is required whenever the tag is not the tip of `origin/main`; the tag must
  be an ancestor of `origin/main` (`git merge-base --is-ancestor`).
- **Database migrations only move forward.** A rollback keeps the migrated schema; design
  schema changes expand-and-contract so the previous release keeps working on it.

### Recovery after a failed or interrupted deploy

**Interrupted deploy** (terminal closed, SIGKILL, power loss — `ACTIVE_CUTOVER` exists):
```bash
BOKLI_REPO_DIR=$HOME/projects/bokli BOKLI_DB_PATH=$HOME/projects/bokli/data/bokli.db \
~/projects/bokli-deployer/scripts/bokli_deploy.sh --recover
```
`--recover` reads the journal.
- Interrupted **before the DB swap** (phases `stopping`/`stopped`): nothing was changed; it
  restarts the old release (exit `0`), also after a reboot.
- Interrupted **after the DB swap**: it rolls back automatically only if it can prove the
  service's main process has not run since the cutover stopped it, i.e. **same boot** and
  unchanged `ExecMainStartTimestampMonotonic`. It then restores the previous checkout,
  `.next-prod`, `node_modules` and the original DB files, proves it and restarts the old
  release (exit `0`).
- Journal at `PHASE=done` and no `completion-pending` marker in the run directory: the
  cutover had completed; it archives the journal (exit `0`). With the marker it exits `3`.
- Otherwise, **including any reboot after the DB swap**, it changes nothing and exits `3`.
  After a reboot systemd only knows about starts in the current boot, so a new release that ran
  and accepted writes before the reboot would be invisible.

**Exit `3` — MANUAL RECOVERY REQUIRED.** The script found that the new release's service may
have accepted writes (or it could not prove a rollback). It never restores the DB then, because
that would silently drop those writes. Katte decides; the options, in order of preference:

The run directory named in the message (`~/projects/.bokli-deploy-bokli/runs/<id>/`) holds
`snapshot.db` (verified, pre-migration, taken after the stop), `prev-db/` (the original DB
files), `prev/` (previous `.next-prod`, `node_modules`) and `phases.log`. The journal holds
`OLD_HEAD`, `OLD_TAG`, `TAG`.

1. Diagnose: `systemctl --user status bokli`, `journalctl --user -u bokli -n 100 --no-pager`,
   `cat ~/projects/.bokli-deploy-bokli/ACTIVE_CUTOVER`.
2. **A. Keep the new release** (it works, or the fix is a quick follow-up release):
   verify `(cd ~/projects/bokli && ./scripts/verify_build_stamp.sh)` and that the site works.
3. **B. Code-only rollback, keep the DB and its new writes** (needs the previous release to
   work on the migrated schema — the expand-and-contract rule):
   ```bash
   RUN=~/projects/.bokli-deploy-bokli/runs/<id>
   systemctl --user stop bokli
   mv ~/projects/bokli/.next-prod    $RUN/manual-new-next-prod  && mv $RUN/prev/.next-prod    ~/projects/bokli/.next-prod
   mv ~/projects/bokli/node_modules  $RUN/manual-new-node_modules && mv $RUN/prev/node_modules ~/projects/bokli/node_modules
   git -C ~/projects/bokli checkout --detach <OLD_HEAD>
   (cd ~/projects/bokli && ./scripts/verify_build_stamp.sh) && systemctl --user start bokli
   ```
4. **C. Restore the pre-deploy DB** — **discards every write since the snapshot.** Only on
   Katte's explicit decision, after the new writes are recorded elsewhere (e.g. copied onto paper):
   ```bash
   systemctl --user stop bokli
   mkdir $RUN/manual-discarded-db
   for s in -wal -shm ""; do [ -e ~/projects/bokli/data/bokli.db$s ] && mv ~/projects/bokli/data/bokli.db$s $RUN/manual-discarded-db/; done
   cp $RUN/snapshot.db ~/projects/bokli/data/bokli.db.restore && mv ~/projects/bokli/data/bokli.db.restore ~/projects/bokli/data/bokli.db
   sqlite3 ~/projects/bokli/data/bokli.db 'PRAGMA integrity_check;'   # must print ok
   ```
   then do the code rollback in B.
5. When production is in the chosen state, archive the journal so deploys are allowed again
   (and remove the completion marker, if the message named it):
   ```bash
   mv ~/projects/.bokli-deploy-bokli/ACTIVE_CUTOVER $RUN/journal.manual
   rm -f $RUN/completion-pending
   ```

If `--recover` reports a stale `.git/index.lock` in `~/projects/bokli` (git was killed
mid-checkout), confirm no git process is running (`pgrep -a git`), remove the lock and re-run `--recover`.

### Retention of run directories (they contain production data)
Each run directory holds DB copies (`snapshot.db`, `prev-db/`) plus the previous build and
`node_modules`. `~/projects/.bokli-deploy-bokli/` is mode 700.
- **Automatic:** after each **successful** deploy the script keeps this run and **one prior
  successful run** (runs containing `journal.done`), and deletes older successful runs
  (`Pruned old completed run <id>`). Nothing is pruned after a failed deploy, or while a
  cutover journal is pending.
- **Never pruned automatically:** runs that rolled back (`journal.rolled-back`), runs you
  archived after manual recovery (`journal.manual`), and runs without a journal (failed in
  phase 1, or incomplete). Phase-1 failures already delete their DB copies and staging tree.
  Delete rolled-back or manual runs by hand once they are no longer needed:
  ```bash
  ls -1 ~/projects/.bokli-deploy-bokli/runs/*/journal.*
  ```
- Pruning only ever touches `~/projects/.bokli-deploy-bokli/runs/<timestamp>-<pid>/`.
  The nightly DB backups and everything else outside that directory are never touched.

### Residual limitations (not zero downtime)
- **Downtime** runs from the stop to the healthy start: snapshot, migration of the copy, file
  swaps, live-path smoke test and start. Measured at about 7 s in a real-app rehearsal on a
  small DB; it grows with DB size. Users see errors or the tunnel's error page meanwhile.
- **A new release that accepts writes and then fails** cannot be rolled back automatically;
  exit `3` hands the decision to Katte (see above).
- **Reboot mid-cutover:** the enabled unit may start at boot with whatever is on disk and
  passes `ExecStartPre`. After a reboot past the DB swap, `--recover` always refuses to touch
  the DB (exit `3`), even when the new release never actually ran. This is deliberately
  conservative, and those cases then need the manual procedure.
- **Build relocation:** the build is made in the staging path and moved. Next.js standalone
  output embeds that path in some strings. This worked in the real-app rehearsal, and the
  live-path smoke test runs before start, so a future Next.js version that breaks relocation
  fails into an automatic rollback, not an outage.
- **Phase 1 needs the npm registry** (`npm ci`) and roughly 1 GB RAM for `next build` while
  the old service keeps running.
- **The old in-place script** in the v1.1.1 checkout stays runnable until the first hop; only
  discipline prevents running it (see "First release after this change").
- **Power loss** is covered by `fsync` ordering, not by a power-cut test. The tests inject real
  `fsync` errors (strace) but cannot simulate a lost disk cache. Of the checkout, only the files
  the tag changed (plus their directories, `HEAD` and `index`) are `fsync`ed; unchanged tracked
  files are assumed durable from earlier deploys. A rollback repairs a torn checkout with
  `git checkout --force`, as long as the git objects themselves survived, and `fsync`s the same
  set (files that differ between the two releases, their directories, `HEAD`, `index`) before it
  restarts the old service and archives the journal; if that fails it exits `3`.
- Tests use a fake `systemctl`. The systemd behaviour the script relies on
  (`show` output format, `ExecMainStartTimestampMonotonic` kept after stop and reset by reboot)
  was checked read-only against the live unit and the systemd docs, not with a real
  systemd integration test.
