// ==============================================================================
// $0 soak test: replays a day of Mom's Bokli use against a deployed cloud copy,
// round after round with idle gaps (so the Worker starts cold), and logs every
// request. CPU per request comes from `wrangler tail` (see scripts/cloud-tail.sh);
// summarize both with scripts/cloud-soak-report.mjs.
//
//   node scripts/cloud-soak.mjs --base https://bokli-staging.ktte.me --hours 60 \
//     [--gap 15-25 (minutes between rounds)] [--cookie-file ~/.config/bokli/staging-access-cookie] [--out ~/.cache/bokli-soak]
//
// Signs in through Cloudflare Access with the CF_Authorization cookie in
// --cookie-file (copied once from a logged-in browser). Writes only inside
// TEST_MONTH, which holds no real records. Never point this at production.
// ==============================================================================
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const base = option("--base");
const hours = Number(option("--hours", "60"));
const cookieFile = option("--cookie-file", path.join(os.homedir(), ".config/bokli/staging-access-cookie"));
const [gapMin, gapMax] = option("--gap", "15-25").split("-").map(Number);
const out = option("--out", path.join(os.homedir(), ".cache/bokli-soak"));
if (!base || !/^https:\/\/[a-z0-9.-]+$/.test(base) || /\/\/bokli\.ktte\.me$/.test(base)) throw new Error("--base must be a staging https origin");

const TEST_MONTH = "2025-01";
const CATEGORIES = ["restock", "gas", "transport", "wages-daily", "maintenance"];
const cookie = `CF_Authorization=${fs.readFileSync(cookieFile, "utf8").trim()}`;
fs.mkdirSync(out, { recursive: true, mode: 0o700 });
const log = fs.createWriteStream(path.join(out, "requests.jsonl"), { flags: "a" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
let actor;

async function call(route, { method = "GET", query = "", body, key, round } = {}) {
  const headers = { Cookie: cookie, Origin: base, "X-Bokli-Api-Generation": "cloud-v1" };
  if (actor) headers["X-Bokli-Actor-Id"] = String(actor);
  if (key) headers["Idempotency-Key"] = key;
  if (body) headers["Content-Type"] = "application/json";
  const started = Date.now();
  let status = 0, text = "", error;
  try {
    const res = await fetch(`${base}/api/cloud-v1/${route}${query}`, { method, headers, body: body && JSON.stringify(body), redirect: "manual" });
    status = res.status;
    text = await res.text();
  } catch (err) { error = String(err); }
  let data = {};
  try { data = JSON.parse(text); } catch { /* HTML error page, e.g. Cloudflare 1102 */ }
  const entry = { at: new Date(started).toISOString(), round, method, route, status, ms: Date.now() - started,
    code: data.code, cf1102: /1102|exceeded.*cpu/i.test(text) && !text.startsWith("{"), accessRedirect: status === 302, error };
  log.write(`${JSON.stringify(entry)}\n`);
  if (entry.accessRedirect) throw new Error("Access login expired: refresh the cookie file.");
  return { status, data };
}

// A save that may lose its reply: on 503/1102, ask status, then retry once with the same key.
async function write(route, method, body, operation, round, query = "") {
  const key = crypto.randomUUID();
  let res = await call(route, { method, body, key, round, query });
  if (res.status >= 500) {
    const st = await call("operations/status", { query: `?operation=${operation}&operationId=${key}`, round });
    res = st.data.saved ? { status: st.data.status, data: st.data.result } : await call(route, { method, body, key, round, query });
  }
  return { ...res, key };
}

async function day(round) {
  const date = `${TEST_MONTH}-${String((round % 28) + 1).padStart(2, "0")}`;
  // Opening the four screens.
  if (!actor) actor = (await call("identity", { round })).data.id;
  else await call("identity", { round });
  for (const [page, query] of [["sheets", ""], ["dashboard", ""], ["expenses", `?month=${TEST_MONTH}`], ["close", `?month=${TEST_MONTH}`], ["history", ""]]) {
    await call(page, { query, round });
  }
  // Daily Sheet with 5–30 cost lines, then the reload after saving.
  const costLines = Array.from({ length: rand(5, 30) }, () => ({ amountSen: rand(100, 50000), category: CATEGORIES[rand(0, 4)] }));
  await write("sheets", "POST", { date, cashSen: rand(10000, 90000), tngSen: rand(0, 30000), costLines }, "sheet.save", round);
  const sheet = await call("sheets", { query: `?date=${date}`, round });
  // Expense: add, replay the same key (lost reply), then delete it again.
  const add = await write("expenses", "POST", { month: TEST_MONTH, type: "utilities", amountSen: rand(100, 9000), note: null }, "expense.add", round);
  const replay = await call("expenses", { method: "POST", key: add.key, round,
    body: { month: TEST_MONTH, type: "utilities", amountSen: add.data?.expense?.amountSen, note: null } });
  log.write(`${JSON.stringify({ check: "expense-replay", round, sameId: replay.data?.expense?.id === add.data?.expense?.id })}\n`);
  if (add.data?.expense?.id) await write("expenses", "DELETE", { ids: [add.data.expense.id] }, "expense.delete", round);
  // Month Close (the action measured over 10 ms), then reopen so the next round can close again.
  const close = await write("close", "POST", { month: TEST_MONTH, cashOnHandSen: rand(0, 90000), tngOnHandSen: rand(0, 30000), note: "soak test" }, "month.close", round);
  if (close.status === 200 || close.status === 201) {
    await write("close/reopen", "POST", { month: TEST_MONTH, reason: "soak test" }, "month.reopen", round);
  }
  // Now and then Mom deletes a day.
  const data = sheet.data?.data;
  if (round % 5 === 4 && data) {
    await write("sheets", "DELETE", undefined, "sheet.delete", round, `?date=${date}&id=${data.id}&updatedAt=${encodeURIComponent(data.updatedAt)}`);
  }
}

const end = Date.now() + hours * 3600_000;
for (let round = 0; Date.now() < end; round++) {
  try { await day(round); } catch (err) {
    log.write(`${JSON.stringify({ at: new Date().toISOString(), round, fatal: String(err) })}\n`);
    if (/Access login expired/.test(String(err))) break;
  }
  if (Date.now() >= end) break;
  // Mostly long idle gaps (cold starts); every 4th round a quick follow-up (warm).
  await sleep(round % 4 === 3 ? rand(20, 60) * 1000 : rand(gapMin, gapMax) * 60_000);
}
log.end();
