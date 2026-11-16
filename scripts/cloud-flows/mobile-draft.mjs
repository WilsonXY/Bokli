import assert from "node:assert/strict";
export default async function flow({ page, shot }) {
  await page.goto("/");
  await page.locator("#cash-input").waitFor();
  await page.locator("#cash-input").fill("123.45");
  await page.locator("#tng-input").fill("22.50");
  await page.getByRole("button", { name: /添加开销/ }).focus();
  await page.keyboard.press("Enter");
  await page.locator('input[inputmode="decimal"]').nth(2).fill("8.25");
  await page.getByRole("navigation").getByRole("link", { name: "设置", exact: true }).click();
  await page.getByRole("radio", { name: /English/ }).check();
  await page.getByRole("navigation").getByRole("link", { name: "Daily Sheet", exact: true }).click();
  await page.locator("#cash-input").waitFor();
  assert.equal(await page.locator("#cash-input").inputValue(), "123.45", "Settings must not discard unsaved Cash Revenue");
  assert.equal(await page.locator("#tng-input").inputValue(), "22.50");
  assert.equal(await page.locator('input[inputmode="decimal"]').nth(2).inputValue(), "8.25");
  const persisted = await page.evaluate(async () => (await (await fetch("/api/cloud-v1/sheets")).json()).data);
  assert.equal(persisted, null, "Visiting Settings must not silently save a draft");
  await page.waitForTimeout(1400); await shot("draft-survives-settings", page, { fullPage: false });

}
