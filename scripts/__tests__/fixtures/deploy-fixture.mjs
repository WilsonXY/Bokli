// Disposable production-like fixture for scripts/bokli_deploy.sh tests.
//
// Everything lives under one mkdtemp() directory and is deleted afterwards:
//   origin.git/          bare "GitHub" origin with release tags
//   author/              clone used to create commits/tags (the "maintainer")
//   prod/bokli/          the LIVE checkout the fake service runs from
//   prod/bokli/data/     the LIVE SQLite database (a throwaway fixture DB)
//   deployer/            separate checkout holding the NEW deploy script
//   bin/systemctl        fake `systemctl --user` for the single `bokli` unit
//   sd/                  fake systemd state (pid, main-start timestamp, calls.log)
//
// The fixture app is tiny but exercises the real commands the deploy script
// runs: `npm ci` (offline, local file: dependency), `npm run build`,
// `node_modules/.bin/tsx src/db/migrate.ts` and `node .next-prod/standalone/server.js`.
// Its build writes the same layout as the real Next.js standalone build
// (.next-prod/BUILD_ID, .next-prod/static/<id>/_buildManifest.js,
// .next-prod/standalone/{server.js,.next-prod/static}).
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEV_REPO = path.resolve(__dirname, "../../..");
export const NEW_DEPLOY_SCRIPT = path.join(DEV_REPO, "scripts/bokli_deploy.sh");
export const VERIFY_SCRIPT = path.join(DEV_REPO, "scripts/verify_build_stamp.sh");
export const LEGACY_DEPLOY_SCRIPT = path.join(__dirname, "legacy-bokli_deploy-v1.1.1.sh");

export function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  });
}

export function git(args, cwd) {
  return sh("git", args, { cwd }).trim();
}

export function sqlite(db, sql) {
  return sh("sqlite3", ["-bail", db, sql]).trim();
}

/** Logical DB content, read without modifying the files (read-only URI). */
export function dbDump(db) {
  return sh("sqlite3", [`file:${db}?mode=ro`, ".dump"]);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

/** sha256 over every file (relative path + content) under dir; null if dir is absent. */
export function treeDigest(dir) {
  if (!fs.existsSync(dir)) return null;
  const out = sh("bash", [
    "-c",
    'cd "$1" && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 -r sha256sum | sha256sum',
    "_",
    dir,
  ]);
  return out.split(" ")[0];
}

export function httpCode(url) {
  const r = spawnSync("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "3", url], {
    encoding: "utf-8",
  });
  return r.stdout.trim();
}

// ---------------------------------------------------------------------------
// Fixture app source
// ---------------------------------------------------------------------------

const FAKE_TSX_PKG = JSON.stringify({ name: "tsx", version: "0.0.0-fixture", bin: { tsx: "cli.js" } }, null, 2);

