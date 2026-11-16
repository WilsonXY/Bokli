import assert from "node:assert/strict";

export default async function navigationContext({ page, shot }) {
  await page.goto("/");
  await page.locator("#cash-input").waitFor();
  const today = await page.evaluate(async () => (await (await fetch("/api/cloud-v1/sheets")).json()).todayKl);
  const past = new Date(`${today}T00:00:00Z`);
  past.setUTCDate(past.getUTCDate() - 1);
  const olderDate = past.toISOString().slice(0, 10);
  const previousMonth = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);
  const tab = name => page.getByRole("navigation").getByRole("link", { name, exact: true });

  await page.goto(`/?date=${olderDate}`);
  await page.locator("#cash-input").waitFor();
  await tab("经营概览").click();
  await page.locator(".month-picker-trigger").waitFor();
  await tab("每日账单").click();
  await page.locator("#cash-input").waitFor();
  assert.equal(new URL(page.url()).searchParams.get("date"), olderDate);
  await page.getByRole("button", { name: "回到今天", exact: true }).click();
  await page.locator("#cash-input").waitFor();
  await page.locator(".date-trigger-label").filter({ hasText: today }).waitFor();
  const originalCash = await page.locator("#cash-input").inputValue();
  await page.locator("#cash-input").fill("123.45");
  const activeSheet = tab("每日账单");
  assert.equal(await activeSheet.getAttribute("href"), `/?date=${today}`, "Active Sheet href must use today, including open-in-new-tab behavior");
  await activeSheet.click();
  await page.waitForTimeout(700);
  assert.equal(new URL(page.url()).searchParams.get("date"), today, "Tapping the active Sheet tab must not restore the older date");
  assert.equal(await page.locator("#cash-input").inputValue(), "123.45", "The active tab must retain its unsaved figures");
  await shot("active-sheet-keeps-today", page, { fullPage: false });
  await page.locator("#cash-input").fill(originalCash);
  await page.waitForFunction(() => { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return !event.defaultPrevented; });

  await page.goto("/dashboard");
  await page.getByRole("button", { name: "月份", exact: true }).click();
  await page.getByRole("option", { name: new RegExp(previousMonth) }).click();
  await page.locator(`.month-close-action[href="/close?month=${previousMonth}"]`).click();
  await page.locator("#close-cash").waitFor();
  const overview = tab("经营概览");
  assert.equal(await overview.getAttribute("href"), `/dashboard?month=${previousMonth}`, "Month Close must link directly to its Overview month");
  await overview.click();
  await page.waitForTimeout(700);
  assert.equal(new URL(page.url()).searchParams.get("month"), previousMonth);
  await page.locator(".month-picker-date").filter({ hasText: previousMonth }).waitFor();
  await shot("close-returns-to-same-overview-month", page, { fullPage: false });

  // Seed the current month through the UI so returning to the default month
  // really would show a different period from the explicitly chosen old month.
  await tab("每日账单").click();
  await page.locator("#cash-input").fill("1.00");
  await page.getByRole("button", { name: "保存账单", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "确认保存", exact: true }).click();
  await page.locator(".sheet-save-action").getByText("已保存", { exact: true }).waitFor();

  // A route reached through a page link must be remembered just like a tab visit.
  await page.goto("/dashboard");
  await page.locator(".month-picker-date").filter({ hasText: today.slice(0, 7) }).waitFor();
  await page.getByRole("button", { name: "月份", exact: true }).click();
  await page.getByRole("option", { name: new RegExp(previousMonth) }).click();
  await page.locator(`.daily-record[href="/?date=${previousMonth}-03"]`).click();
  await page.locator("#cash-input").waitFor();
  await tab("经营概览").click();
  await page.waitForTimeout(700);
  await page.locator(".month-picker-date:visible").waitFor();
  assert.equal(await page.locator(".month-picker-date:visible").innerText(), previousMonth, "Returning from a Daily Sheet body link must show the explicitly selected Overview month");
  assert.equal(new URL(page.url()).searchParams.get("month"), previousMonth);
  await shot("body-link-retains-overview-month", page, { fullPage: false });

}
