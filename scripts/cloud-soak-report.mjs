// Summarize a $0 soak test: CPU per route from the Worker tail, plus the client's
// view (status codes, retries, 1102 pages). Prints a table and writes summary.json.
//   node scripts/cloud-soak-report.mjs [--out ~/.cache/bokli-soak]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const out = args.includes("--out") ? args[args.indexOf("--out") + 1] : path.join(os.homedir(), ".cache/bokli-soak");
const jsonObjects = (file) => {
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, "utf8"), dec = [];
  // `wrangler tail --format json` pretty-prints; read consecutive JSON values.
  let depth = 0, start = -1, inString = false, escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) { escaped = !escaped && c === "\\"; if (c === '"' && !escaped) inString = false; else if (c !== "\\") escaped = false; continue; }
    if (c === '"') inString = true;
    else if (c === "{") { if (depth++ === 0) start = i; }
    else if (c === "}" && --depth === 0) { try { dec.push(JSON.parse(text.slice(start, i + 1))); } catch { /* partial line */ } }
  }
  return dec;
};
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };

const tail = jsonObjects(path.join(out, "tail.jsonl")).filter((e) => e.event?.request?.url?.includes("/api/"));
const routes = {};
for (const e of tail) {
  const url = new URL(e.event.request.url);
  const key = `${e.event.request.method} ${url.pathname.replace("/api/cloud-v1/", "")}`;
  (routes[key] ??= []).push(e);
}
const rows = Object.entries(routes).sort().map(([route, es]) => {
  const cpu = es.map((e) => e.cpuTime ?? 0);
  return { route, n: es.length, p50: q(cpu, 0.5), p95: q(cpu, 0.95), max: Math.max(...cpu),
    over10: cpu.filter((c) => c > 10).length, exceededCpu: es.filter((e) => e.outcome === "exceededCpu").length,
    errors: es.filter((e) => e.outcome !== "ok" || (e.event.response?.status ?? 0) >= 500).length };
});
const client = fs.existsSync(path.join(out, "requests.jsonl"))
  ? fs.readFileSync(path.join(out, "requests.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const reqs = client.filter((c) => c.route);
const summary = {
  from: reqs[0]?.at, to: reqs.at(-1)?.at, rounds: new Set(reqs.map((r) => r.round)).size, requests: reqs.length,
  workerInvocations: tail.length, exceededCpu: tail.filter((e) => e.outcome === "exceededCpu").length,
  client1102: reqs.filter((r) => r.cf1102).length, client5xx: reqs.filter((r) => r.status >= 500).length,
  unexpected4xx: reqs.filter((r) => r.status >= 400 && r.status < 500).map((r) => `${r.method} ${r.route} ${r.status} ${r.code}`),
  replayChecks: client.filter((c) => c.check === "expense-replay").length,
  replayFailures: client.filter((c) => c.check === "expense-replay" && !c.sameId).length,
  fatal: client.filter((c) => c.fatal).map((c) => c.fatal), routes: rows,
};
// Cross-check with Cloudflare's own analytics, which count every invocation (tail is best-effort).
const token = path.join(os.homedir(), ".config/bokli/cloudflare-staging.token");
if (summary.from && fs.existsSync(token)) {
  const query = `query($a:String!,$s:Time!,$e:Time!){viewer{accounts(filter:{accountTag:$a}){workersInvocationsAdaptive(limit:20,
    filter:{scriptName:"bokli-staging",datetime_geq:$s,datetime_leq:$e}){sum{requests errors} quantiles{cpuTimeP50 cpuTimeP99} max{cpuTime} dimensions{status}}}}}`;
  const variables = { a: fs.readFileSync(path.join(os.homedir(), ".config/bokli/cloudflare-account-id"), "utf8").trim(),
    s: summary.from.replace(/\.\d+Z$/, "Z"), e: new Date().toISOString().replace(/\.\d+Z$/, "Z") };
  const res = await fetch("https://api.cloudflare.com/client/v4/graphql", { method: "POST", signal: AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${fs.readFileSync(token, "utf8").trim()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }) }).then((r) => r.json()).catch((err) => ({ errors: [String(err)] }));
  summary.cloudflare = res.errors ?? res.data.viewer.accounts[0].workersInvocationsAdaptive.map((r) => ({
    status: r.dimensions.status, requests: r.sum.requests, errors: r.sum.errors,
    cpuP50ms: r.quantiles.cpuTimeP50 / 1000, cpuP99ms: r.quantiles.cpuTimeP99 / 1000, cpuMaxMs: r.max.cpuTime / 1000 }));
}
fs.writeFileSync(path.join(out, "summary.json"), JSON.stringify(summary, null, 2));
console.table(rows);
console.log({ ...summary, routes: undefined });