// Minimal stand-in for tsx: runs the given (plain JS) .ts file as CommonJS.
const FAKE_TSX_CLI = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const file = path.resolve(process.argv[2]);
process.argv = [process.argv[0], file, ...process.argv.slice(3)];
const m = new Module(file, null);
m.filename = file;
m.paths = Module._nodeModulePaths(path.dirname(file));
m._compile(fs.readFileSync(file, "utf8"), file);
`;

// Forward-only migrator, same contract as src/db/migrate.ts: BOKLI_DB_PATH is
// required, migrations are read from ./drizzle, each runs in a transaction.
// Deliberately does NOT close the DB, so committed frames may stay in the WAL.
const FIXTURE_MIGRATE = `const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const path = require("node:path");
const dbPath = process.env.BOKLI_DB_PATH;
if (!dbPath || !dbPath.trim()) throw new Error("BOKLI_DB_PATH is not set. Refusing to guess a database path.");
const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode=WAL");
db.exec("PRAGMA wal_autocheckpoint=0");
db.exec("CREATE TABLE IF NOT EXISTS __migrations (name TEXT PRIMARY KEY)");
const dir = path.resolve(process.cwd(), "drizzle");
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
  if (db.prepare("SELECT 1 FROM __migrations WHERE name = ?").get(f)) continue;
  db.exec("BEGIN");
  try {
    db.exec(fs.readFileSync(path.join(dir, f), "utf8"));
    db.prepare("INSERT INTO __migrations (name) VALUES (?)").run(f);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
console.log("Migrations applied successfully.");
`;

// Fake Next.js standalone server. Behaviour is baked from release.json at build time.
const SERVER_TEMPLATE = `const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
process.chdir(__dirname);
const release = __RELEASE__;
const port = parseInt(process.env.PORT, 10);
const host = process.env.HOSTNAME || "0.0.0.0";
if (!process.env.BOKLI_DB_PATH) { console.error("BOKLI_DB_PATH is required"); process.exit(1); }
if (release.writeOnStart) {
  // Simulates the new release accepting a real user write as soon as it runs.
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(process.env.BOKLI_DB_PATH);
  db.exec("PRAGMA journal_mode=WAL");
  db.prepare("INSERT INTO sheets (note) VALUES (?)").run("written-by-" + release.version + "-" + process.pid);
  db.close();
}
const staticRoot = path.join(__dirname, ".next-prod", "static");
http.createServer((req, res) => {
  if (req.url === "/login") {
    const broken = release.failOnDbName && path.basename(process.env.BOKLI_DB_PATH) === release.failOnDbName;
    res.writeHead(broken ? 500 : release.loginStatus || 200); res.end("login " + release.version); return;
  }
  if (req.url.startsWith("/_next/static/")) {
    const p = path.join(staticRoot, decodeURIComponent(req.url.slice("/_next/static/".length)));
    if (p.startsWith(staticRoot + path.sep) && fs.existsSync(p) && fs.statSync(p).isFile()) {
      res.writeHead(200); res.end(fs.readFileSync(p)); return;
    }
  }
  res.writeHead(404); res.end("not found");
}).listen(port, host);
`;

// Fixture build: same output layout as `next build` (standalone) + the static copy step.
const FIXTURE_BUILD = `import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
const release = JSON.parse(fs.readFileSync("release.json", "utf8"));
const dist = process.env.BOKLI_BUILD_DIR || ".next-prod";
fs.rmSync(dist, { recursive: true, force: true }); // like Next's cleanDistDir
fs.mkdirSync(dist, { recursive: true });
fs.writeFileSync(path.join(dist, "partial-output"), "build started\\n");
if (release.buildFail) { console.error("fixture build failed on purpose"); process.exit(1); }
const id = release.version.replace(/[^A-Za-z0-9]/g, "_") + "_" + crypto.randomBytes(4).toString("hex");
fs.mkdirSync(path.join(dist, "static", id), { recursive: true });
fs.writeFileSync(path.join(dist, "static", id, "_buildManifest.js"), "self.__BUILD_MANIFEST={};\\n");
fs.writeFileSync(path.join(dist, "BUILD_ID"), id);
const sa = path.join(dist, "standalone");
fs.mkdirSync(path.join(sa, ".next-prod"), { recursive: true });
fs.writeFileSync(path.join(sa, "server.js"), fs.readFileSync("server.template.js", "utf8").replace("__RELEASE__", JSON.stringify(release)));
fs.writeFileSync(path.join(sa, ".next-prod", "BUILD_ID"), id);
if (!release.skipStaticCopy) fs.cpSync(path.join(dist, "static"), path.join(sa, ".next-prod", "static"), { recursive: true });
console.log("fixture build ok " + id);
`;

const FIXTURE_PACKAGE = JSON.stringify(
  {
    name: "bokli-deploy-fixture",
    version: "1.0.0",
    private: true,
    scripts: { build: "node build.mjs" },
    devDependencies: { tsx: "file:vendor/tsx" },
  },
  null,
  2
);

const FIXTURE_GITIGNORE = `node_modules/
.next-prod/
data/
.env
.deploy.lock
`;

const MIGRATION_0000 = "CREATE TABLE sheets (id INTEGER PRIMARY KEY, note TEXT NOT NULL);\n";
// v1.1.x migration: data-dependent (UNIQUE fails if duplicate notes exist).
const MIGRATION_0001 =
  "ALTER TABLE sheets ADD COLUMN amount INTEGER NOT NULL DEFAULT 0;\nCREATE UNIQUE INDEX sheets_note_unique ON sheets (note);\n";

// ---------------------------------------------------------------------------
// Fake systemctl (only `--user <verb> bokli`)
// ---------------------------------------------------------------------------

export const FAKE_SYSTEMCTL = `#!/usr/bin/env bash
# Fake 'systemctl --user' for the fixture 'bokli' unit. Mirrors deploy/bokli.service:
# ExecStartPre runs the checkout's real scripts/verify_build_stamp.sh, ExecStart runs
# node .next-prod/standalone/server.js from WorkingDirectory with unit env + .env.
set -uo pipefail
exec 9>&-  # never inherit the deploy lock fd into the "service"
SD="__SD__"
. "$SD/unit.conf"
[ "\${1:-}" = "--user" ] || { echo "fake systemctl: only --user is supported" >&2; exit 2; }
shift
verb="\${1:-}"; shift || true
echo "$verb $*" >> "$SD/calls.log"

alive() { [ -f "$SD/pid" ] && kill -0 "$(cat "$SD/pid")" 2>/dev/null; }
deployer_pid() { sed -n 's/^PID=//p' "$JOURNAL" 2>/dev/null | tail -n 1; }
hook() { # one-shot failure injection: $SD/inject.<event> holds the action
  local f="$SD/inject.$1" action
  [ -f "$f" ] || return 0
  action="$(cat "$f")"; rm -f "$f"
  echo "inject $1 $action" >> "$SD/calls.log"
  case "$action" in
    kill9-deployer) kill -9 "$(deployer_pid)"; exit 1 ;;
    term-deployer) kill -TERM "$(deployer_pid)" ;;
    sql:*) sqlite3 "$DB" "\${action#sql:}" ;;
    start-old) START_DIR="$SD/oldbuild/standalone" ;;
    fail) exit 1 ;;
  esac
}
spawn_main() { # $1 = directory holding server.js
  (
    cd "$WORKDIR" || exit 1
    set -a
    for kv in $UNIT_ENV; do export "$kv"; done
    if [ -f "$ENVFILE" ]; then . "$ENVFILE"; fi
    set +a
    exec "$NODE_BIN" "$1/server.js"
  ) </dev/null >>"$SD/service.log" 2>&1 &
  echo $! > "$SD/pid"
  date +%s%N > "$SD/mainstart"
}
do_stop() {
  hook stop-before
  if alive; then
    local p; p="$(cat "$SD/pid")"
    kill "$p" 2>/dev/null
    for _ in $(seq 1 50); do kill -0 "$p" 2>/dev/null || break; sleep 0.1; done
    kill -9 "$p" 2>/dev/null || true
  fi
  rm -f "$SD/pid"
  hook stop-after
}
do_start() {
  alive && return 0
  START_DIR="$WORKDIR/.next-prod/standalone"
  hook start-before
  if ! (cd "$WORKDIR" && ./scripts/verify_build_stamp.sh) >>"$SD/service.log" 2>&1; then
    echo "ExecStartPre failed" >> "$SD/calls.log"
    return 1
  fi
  spawn_main "$START_DIR"
  hook start-after
}

