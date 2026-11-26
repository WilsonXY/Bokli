import { setLanguage } from "./settings-helpers.mjs";
// Operating Expenses on the cloud build: a double click and a lost reply both
// still add exactly one expense.
const month = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 7); // KL month
const stored = (page) => page.evaluate(async (m) => {
  const res = await fetch(`/api/cloud-v1/expenses?month=${m}`);
  return (await res.json()).expenses.map((e) => `${e.type}:${e.amountSen}`).sort().join(",");
}, month);
async function draft(page, category, amount) {
  await page.getByRole("button", { name: "Add Operating Expense" }).click();
  const form = page.locator("form");
  await form.getByRole("button", { name: category }).click();
  await form.getByPlaceholder("0.00").fill(amount);
  return form.getByRole("button", { name: "Add Operating Expense" });
}
const expectStored = async (page, want) => {
  const got = await stored(page);
  if (got !== want) throw new Error(`stored ${got}, want ${want}`);
};

export default async function flow({ page, shot }) {
  await setLanguage(page, "en");
  await page.goto(`/expenses?month=${month}`);

  // Double click on Save.
  await (await draft(page, "Utilities", "12.34")).dblclick();
  await page.getByText("Expense added successfully").filter({ visible: true }).first().waitFor();
  await expectStored(page, "utilities:1234");
  await shot("double-click-one-row");

  // Reply lost after the server saved, and the status check fails too.
  let lost = 0;
  await page.route("**/api/cloud-v1/{expenses,operations/status}*", async (route) => {
    if (route.request().method() === "GET" && !route.request().url().includes("operations/status")) return route.continue();
    lost++;
    if (route.request().method() === "POST") await route.fetch(); // reaches the server, reply dropped
    await route.abort("failed");
  });
  await (await draft(page, "Stall Rent", "50")).click();
  await page.getByText("Not sure it saved").filter({ visible: true }).first().waitFor();
  await shot("lost-reply");
  await page.unrouteAll({ behavior: "wait" });
  if (lost < 2) throw new Error(`only ${lost} requests were dropped`);
  await expectStored(page, "rental:5000,utilities:1234");

  // Save again: asks the server first, finds it saved, adds nothing.
  await page.locator("form").getByRole("button", { name: "Add Operating Expense" }).click();
  await page.getByText("Expense added successfully").filter({ visible: true }).first().waitFor();
  await expectStored(page, "rental:5000,utilities:1234");
  await page.reload();
  await page.getByText(/RM\s?50\.00/).filter({ visible: true }).first().waitFor();
  await shot("retried-one-row");
};
