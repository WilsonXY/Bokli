import assert from "node:assert/strict";

export default async function closedStates({ page, shot: rawShot }) {
  const shot = async name => {
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(700);
    await rawShot(name, page, { fullPage: false });
  };
  const kl = new Date(Date.now() + 8 * 3600e3);
  const month = new Date(Date.UTC(kl.getUTCFullYear(), kl.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
  await page.goto(`/close?month=${month}`);
  await page.locator("#close-cash").fill("305");
  await page.locator("#close-tng").fill("0");
  await page.locator("form button[type=submit]").click();
  await page.locator("#close-cash").waitFor({ state: "detached" });
  await shot("closed-month-close");
  await page.goto(`/expenses?month=${month}`);
  await page.getByRole("status").filter({ hasText: "已结账" }).waitFor();
  assert.equal(await page.locator(".expense-add-action:visible").count(), 0);
  assert.equal(await page.locator(".record-delete").count(), 0);
  await shot("closed-expenses");
  await page.goto(`/?date=${month}-03`);
  await page.locator("#cash-input").waitFor();
  assert.equal(await page.locator("#cash-input").innerText(), "RM 450.00");
  assert.equal(await page.locator("#tng-input").innerText(), "RM 120.00");
  assert.equal(await page.locator(".daily-revenue input").count(), 0);
  assert.equal(await page.locator(".cost-record-summary[role=button]").count(), 0);
  assert.equal(await page.getByRole("button", { name: "保存账单", exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: /添加开销/ }).count(), 0);
  await page.evaluate(() => document.fonts.ready);
  const revenueEdge=await page.locator('#cash-input').evaluate(el=>el.getBoundingClientRect().right);
  const costEdges=await page.locator('.cost-record-summary .money-list-value').evaluateAll(nodes=>nodes.map(el=>el.getBoundingClientRect().right));
  assert(costEdges.every(edge=>Math.abs(edge-revenueEdge)<=1),'Read-only Daily Cost and Revenue amounts must share their right edge');
  await shot("closed-daily-sheet");
}
