#!/usr/bin/env node
import { chromium } from 'playwright';

// 1. Validate environment variables
const username = process.env.SMOKE_USER;
const password = process.env.SMOKE_PASS;

if (!username || !password) {
  console.error('Error: SMOKE_USER and SMOKE_PASS environment variables are required.');
  console.error('Usage: SMOKE_USER=<user> SMOKE_PASS=<pass> [TARGET_URL=<url>] npm run smoke:login');
  process.exit(1);
}

const rawTargetUrl = (process.env.TARGET_URL || 'http://localhost:3000').trim();
try {
  new URL(rawTargetUrl);
} catch {
  console.error(`Error: Invalid TARGET_URL: "${rawTargetUrl}". Must be a valid URL.`);
  process.exit(1);
}

const targetBase = rawTargetUrl.replace(/\/+$/, '');
const loginUrl = `${targetBase}/login`;
const TIMEOUT_MS = 20000;

async function runSmokeLogin() {
  const events = [];
  let cfDetected = false;
  let browser;

  const printAuthEvents = () => {
    console.log('--- auth events ---');
    for (const e of events) {
      console.log(`(${e.status}, '${e.url}')`);
    }
  };

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();

    // Track /api/auth response events (like the original script)
    page.on('response', (res) => {
      const url = res.url();
      if (url.includes('/api/auth')) {
        events.push({ status: res.status(), url });
      }
      const loc = res.headers()['location'];
      if (loc && loc.includes('cloudflareaccess.com')) {
        cfDetected = true;
      }
      if (url.includes('cloudflareaccess.com')) {
        cfDetected = true;
      }
    });

    page.on('request', (req) => {
      if (req.url().includes('cloudflareaccess.com')) {
        cfDetected = true;
      }
    });

    // Navigate to login page
    try {
      await page.goto(loginUrl, { waitUntil: 'networkidle', timeout: TIMEOUT_MS });
    } catch (err) {
      if (cfDetected || page.url().includes('cloudflareaccess.com')) {
        console.log('STATE: SKIP: Cloudflare Access gate detected (blocks bots)');
        console.log('FINAL URL:', page.url());
        printAuthEvents();
        await browser.close();
        process.exit(0);
      }
      console.error(`FAIL: Failed to navigate to ${loginUrl}: ${err?.message || err}`);
      console.log('STATE: FAIL: navigation failed');
      console.log('FINAL URL:', page.url());
      printAuthEvents();
      await browser.close();
      process.exit(1);
    }

    // Check if Cloudflare Access intercepted the initial request
    if (cfDetected || page.url().includes('cloudflareaccess.com')) {
      console.log('STATE: SKIP: Cloudflare Access gate detected (blocks bots)');
      console.log('FINAL URL:', page.url());
      printAuthEvents();
      await browser.close();
      process.exit(0);
    }

    // Fill credentials and submit
    try {
      await page.fill('input[type="text"]', username, { timeout: TIMEOUT_MS });
      await page.fill('input[type="password"]', password, { timeout: TIMEOUT_MS });
      await page.click('button[type="submit"]', { timeout: TIMEOUT_MS });
    } catch (err) {
      console.error(`FAIL: Failed to fill or submit login form: ${err?.message || err}`);
      console.log('STATE: FAIL: form interaction failed');
      console.log('FINAL URL:', page.url());
      printAuthEvents();
      await browser.close();
      process.exit(1);
    }

    let state = '';
    let isSuccess = false;
    let isSkip = false;

    try {
      // Wait for redirect away from /login
      await page.waitForURL((url) => {
        if (url.hostname.includes('cloudflareaccess.com')) return true;
        return !url.pathname.startsWith('/login');
      }, { timeout: TIMEOUT_MS });

      if (cfDetected || page.url().includes('cloudflareaccess.com')) {
        state = 'SKIP: Cloudflare Access gate detected (blocks bots)';
        isSkip = true;
      } else {
        // Wait 3 seconds to verify session persistence (ensuring cookie wasn't rejected, causing a bounce-back to /login)
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const finalUrl = page.url();
        if (cfDetected || finalUrl.includes('cloudflareaccess.com')) {
          state = 'SKIP: Cloudflare Access gate detected (blocks bots)';
          isSkip = true;
        } else {
          const finalPath = new URL(finalUrl).pathname;
          if (finalPath.startsWith('/login')) {
            state = `FAIL: session did not persist (bounced back to /login); url=${finalUrl}`;
            isSuccess = false;
          } else {
            state = `SUCCESS: reached authenticated page (${finalPath})`;
            isSuccess = true;
          }
        }
      }
    } catch (err) {
      if (cfDetected || page.url().includes('cloudflareaccess.com')) {
        state = 'SKIP: Cloudflare Access gate detected (blocks bots)';
        isSkip = true;
      } else {
        state = `FAIL: not authenticated: ${err?.name || 'Error'}; url=${page.url()}`;
        isSuccess = false;
      }
    }

    console.log('STATE:', state);
    console.log('FINAL URL:', page.url());
    printAuthEvents();

    await browser.close();
    process.exit(isSuccess || isSkip ? 0 : 1);
  } catch (unexpectedErr) {
    console.error('Unexpected error during smoke test:', unexpectedErr);
    if (browser) {
      try {
        await browser.close();
      } catch {}
    }
    process.exit(1);
  }
}

runSmokeLogin();