case "$verb" in
  show)
    unit="$1"; prop=""; value=0
    shift
    for a in "$@"; do
      case "$a" in --property=*) prop="\${a#--property=}" ;; --value) value=1 ;; esac
    done
    [ "$unit" = "bokli" ] && [ "$value" = 1 ] || { echo "fake systemctl: unsupported show" >&2; exit 2; }
    case "$prop" in
      LoadState) echo loaded ;;
      WorkingDirectory) echo "$WORKDIR" ;;
      Environment) echo "$UNIT_ENV" ;;
      EnvironmentFiles) echo "$ENVFILE (ignore_errors=yes)" ;;
      ExecStartPre) echo "{ path=$WORKDIR/scripts/verify_build_stamp.sh ; argv[]=$WORKDIR/scripts/verify_build_stamp.sh ; ignore_errors=no ; start_time=[n/a] ; stop_time=[n/a] ; pid=0 ; code=(null) ; status=0/0 }" ;;
      ExecStart) echo "{ path=$NODE_BIN ; argv[]=$NODE_BIN .next-prod/standalone/server.js ; ignore_errors=no ; start_time=[n/a] ; stop_time=[n/a] ; pid=0 ; code=(null) ; status=0/0 }" ;;
      MainPID) if alive; then cat "$SD/pid"; else echo 0; fi ;;
      ExecMainStartTimestampMonotonic) cat "$SD/mainstart" 2>/dev/null || echo 0 ;;
      ActiveState) if alive; then echo active; else echo inactive; fi ;;
      *) echo "" ;;
    esac
    ;;
  is-active)
    if alive; then echo active; exit 0; else echo inactive; exit 3; fi ;;
  stop) do_stop ;;
  start) do_start ;;
  restart) do_stop; do_start ;;
  *) echo "fake systemctl: unsupported verb $verb" >&2; exit 2 ;;
