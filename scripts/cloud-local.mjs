#!/usr/bin/env node
// ==============================================================================
// Run the cloud build locally: static pages in out/ + the Worker in workers/ +
// a fresh local D1 with synthetic data. No Cloudflare account, nothing remote.
//
//   npm run cloud:local -- [--port 8787] [--public-origin <url>] [--test-identity] [--no-build]
//
// Default: real Cloudflare Access. Needs workers/.dev.vars (never committed)
// with ACCESS_ISSUER, ACCESS_AUD, ACCESS_ALLOWED_EMAILS, ACCESS_HEALTH_SERVICE_ID
// and APP_VERSION. The seed maps the first allowed email to the Operator
// (mom) and the second to the Admin (katte). Put a Cloudflare tunnel with an
// Access app in front of 127.0.0.1:<port> and pass its address, e.g.
// --public-origin https://boklidev.ktte.me, so writes accept that browser Origin.
//
// --test-identity: for automated local tests. Uses workers/local-test-identity.ts,
// which trusts only a key generated for this run; sign tokens with signTestJwt()
// for mom@example.invalid (Operator) or admin@example.invalid (Admin).
//
// The D1 data lives in a temp folder and is gone when this stops.
// ==============================================================================
import { spawn, execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = path.join(root, "node_modules/.bin/wrangler");
export const TEST_EMAILS = { mom: "mom@example.invalid", katte: "admin@example.invalid" };
const TEST_ISSUER = "https://bokli-local-test.cloudflareaccess.com";
const TEST_AUD = "bokli-local-test";

function parseDevVars(file) {
  return Object.fromEntries(fs.readFileSync(file, "utf8").split("\n")
    .map((line) => line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/))
    .filter(Boolean)
    .map(([, key, value]) => [key, value.replace(/^(["'])(.*)\1$/, "$2")]));
}

function seedSql(operatorEmail, adminEmail) {
  for (const email of [operatorEmail, adminEmail]) {
    if (!/^[!-~]+@[!-~]+\.[!-~]+$/.test(email ?? "") || email.includes("'")) throw new Error(`Bad seed email: ${email}`);
  }
  const lastMonth = (days) => `date('now','+8 hours','start of month','-1 month','+${days} days')`;
  return `
INSERT INTO users(id,username,password_hash,role) VALUES (1,'mom','cloud-access-only','Operator'),(2,'katte','cloud-access-only','Admin');
INSERT INTO user_emails(email,user_id) VALUES ('${operatorEmail}',1),('${adminEmail}',2);
INSERT INTO daily_sheets(date,cash_sen,tng_sen) VALUES (${lastMonth(2)},45000,12000),(${lastMonth(9)},52000,8000),(${lastMonth(16)},38000,15000);
INSERT INTO cost_lines(daily_sheet_id,amount_sen,category,note) SELECT id,15000,'restock',NULL FROM daily_sheets;
INSERT INTO cost_lines(daily_sheet_id,amount_sen,category,note) SELECT id,2500,'gas',NULL FROM daily_sheets WHERE id=1;
INSERT INTO operating_expenses(month,type,amount_sen,note) VALUES
  (strftime('%Y-%m','now','+8 hours','start of month','-1 month'),'rental',80000,NULL),
  (strftime('%Y-%m','now','+8 hours','start of month','-1 month'),'utilities',12000,NULL);
`;
}

/** Signs a short-lived Access-style JWT that only a --test-identity server accepts. */
export function signTestJwt(server, email) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const data = `${encode({ alg: "RS256", typ: "JWT", kid: server.kid })}.${encode({
    iss: TEST_ISSUER, aud: [TEST_AUD], type: "app", sub: `local-${email}`, email, iat: now, nbf: now, exp: now + 3600,
  })}`;
  return `${data}.${crypto.sign("sha256", Buffer.from(data), server.privateKey).toString("base64url")}`;
}

function run(args, env) {
  execFileSync(wrangler, args, { cwd: root, stdio: ["ignore", "ignore", "inherit"], env });
}

export async function startCloudLocal({ port = 8787, testIdentity = false, build = true, publicOrigin } = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Bad --port: ${port}`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bokli-cloud-"));
  const env = { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1" };
  let vars, main, emails, privateKey, kid;
  if (testIdentity) {
    ({ privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }));
    kid = crypto.randomUUID();
    const jwk = { ...crypto.createPublicKey(privateKey).export({ format: "jwk" }), kid, alg: "RS256", use: "sig" };
    main = path.join(root, "workers/local-test-identity.ts");
    emails = [TEST_EMAILS.mom, TEST_EMAILS.katte];
    vars = {
      ACCESS_ISSUER: TEST_ISSUER, ACCESS_AUD: TEST_AUD, ACCESS_ALLOWED_EMAILS: emails.join(","),
      ACCESS_HEALTH_SERVICE_ID: "bokli-local-test.access", APP_VERSION: "local", LOCAL_TEST_JWKS: JSON.stringify({ keys: [jwk] }),
    };
  } else {
    const devVars = path.join(root, "workers/.dev.vars");
    if (!fs.existsSync(devVars)) throw new Error("workers/.dev.vars is missing (see the header of scripts/cloud-local.mjs), or pass --test-identity.");
    fs.copyFileSync(devVars, path.join(dir, ".dev.vars"));
    main = path.join(root, "workers/index.ts");
    const devEnv = parseDevVars(devVars);
    emails = (devEnv.ACCESS_ALLOWED_EMAILS ?? "").split(",");
    if (emails.length < 2) throw new Error("ACCESS_ALLOWED_EMAILS needs the Operator's email, then the Admin's.");
    vars = {};
  }

  if (build) {
    execFileSync("npx", ["next", "build"], { cwd: root, stdio: "inherit", env: { ...env, BOKLI_TARGET: "cloud" } });
  }

  // The deployed config plus local-only bindings, outside the repo.
  const base = JSON.parse(fs.readFileSync(path.join(root, "workers/wrangler.json"), "utf8"));
  delete base.$schema;
  const config = path.join(dir, "wrangler.json");
  fs.writeFileSync(config, JSON.stringify({
    ...base, name: "bokli-cloud-local", main,
    assets: { ...base.assets, directory: path.join(root, "out") },
    d1_databases: [{ binding: "BOKLI_DB", database_name: "bokli-local", database_id: "local", migrations_dir: path.join(root, "drizzle") }],
    vars,
    ...(publicOrigin ? { dev: { host: new URL(publicOrigin).host, upstream_protocol: new URL(publicOrigin).protocol.slice(0, -1) } } : {}),
  }, null, 2));
  const state = path.join(dir, "state");
  fs.writeFileSync(path.join(dir, "seed.sql"), seedSql(emails[0], emails[1]));
  run(["d1", "migrations", "apply", "BOKLI_DB", "--local", "--config", config, "--persist-to", state], env);
  run(["d1", "execute", "BOKLI_DB", "--local", "--config", config, "--persist-to", state, "--file", path.join(dir, "seed.sql")], env);

  const child = spawn(wrangler, ["dev", "--config", config, "--persist-to", state, "--ip", "127.0.0.1", "--port", String(port),
    "--show-interactive-dev-session=false"], { cwd: dir, env, stdio: ["ignore", "inherit", "inherit"], detached: true });
  const baseURL = `http://127.0.0.1:${port}`;
  const stop = () => {
    try { process.kill(-child.pid, "SIGTERM"); } catch { /* already gone */ }
    fs.rmSync(dir, { recursive: true, force: true });
  };
  for (let i = 0; ; i++) {
    if (child.exitCode !== null) { stop(); throw new Error(`wrangler dev exited (${child.exitCode})`); }
    if (await fetch(baseURL).then((r) => r.ok, () => false)) break;
    if (i > 120) { stop(); throw new Error("wrangler dev did not start within 60 s"); }
    await new Promise((r) => setTimeout(r, 500));
  }
  return { baseURL, stop, child, privateKey, kid };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const server = await startCloudLocal({
    port: Number(option("--port") ?? 8787),
    publicOrigin: option("--public-origin"),
    testIdentity: args.includes("--test-identity"),
    build: !args.includes("--no-build"),
  });
  console.log(`==> Bokli cloud build at ${server.baseURL} (Ctrl+C stops it and deletes the local data)`);
  if (server.privateKey) {
    console.log(`    Test header for mom: Cf-Access-Jwt-Assertion: ${signTestJwt(server, TEST_EMAILS.mom)}`);
  }
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { server.stop(); process.exit(0); });
  server.child.on("exit", (code) => { server.stop(); process.exit(code ?? 1); });
}
