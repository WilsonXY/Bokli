import assert from "node:assert/strict";
import { chooseLanguage } from "./preferences.mjs";
const kl = new Date(Date.now() + 8 * 3600e3);
const current = kl.toISOString().slice(0, 7);
const previous = new Date(Date.UTC(kl.getUTCFullYear(), kl.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
export default async function flow({ page, shot: rawShot }) {
  const shot = async name => { await page.waitForTimeout(1100); await rawShot(name, page, { fullPage: false }); };
  await page.goto(`/dashboard?month=${current}`);
  await page.getByText("本月暂无每日账单记录").waitFor();
  assert.equal(await page.locator(".overview-composition").count(), 0);
  await shot("empty-month");
  await page.getByRole("button", { name: "月份", exact: true }).click();
  const monthPicker = await page.getByRole("listbox").boundingBox();
  assert(monthPicker && monthPicker.x >= 0 && monthPicker.x + monthPicker.width <= page.viewportSize().width, "Month choices must fit the phone");
  await shot("month-picker");
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "记录每日账单", exact: true }).click();
  await page.locator("#cash-input").waitFor();
  // Both core actions must be visible and reachable without scrolling.
  for (const name of [/添加开销/, /保存账单/]) {
    const button = page.getByRole("button", { name });
    assert.equal(await button.evaluate(el => { const r = el.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return r.bottom <= document.querySelector(".workspace-sidebar").getBoundingClientRect().top && (el === hit || el.contains(hit)); }), true, `${name} must be exposed in the initial phone view`);
  }
  await page.getByTitle("日期", { exact: true }).click();
  await page.waitForTimeout(250);
  const calendar = await page.getByRole("dialog").boundingBox();
  assert(calendar && calendar.x >= 0 && calendar.x + calendar.width <= page.viewportSize().width, "Calendar must stay inside the phone screen");
  await shot("calendar");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /添加开销/ }).click();
  await page.getByRole("button", { name: "其他", exact: true }).click();
  await page.locator('input[inputmode="decimal"]').nth(2).fill("20");
  await page.getByRole("button", { name: "保存账单", exact: true }).click();
  await shot("save-confirmation");
  await page.getByRole("dialog").getByRole("button", { name: "确认保存", exact: true }).click();
  await page.locator("#other-note-error-0").waitFor();
  await shot("required-note-feedback");
  await page.getByRole("button", { name: "撤销修改", exact: true }).click();
  await page.goto(`/expenses?month=${previous}`);
  await chooseLanguage(page, "en");
  await page.getByRole("button", { name: /Add Expense/ }).click();
  await page.locator("#expense-amount").fill("500");
  await page.locator("#expense-note").fill("Additional stall rent");
  await page.locator("form").scrollIntoViewIfNeeded();
  await shot("expense-entry");
  await page.locator("form").getByRole("button", { name: "Add Expense", exact: true }).click();
  await page.getByText("Expense added successfully").waitFor();
  await page.getByText("Additional stall rent", { exact: true }).scrollIntoViewIfNeeded();
  await shot("expense-saved");
  await page.getByText("Additional stall rent", { exact: true }).locator("..").getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await shot("expense-delete-confirmation");
  await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
  await page.goto(`/dashboard?month=${previous}`);
  await page.getByText("-RM195.00", { exact: true }).waitFor();
  assert.equal(await page.locator(".profit-headline.is-loss").count(), 1);
  await shot("loss-month");
}