esac
`;

// ---------------------------------------------------------------------------
// Fixture lifecycle
// ---------------------------------------------------------------------------

function writeAppSource(dir, release, { deployScript, extraMigrations = {} }) {
  fs.mkdirSync(path.join(dir, "vendor/tsx"), { recursive: true });
  fs.mkdirSync(path.join(dir, "src/db"), { recursive: true });
  fs.mkdirSync(path.join(dir, "drizzle"), { recursive: true });
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "vendor/tsx/package.json"), FAKE_TSX_PKG);
  fs.writeFileSync(path.join(dir, "vendor/tsx/cli.js"), FAKE_TSX_CLI, { mode: 0o755 });
  fs.writeFileSync(path.join(dir, "src/db/migrate.ts"), FIXTURE_MIGRATE);
  fs.writeFileSync(path.join(dir, "build.mjs"), FIXTURE_BUILD);
  fs.writeFileSync(path.join(dir, "server.template.js"), SERVER_TEMPLATE);
  fs.writeFileSync(path.join(dir, "package.json"), FIXTURE_PACKAGE);
  fs.writeFileSync(path.join(dir, ".gitignore"), FIXTURE_GITIGNORE);
  fs.writeFileSync(path.join(dir, "README.md"), "# Bokli deploy fixture\n");
  fs.writeFileSync(path.join(dir, "release.json"), JSON.stringify(release, null, 2) + "\n");
  fs.writeFileSync(path.join(dir, "drizzle/0000_init.sql"), MIGRATION_0000);
  for (const [name, sql] of Object.entries(extraMigrations)) {
    fs.writeFileSync(path.join(dir, "drizzle", name), sql);
  }
  fs.copyFileSync(deployScript, path.join(dir, "scripts/bokli_deploy.sh"));
  fs.chmodSync(path.join(dir, "scripts/bokli_deploy.sh"), 0o755);
  fs.copyFileSync(VERIFY_SCRIPT, path.join(dir, "scripts/verify_build_stamp.sh"));
  fs.chmodSync(path.join(dir, "scripts/verify_build_stamp.sh"), 0o755);
}

const NPM_ENV = { ...process.env, npm_config_offline: "true", npm_config_audit: "false", npm_config_fund: "false" };
delete NPM_ENV.NODE_ENV;

/**
 * Creates the full fixture: origin with v1.0.0 (legacy script) deployed live and
 * running, plus v1.1.0 (the new script, migration 0001) as origin/main tip and a
 * separate deployer checkout at origin/main.
 */
export async function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bokli-deploy-fx-"));
  const f = {
    root,
    origin: path.join(root, "origin.git"),
    author: path.join(root, "author"),
    live: path.join(root, "prod", "bokli"),
    deployer: path.join(root, "deployer"),
    bin: path.join(root, "bin"),
    sd: path.join(root, "sd"),
    stateDir: path.join(root, "prod", ".bokli-deploy-bokli"),
    port: await freePort(),
  };
  f.db = path.join(f.live, "data", "bokli.db");
  f.journal = path.join(f.stateDir, "ACTIVE_CUTOVER");
  f.nodeBin = sh("bash", ["-c", "command -v node"]).trim();

  // Origin + author clone
  git(["init", "--bare", "-b", "main", f.origin], root);
  git(["clone", f.origin, f.author], root);
  for (const [k, v] of [
    ["user.email", "deploy-test@example.com"],
    ["user.name", "Deploy Test"],
    ["commit.gpgsign", "false"],
    ["tag.gpgsign", "false"],
  ]) {
    git(["config", k, v], f.author);
  }
  git(["checkout", "-b", "main"], f.author);

  // v1.0.0: what production runs today, including the LEGACY deploy script.
  writeAppSource(f.author, { version: "v1.0.0" }, { deployScript: LEGACY_DEPLOY_SCRIPT });
  sh("npm", ["install", "--package-lock-only"], { cwd: f.author, env: NPM_ENV });
  git(["add", "-A"], f.author);
  git(["commit", "-m", "v1.0.0"], f.author);
  git(["tag", "-a", "v1.0.0", "-m", "v1.0.0"], f.author);
  git(["push", "origin", "main", "v1.0.0"], f.author);

  // Live checkout at v1.0.0, built + stamped exactly like the legacy deploy did.
  fs.mkdirSync(path.dirname(f.live), { recursive: true });
  git(["clone", f.origin, f.live], root);
  git(["checkout", "--quiet", "--detach", "v1.0.0"], f.live);
  fs.writeFileSync(path.join(f.live, ".env"), `PORT=${f.port}\nBOKLI_DB_PATH=${f.db}\n`);
  sh("npm", ["ci"], { cwd: f.live, env: NPM_ENV });
  sh("npm", ["run", "build"], { cwd: f.live, env: { ...NPM_ENV, BOKLI_BUILD_DIR: ".next-prod" } });
  fs.mkdirSync(path.dirname(f.db), { recursive: true });
  sh(path.join(f.live, "node_modules/.bin/tsx"), ["src/db/migrate.ts"], {
    cwd: f.live,
    env: { ...NPM_ENV, BOKLI_DB_PATH: f.db },
  });
  sqlite(f.db, "INSERT INTO sheets (note) VALUES ('day-1'), ('day-2'), ('dup');");
  fs.writeFileSync(
    path.join(f.live, ".next-prod/BUILD_MANIFEST"),
    `TAG=v1.0.0\nCOMMIT=${git(["rev-parse", "HEAD"], f.live)}\nBUILT_AT=2026-01-01T00:00:00Z\nDEPLOYED_BY=bokli_deploy.sh\n`
  );
  fs.writeFileSync(path.join(f.live, ".next-prod/OLD-ARTIFACT-SENTINEL"), "old build\n");
  f.oldBuildId = fs.readFileSync(path.join(f.live, ".next-prod/BUILD_ID"), "utf-8").trim();
  f.oldHead = git(["rev-parse", "HEAD"], f.live);

  // Fake systemd user unit. Unit PORT is deliberately wrong; .env overrides it
  // (EnvironmentFile wins over Environment=, as in production).
  fs.mkdirSync(f.sd, { recursive: true });
  fs.mkdirSync(f.bin, { recursive: true });
  fs.writeFileSync(
    path.join(f.sd, "unit.conf"),
    [
      `WORKDIR='${f.live}'`,
      `UNIT_ENV='NODE_ENV=production PORT=1 BOKLI_DB_PATH=${f.db}'`,
      `ENVFILE='${path.join(f.live, ".env")}'`,
      `NODE_BIN='${f.nodeBin}'`,
      `JOURNAL='${f.journal}'`,
      `DB='${f.db}'`,
      "",
    ].join("\n")
  );
  fs.writeFileSync(path.join(f.bin, "systemctl"), FAKE_SYSTEMCTL.replace("__SD__", f.sd), { mode: 0o755 });
  f.env = {
    ...process.env,
    PATH: `${f.bin}:${process.env.PATH}`,
    npm_config_offline: "true",
    // The fixture migrator/server use node:sqlite; keep its ExperimentalWarning out of stderr.
    NODE_OPTIONS: "--disable-warning=ExperimentalWarning",
  };
  for (const k of Object.keys(f.env)) {
    if (k.startsWith("BOKLI_")) delete f.env[k];
  }
  delete f.env.NODE_ENV;
  systemctl(f, "start", "bokli");
  await waitFor(() => httpCode(`${baseUrl(f)}/login`) === "200");

  // v1.1.0: the release carrying the NEW deploy script, as origin/main tip.
  release(f, "v1.1.0");
  return f;
}

export function baseUrl(f) {
  return `http://127.0.0.1:${f.port}`;
}

