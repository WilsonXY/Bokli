// Every cloud page in both languages (run with and without --mobile), then
// Sign Out, which goes to Cloudflare Access's logout.
const pages = { "/": "Cash Revenue", "/dashboard": "Cash vs TnG Split", "/expenses": "Stall Rent", "/close": "Close Month" };

export default async function flow({ page, shot }) {
  for (const lang of ["中文", "EN"]) {
    for (const [path, englishText] of Object.entries(pages)) {
      await page.goto(path);
      if (lang === "EN") await page.getByRole("button", { name: "Switch to English" }).click();
      else await page.getByRole("button", { name: "中文" }).click();
      if (lang === "EN") await page.getByText(englishText).first().waitFor();
      else await page.locator("[aria-busy]").waitFor({ state: "detached" });
      await shot(`${lang === "EN" ? "en" : "zh"}${path.replace("/", "-") || "-"}`.replace(/-$/, "-sheet"));
    }
  }
  await page.getByRole("button", { name: "Sign Out" }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Sign Out" }).click();
  await page.waitForURL("**/cdn-cgi/access/logout");
};
