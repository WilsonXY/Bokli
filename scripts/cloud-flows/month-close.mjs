// Month Close on the cloud build: the Operator closes last month and cannot
// reopen it; the Admin can. Run as mom (the flow opens katte itself).
const kl = new Date(Date.now() + 8 * 3600e3);
const month = new Date(Date.UTC(kl.getUTCFullYear(), kl.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
const reopenButton = (page) => page.getByRole("button", { name: "Reopen Month (Admin Only)" });

export default async function flow({ page, shot, openAs }) {
  await page.goto(`/close?month=${month}`);
  await page.getByRole("button", { name: "Switch to English" }).click();
  // Seeded month: net profit RM305.00, all counted as cash.
  await page.getByPlaceholder("0.00").nth(0).fill("305");
  await page.getByPlaceholder("0.00").nth(1).fill("0");
  await shot("operator-before-close");
  await page.getByRole("button", { name: "Close Month" }).click();
  await page.getByText("Month closed and locked successfully").waitFor();
  await page.reload();
  await page.getByText("Closed At").first().waitFor();
  if (await reopenButton(page).count()) throw new Error("Operator sees Reopen");
  const refused = await page.evaluate(async (m) => (await fetch("/api/cloud-v1/close/reopen", {
    method: "POST", body: JSON.stringify({ month: m, reason: "operator try" }),
    headers: { "Content-Type": "application/json", "X-Bokli-Api-Generation": "cloud-v1", "Idempotency-Key": "operator-reopen" },
  })).text(), month);
  if (!refused.includes("Admin role required")) throw new Error(`Operator reopen returned ${refused}`);
  await shot("operator-closed-no-reopen");

  const admin = await openAs("katte");
  await admin.goto(`/close?month=${month}`);
  await admin.getByRole("button", { name: "Switch to English" }).click();
  await reopenButton(admin).click();
  await admin.getByPlaceholder("Explain why this month must be reopened").fill("Fix a typo in a sheet");
  await shot("admin-reopen-reason", admin);
  await admin.getByRole("button", { name: "Confirm Reopen" }).click();
  await admin.getByText("Month reopened successfully").waitFor();
  await admin.reload();
  await admin.getByText("Fix a typo in a sheet").waitFor();
  await shot("admin-reopened", admin);
};