export function systemctl(f, ...args) {
  return spawnSync(path.join(f.bin, "systemctl"), ["--user", ...args], { encoding: "utf-8", env: f.env });
}

/**
 * Commits a new release on main (tip), tags it and pushes, then moves the
 * deployer checkout to origin/main. Options control the fixture app behaviour.
 */
export function release(f, tag, opts = {}) {
  const { deployScript = NEW_DEPLOY_SCRIPT, extraMigrations = {}, ...behaviour } = opts;
  writeAppSource(
    f.author,
    { version: tag, ...behaviour },
    { deployScript, extraMigrations: { "0001_unique_notes.sql": MIGRATION_0001, ...extraMigrations } }
  );
  git(["add", "-A"], f.author);
  git(["commit", "--allow-empty", "-m", tag], f.author);
  git(["tag", "-a", tag, "-m", tag], f.author);
  git(["push", "origin", "main", tag], f.author);
  syncDeployer(f);
  return git(["rev-parse", "HEAD"], f.author);
}

export function syncDeployer(f) {
  if (!fs.existsSync(f.deployer)) git(["clone", "--quiet", f.origin, f.deployer], f.root);
  git(["fetch", "--quiet", "origin", "--tags"], f.deployer);
  git(["checkout", "--quiet", "--detach", "origin/main"], f.deployer);
}

