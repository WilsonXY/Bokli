#!/usr/bin/env node
// Browser half of scripts/agent-verify.sh (which starts the server and sets the
// env below). Logs in, runs the flow while recording, saves the evidence.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { BASE_URL, VERIFY_USER, VERIFY_PASS, EVIDENCE_DIR } = process.env;
const flowPath = process.argv[2];
if (!BASE_URL || !VERIFY_USER || !VERIFY_PASS || !EVIDENCE_DIR || !flowPath) {
  console.error('FAIL: run this through scripts/agent-verify.sh.');
  process.exit(2);
}

const TIMEOUT_MS = 20000;
const VIEWPORT = { width: 1280, height: 800 };

const flow = (await import(pathToFileURL(flowPath).href)).default;
if (typeof flow !== 'function') {
  console.error(`FAIL: ${flowPath} has no default-exported function.`);
  process.exit(2);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  baseURL: BASE_URL,
  viewport: VIEWPORT,
  recordVideo: { dir: EVIDENCE_DIR, size: VIEWPORT },
});
context.setDefaultTimeout(TIMEOUT_MS);
const page = await context.newPage();

let shots = 0;
const shot = async (name) => {
  const file = path.join(EVIDENCE_DIR, `${String(++shots).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log('SHOT:', file);
};

let ok = false;
try {
  await page.goto('/login');
  await page.fill('input[type="text"]', VERIFY_USER);
  await page.fill('input[type="password"]', VERIFY_PASS);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
  // Leaving /login is not proof on its own (e.g. an auth error page).
  const session = await page.evaluate(async () => {
    const res = await fetch('/api/auth/session', { credentials: 'same-origin' });
    return res.ok ? res.json() : null;
  });
  if (session?.user?.username !== VERIFY_USER) {
    throw new Error(`login as ${VERIFY_USER} gave no matching session (${page.url()})`);
  }
  console.log(`==> Logged in as ${VERIFY_USER}; running flow`);

  await flow({ page, context, baseURL: BASE_URL, shot });
  ok = true;
} catch (err) {
  console.error('FAIL:', err?.message || err);
  await shot('failure').catch(() => {});
} finally {
  const video = page.video();
  await context.close(); // flushes the video file
  if (video) {
    const dest = path.join(EVIDENCE_DIR, 'flow.webm');
    fs.renameSync(await video.path(), dest);
    console.log('VIDEO:', dest);
  }
  await browser.close();
}

console.log(ok ? `PASS: flow finished; evidence in ${EVIDENCE_DIR}` : 'FAIL: flow did not finish');
process.exit(ok ? 0 : 1);
