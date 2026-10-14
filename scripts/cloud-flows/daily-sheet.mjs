// Daily Sheet on the cloud build: add, edit, delete; checked after a reload.
const expectValue = async (input, value) => {
  for (let i = 0; i < 50 && (await input.inputValue()) !== value; i++) await new Promise((r) => setTimeout(r, 100));
  if ((await input.inputValue()) !== value) throw new Error(`expected ${value}, got ${await input.inputValue()}`);
};
async function save(page) {
  await page.getByRole("button", { name: "Save Sheet" }).click();
  await page.getByRole("button", { name: "Confirm & Save" }).click();
  await page.getByText("Daily sheet saved successfully").waitFor();
}

export default async function flow({ page, shot }) {
  await page.goto("/");
  await page.getByRole("button", { name: "Switch to English" }).click();
  await page.locator("#cash-input").fill("450.00");
  await page.locator("#tng-input").fill("120.50");
  await page.getByRole("button", { name: "Add Cost" }).click();
  await page.locator('input[inputmode="decimal"]').nth(2).fill("80");
  await shot("draft");
  await save(page);
  await shot("added");

  await page.reload();
  await expectValue(page.locator("#cash-input"), "450");
  await page.getByText("RM80.00").first().waitFor();
  await page.locator("#cash-input").fill("500.00");
  await save(page);
  await page.reload();
  await expectValue(page.locator("#cash-input"), "500");
  await shot("edited");

  await page.getByRole("button", { name: "Delete this Daily Sheet" }).click();
  await shot("delete-confirm");
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await page.getByText("Daily Sheet deleted").waitFor();
  await page.reload();
  await expectValue(page.locator("#cash-input"), "");
  if (await page.getByRole("button", { name: "Delete this Daily Sheet" }).count()) throw new Error("sheet still there");
  await shot("deleted");
};
