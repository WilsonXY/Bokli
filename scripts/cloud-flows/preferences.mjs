// Preferences are changed through the same Settings controls as the Operator.
export async function chooseLanguage(page, lang) {
  const destination = page.url();
  await page.goto("/settings");
  await page.getByRole("radio", { name: lang === "en" ? /English/ : /简体中文/ }).check();
  await page.waitForFunction(expected => document.documentElement.lang === expected, lang === "en" ? "en" : "zh-Hans");
  await page.goto(destination);
}
