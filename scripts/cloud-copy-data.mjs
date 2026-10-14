// ==============================================================================
// Copy a Bokli SQLite database into an EMPTY Cloudflare D1 database, then check
// that both hold the same records. Used for the staging copy and for cutover.
//
//   node scripts/cloud-copy-data.mjs --source <bokli.db> --env <staging|production> \
//     --email <username>=<email> [--email <username>=<email>] [--verify-only]
//
// Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the environment.
// The source is only read (SQLite online backup). Work files stay in a private
// folder outside the repo and are deleted at the end: they contain real data.
// Prints EQUAL / NOT EQUAL per check, never amounts.
// ==============================================================================
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = path.join(root, "node_modules/.bin/wrangler");
const config = path.join(root, "workers/wrangler.json");

const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const source = option("--source");
const env = option("--env");
const verifyOnly = args.includes("--verify-only");
const emails = args.flatMap((a, i) => (a === "--email" ? [args[i + 1]] : [])).map((pair) => {
  const [username, email] = pair.split("=");
  if (!/^[a-z0-9_-]+$/i.test(username) || !/^[!-~]+@[!-~]+\.[!-~]+$/.test(email) || email.includes("'")) {
    throw new Error(`Bad --email ${pair}`);
  }
  return { username, email: email.trim().toLowerCase() };
});
if (!source || !fs.existsSync(source) || !["staging", "production"].includes(env)) {
  throw new Error("Usage: --source <bokli.db> --env <staging|production> --email <username>=<email>");
}
for (const name of ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]) {
  if (!process.env[name]) throw new Error(`${name} is not set`);
}

const work = fs.mkdtempSync(path.join(os.homedir(), ".cache", "bokli-cloud-copy-"));
fs.chmodSync(work, 0o700);
const copy = path.join(work, "copy.db");
const sqlite = (sql) => execFileSync("sqlite3", ["-json", copy, sql], { encoding: "utf8" }).trim();
const rows = (sql) => JSON.parse(sqlite(sql) || "[]");
const remote = (sql) => {
  const out = execFileSync(wrangler, ["d1", "execute", "BOKLI_DB", "--remote", "--env", env, "--config", config, "--json", "--command", sql],
    { cwd: root, encoding: "utf8", env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" } });
  return JSON.parse(out)[0].results;
};

try {
  // 1. Private, consistent copy of the source; upgrade it to the current schema.
  execFileSync("sqlite3", ["-readonly", source, `.backup '${copy}'`]);
  fs.chmodSync(copy, 0o600);
  execFileSync("npx", ["drizzle-kit", "migrate"], { cwd: root, stdio: "ignore", env: { ...process.env, BOKLI_DB_PATH: copy } });
  for (const { username, email } of emails) {
    const [user] = rows(`SELECT id FROM users WHERE username='${username}'`);
    if (!user) throw new Error(`No user named ${username}`);
    sqlite(`INSERT OR REPLACE INTO user_emails(email,user_id) VALUES ('${email}',${user.id})`);
  }
  // Record every migration as applied so later `wrangler d1 migrations apply` starts after them.
  const migrations = fs.readdirSync(path.join(root, "drizzle")).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
  sqlite(`CREATE TABLE IF NOT EXISTS d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL);
    ${migrations.map((m) => `INSERT OR IGNORE INTO d1_migrations(name) VALUES ('${m}');`).join("\n")}`);
  const check = execFileSync("sqlite3", [copy, "PRAGMA integrity_check; PRAGMA foreign_key_check;"], { encoding: "utf8" }).trim();
  if (check !== "ok") throw new Error(`Copy failed its integrity check: ${check}`);

  // 2. Load into D1. `.dump` writes tables and rows first, then indexes and
  //    triggers, so closed-month locks don't block loading history.
  if (!verifyOnly) {
    const existing = remote("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE '_cf_%' AND name<>'sqlite_sequence'");
    if (existing[0].n !== 0) throw new Error(`Target D1 (${env}) is not empty; refusing to load.`);
    const dump = execFileSync("sqlite3", [copy, ".dump"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
      .split("\n").filter((line) => !/^(PRAGMA foreign_keys=OFF;|BEGIN TRANSACTION;|COMMIT;)$/.test(line)).join("\n");
    const file = path.join(work, "dump.sql");
    fs.writeFileSync(file, `PRAGMA defer_foreign_keys = true;\n${dump}\n`, { mode: 0o600 });
    execFileSync(wrangler, ["d1", "execute", "BOKLI_DB", "--remote", "--env", env, "--config", config, "--file", file, "--yes"],
      { cwd: root, stdio: ["ignore", "ignore", "inherit"], env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" } });
  }

  // 3. Same questions to both databases; compare the answers.
  const tables = rows("SELECT name FROM sqlite_master WHERE type='table' AND name<>'sqlite_sequence' ORDER BY name").map((t) => t.name);
  const checks = {
    "schema objects": "SELECT type, name FROM sqlite_master WHERE name NOT LIKE '_cf_%' AND name NOT LIKE 'sqlite_%' ORDER BY type, name",
    "row counts": `SELECT ${tables.map((t) => `(SELECT count(*) FROM "${t}") AS "${t}"`).join(", ")}`,
    "next IDs": "SELECT name, seq FROM sqlite_sequence ORDER BY name",
    "sheets by month": "SELECT substr(date,1,7) AS m, count(*) AS n, sum(cash_sen) AS cash, sum(tng_sen) AS tng FROM daily_sheets GROUP BY m ORDER BY m",
    "cost lines by month": "SELECT substr(s.date,1,7) AS m, c.category, count(*) AS n, sum(c.amount_sen) AS amt FROM cost_lines c JOIN daily_sheets s ON s.id=c.daily_sheet_id GROUP BY m, c.category ORDER BY m, c.category",
    "expenses by month": "SELECT month AS m, type, count(*) AS n, sum(amount_sen) AS amt FROM operating_expenses GROUP BY m, type ORDER BY m, type",
    "month closes": "SELECT * FROM month_closes ORDER BY id",
    "month close history": "SELECT * FROM month_close_events ORDER BY id",
    "users and emails": "SELECT u.id, u.username, u.role, e.email FROM users u LEFT JOIN user_emails e ON e.user_id=u.id ORDER BY u.id",
    "every sheet": "SELECT * FROM daily_sheets ORDER BY id",
    "every cost line": "SELECT * FROM cost_lines ORDER BY id",
    "every expense": "SELECT * FROM operating_expenses ORDER BY id",
  };
  let ok = true;
  for (const [name, sql] of Object.entries(checks)) {
    const same = JSON.stringify(rows(sql)) === JSON.stringify(remote(sql));
    ok &&= same;
    console.log(`${same ? "EQUAL    " : "NOT EQUAL"}  ${name}`);
  }
  console.log(ok ? `\nAll checks EQUAL: D1 (${env}) matches the source.` : `\nMISMATCH: do not use D1 (${env}).`);
  process.exitCode = ok ? 0 : 1;
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
