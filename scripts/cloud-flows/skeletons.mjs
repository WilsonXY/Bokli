// Loading skeletons: each page's skeleton has the same boxes as the loaded page
// (fake data), so nothing jumps when the data lands. Both languages; run with
// and without --mobile. The Daily Sheet is checked on a date switch, the month
// pages on load (the same skeleton shows when switching months).
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// The page's blocks (x, y, width, height) and their children (y, height).
const layout = (page) =>
  page.locator("main div.space-y-4").first().evaluate((root) =>
    [...root.children].flatMap((block) => {
      const r = block.getBoundingClientRect();
      return [
        [r.x, r.y, r.width, r.height].map(Math.round),
        ...[...block.children].map((c) => {
          const b = c.getBoundingClientRect();
          return [b.y, b.height].map(Math.round);
        }),
      ];
    }),
  );

function compare(name, skeleton, loaded) {
  if (!loaded.length) throw new Error(`${name}: no boxes found, check the selector`);
  const off = loaded.filter((box, i) => !skeleton[i] || box.some((v, j) => Math.abs(v - skeleton[i][j]) > 1));
  if (skeleton.length !== loaded.length || off.length) {
    throw new Error(`${name}: skeleton boxes differ from the loaded page:\n${JSON.stringify({ skeleton, loaded })}`);
  }
}

// Holds the page's next data load until the returned release() runs.
async function hold(page, api) {
  let release;
  const held = new Promise((r) => (release = r));
  await page.route(`**/api/**/${api}*`, async (route) => {
    await held;
    await route.continue();
  }, { times: 1 });
  return release;
}

const monthPages = [
  ["/dashboard", "dashboard"],
  ["/expenses", "expenses"],
  ["/close", "close"],
];

export default async function flow({ page, shot }) {
  for (const [lang, button] of [["en", "Switch to English"], ["zh", "中文"]]) {
    await page.goto("/");
    await page.getByRole("button", { name: button }).click();
    await page.locator("#cash-input").waitFor();
    await pause(800);

    const release = await hold(page, "sheets");
    await page.locator("main button").first().click(); // Prev Day
    await page.locator('[aria-busy="true"]').waitFor();
    await pause(1200);
    const skeleton = await layout(page);
    await shot(`${lang}-sheet-skeleton`);
    release();
    await page.locator("#cash-input").waitFor();
    await pause(1200);
    compare(`${lang} Daily Sheet`, skeleton, await layout(page));
    await shot(`${lang}-sheet-loaded`);

    for (const [path, api] of monthPages) {
      const release = await hold(page, api);
      await page.goto(path);
      await page.locator('[aria-busy="true"]').waitFor();
      await pause(1200);
      const skeleton = await layout(page);
      await shot(`${lang}-${api}-skeleton`);
      release();
      await page.locator('[aria-busy="true"]').waitFor({ state: "detached" });
      await pause(1200);
      compare(`${lang} ${path}`, skeleton, await layout(page));
      await shot(`${lang}-${api}-loaded`);
    }
  }
}