/**
 * Runs the deploy script from the deployer checkout (the first-hop path).
 * `prefix` runs it under a wrapper command, e.g. strace fault injection.
 */
export function runDeploy(
  f,
  args,
  { env = {}, script = path.join(f.deployer, "scripts/bokli_deploy.sh"), cwd = f.deployer, prefix = [] } = {}
) {
  const [cmd, ...cmdArgs] = [...prefix, script, ...args];
  const res = spawnSync(cmd, cmdArgs, {
    cwd,
    env: { ...f.env, BOKLI_REPO_DIR: f.live, BOKLI_DB_PATH: f.db, BOKLI_DEPLOY_HEALTH_TIMEOUT_SECS: "8", ...env },
    encoding: "utf-8",
    timeout: 110_000,
  });
  res.all = `${res.stdout}\n${res.stderr}`;
  return res;
}

/** Everything that must be unchanged if production was "not touched". */
export function liveState(f) {
  return {
    head: git(["rev-parse", "HEAD"], f.live),
    trackedClean: git(["status", "--porcelain", "--untracked-files=no"], f.live) === "",
    stamp: fs.existsSync(path.join(f.live, ".next-prod/BUILD_MANIFEST"))
      ? fs.readFileSync(path.join(f.live, ".next-prod/BUILD_MANIFEST"), "utf-8")
      : null,
    buildDigest: treeDigest(path.join(f.live, ".next-prod")),
    nodeModulesDigest: treeDigest(path.join(f.live, "node_modules")),
    db: dbDump(f.db),
  };
}

export function verifyLiveStamp(f) {
  return spawnSync(path.join(f.live, "scripts/verify_build_stamp.sh"), [], { cwd: f.live, encoding: "utf-8" });
}

/** True if the running service answers with the given build (static asset only that build has). */
export function servesBuild(f, buildId) {
  return (
    httpCode(`${baseUrl(f)}/login`) === "200" &&
    httpCode(`${baseUrl(f)}/_next/static/${buildId}/_buildManifest.js`) === "200"
  );
}

export function calls(f) {
  const p = path.join(f.sd, "calls.log");
  return fs.existsSync(p) ? fs.readFileSync(p, "utf-8").trim().split("\n") : [];
}

export function inject(f, event, action) {
  fs.writeFileSync(path.join(f.sd, `inject.${event}`), action);
}

export async function waitFor(pred, timeoutMs = 10_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("waitFor: condition not met in time");
}

export function destroyFixture(f) {
  if (!f) return;
  systemctl(f, "stop", "bokli");
  fs.rmSync(f.root, { recursive: true, force: true });
}
