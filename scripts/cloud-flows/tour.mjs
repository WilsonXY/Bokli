// Every cloud page in both languages (run with and without --mobile), plus
// Settings (Bright Mode default, Dark Mode toggle, Language toggle) and Sign Out.
const pages = {
  "/": "Cash Revenue",
  "/dashboard": "Cash vs TnG Split",
  "/expenses": "Stall Rent",
  "/close": "Close Month",
  "/settings": "Appearance",
};

async function setLanguage(page, lang) {
  await page.goto("/settings");
  const name = lang === "EN" ? "Switch to English" : "切换到中文 (Switch to Chinese)";
  await page.getByRole("radio", { name }).click();
}

export default async function flow({ page, shot }) {
  for (const lang of ["中文", "EN"]) {
    await setLanguage(page, lang);
    for (const [path, englishText] of Object.entries(pages)) {
      await page.goto(path);
      if (lang === "EN") await page.getByText(englishText).first().waitFor();
      else await page.locator("[aria-busy]").waitFor({ state: "detached" }).catch(() => {});
      await shot(`${lang === "EN" ? "en" : "zh"}${path.replace("/", "-") || "-"}`.replace(/-$/, "-sheet"));
    }
  }

  // Verify Dark Mode toggle in Settings, then switch back to Bright Mode
  await page.goto("/settings");
  await page.getByRole("radio", { name: "Switch to Dark Mode" }).click();
  await page.waitForFunction(() => document.documentElement.classList.contains("dark"));
  await shot("en-settings-dark");
  await page.getByRole("radio", { name: "Switch to Bright Mode" }).click();
  await page.waitForFunction(() => !document.documentElement.classList.contains("dark"));

  // Sign Out from Settings
  await page.getByRole("button", { name: "Sign Out" }).last().click();
  await page.getByRole("dialog").getByRole("button", { name: "Sign Out" }).click();
  await page.waitForURL("**/cdn-cgi/access/logout");
};
