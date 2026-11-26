// Shared by the cloud flows: change the language on /settings only after the
// page has applied the stored preference (hydration), and confirm the new one
// was saved before moving on, so the next page really loads in that language.
export async function setLanguage(page, lang) {
  await page.goto("/settings");
  await page.waitForFunction(() => {
    const stored = localStorage.getItem("bokli_lang") ?? "zh";
    return document.documentElement.lang === (stored === "zh" ? "zh-Hans" : "en");
  });
  await page.locator(`input[name="bokli-language"][value="${lang}"]`).check({ force: true });
  // Nothing stored means the default (Chinese), so "zh" on a fresh profile is
  // already in effect without a write.
  await page.waitForFunction(
    (want) =>
      (localStorage.getItem("bokli_lang") ?? "zh") === want &&
      document.documentElement.lang === (want === "zh" ? "zh-Hans" : "en"),
    lang,
  );
}
