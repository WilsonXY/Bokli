import assert from "node:assert/strict";

const kl = new Date(Date.now() + 8 * 3600e3);
const previousMonth = new Date(Date.UTC(kl.getUTCFullYear(), kl.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
const financialPages = [["/", "sheet"], [`/dashboard?month=${previousMonth}`, "overview"], [`/expenses?month=${previousMonth}`, "expenses"], [`/close?month=${previousMonth}`, "month-close"]];

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const loaded = async page => {
  await page.locator("main h1").waitFor();
  await page.locator('[aria-busy="true"]').waitFor({ state: "detached" });
  await page.evaluate(() => document.fonts.ready);
};
const fits = async page => {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "Page must fit the viewport");
};

export default async function flow({ page, shot: rawShot }) {
  const shot = (name, target = page) => rawShot(name, target, { fullPage: false });
  // An OS dark preference must never override the requested bright default.
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/settings");
  await loaded(page);
  assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
  assert.equal(await page.getByRole("radio", { name: /明亮模式/ }).isChecked(), true);
  const typography = await page.locator("body").evaluate(el => ({ family: getComputedStyle(el).fontFamily, weight: getComputedStyle(el).fontWeight, fontLoaded: document.fonts.check('500 16px "Noto Sans SC"', '簿里账单') }));
  assert.match(typography.family, /Noto Sans SC/);
  assert.equal(typography.weight, "500");
  assert.equal(typography.fontLoaded, true);
  await fits(page);
  await pause(1000); await shot("settings-zh-bright");
  await page.getByRole("radio", { name: /English/ }).check();
  await page.getByRole("heading", { name: "Settings", exact: true }).waitFor();
  assert.equal(await page.locator("html").getAttribute("lang"), "en");
  await pause(1000); await shot("settings-en-bright");
  await page.getByRole("radio", { name: "Dark mode", exact: true }).check();
  await page.reload(); await loaded(page);
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  assert.equal(await page.getByRole("radio", { name: "Dark mode", exact: true }).isChecked(), true);
  await pause(1000); await shot("settings-en-dark");

  for (const theme of ["dark", "light"]) {
    await page.goto("/settings");
    await page.getByRole("radio", { name: theme === "light" ? /Bright mode/ : "Dark mode" }).check();
    for (const [path, name] of financialPages) {
      await page.goto(path); await loaded(page); await fits(page);
      assert.equal(await page.getByRole("navigation").locator('a[aria-current="page"]').count(), 1);
      assert.equal(await page.locator("header input").count(), 0);
      await pause(1300); await shot(`en-${theme}-${name}`);
      if (name === "overview") {
        await page.locator(".daily-records > summary").click();
        await page.locator(".daily-record").first().waitFor();
        await pause(1000); await shot(`en-${theme}-daily-sheets`);
        await page.locator(".daily-records > summary").click();
        await page.getByRole("button", { name: "Costs", exact: true }).click();
        await page.getByRole("heading", { name: "Daily Cost Trend", exact: true }).waitFor();
        await pause(1000); await shot(`en-${theme}-cost-trend`);
        await page.getByRole("button", { name: "Revenue", exact: true }).click();
        await page.locator(".overview-composition").scrollIntoViewIfNeeded();
        await pause(1000); await shot(`en-${theme}-composition`);
      }
    }
  }
  await page.goto("/settings");
  await page.getByRole("button", { name: "Sign Out", exact: true }).click();
  const dialog = page.getByRole("dialog");
  assert.equal(await dialog.isVisible(), true);
  await page.keyboard.press("Escape");
  assert.equal(await dialog.isVisible(), false);
  assert.equal(await page.getByRole("button", { name: "Sign Out", exact: true }).evaluate(el => el === document.activeElement), true);

  await page.getByRole("radio", { name: /简体中文/ }).check();
  for (const [path, name] of financialPages) {
    await page.goto(path); await loaded(page); await fits(page);
    await pause(1300); await shot(`zh-light-${name}`);
    if (name === "overview") {
      await page.locator(".overview-composition").scrollIntoViewIfNeeded();
      await pause(1000); await shot("zh-light-composition");
    }
  }
  // Keyboard skip navigation and narrow/tablet layouts.
  await page.goto("/"); await loaded(page);
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("href")), "#main-content");
  await page.keyboard.press("Enter");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "main-content");
  const original = page.viewportSize();
  for (const width of [320, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/", "/dashboard", "/expenses", "/close", "/settings"]) {
      await page.goto(path); await loaded(page); await fits(page);
    }
    await pause(1000); await shot(`settings-${width}`);
  }
  await page.setViewportSize(original);
}
