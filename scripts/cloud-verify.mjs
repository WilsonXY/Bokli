#!/usr/bin/env node
// UI proof: starts scripts/cloud-local.mjs --test-identity on 127.0.0.1, runs
// one flow while recording, stops the server. Not a preview.
//
//   node scripts/cloud-verify.mjs <flow.mjs> [mom|katte] [--mobile] [--no-build]
//
// The flow's default export receives { page, shot, openAs }; openAs(user)
// returns a page signed in as the other user (same recording folder).
// Evidence: .evidence/<sha>/cloud-<flow>-<user>[-390]/ (flow.webm + screenshots).
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { startCloudLocal, signTestJwt, TEST_EMAILS } from "./cloud-local.mjs";

const args = process.argv.slice(2);
const flowPath = args.find((a) => a.endsWith(".mjs"));
const user = args.find((a) => a in TEST_EMAILS) ?? "mom";
const mobile = args.includes("--mobile");
if (!flowPath) {
  console.error("usage: node scripts/cloud-verify.mjs <flow.mjs> [mom|katte] [--mobile] [--no-build]");
  process.exit(2);
}
const flow = (await import(pathToFileURL(path.resolve(flowPath)).href)).default;

let sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
if (execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim()) sha += "-dirty";
const evidence = path.resolve(".evidence", sha, `cloud-${path.basename(flowPath, ".mjs")}-${user}${mobile ? "-390" : ""}`);
fs.rmSync(evidence, { recursive: true, force: true });
fs.mkdirSync(evidence, { recursive: true });

const viewport = mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 };
const port = await new Promise((resolve) => {
  const probe = net.createServer().listen(0, "127.0.0.1", () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});
const server = await startCloudLocal({ port, testIdentity: true, build: !args.includes("--no-build") });
const browser = await chromium.launch({ headless: true });
const contexts = [];
let shots = 0;
let ok = false;

async function openAs(who) {
  const context = await browser.newContext({
    baseURL: server.baseURL, viewport, recordVideo: { dir: evidence, size: viewport },
    extraHTTPHeaders: { "Cf-Access-Jwt-Assertion": signTestJwt(server, TEST_EMAILS[who]) },
  });
  context.setDefaultTimeout(15000);
  contexts.push(context);
  const page = await context.newPage();
  page.on("pageerror", (err) => console.error("PAGE ERROR:", err.message));
  return page;
}

const page = await openAs(user);
const shot = async (name, target = page) => {
  const file = path.join(evidence, `${String(++shots).padStart(2, "0")}-${name}.png`);
  await target.screenshot({ path: file, fullPage: true });
  console.log("SHOT:", file);
};
try {
  await flow({ page, shot, openAs });
  ok = true;
} catch (err) {
  console.error("FAIL:", err?.stack || err);
  await shot("failure").catch(() => {});
} finally {
  for (const [i, context] of contexts.entries()) {
    const video = context.pages()[0]?.video();
    await context.close();
    if (video) fs.renameSync(await video.path(), path.join(evidence, i ? `flow-${i}.webm` : "flow.webm"));
  }
  await browser.close();
  server.stop();
}
console.log(ok ? `PASS: evidence in ${evidence}` : "FAIL: flow did not finish");
process.exit(ok ? 0 : 1);
