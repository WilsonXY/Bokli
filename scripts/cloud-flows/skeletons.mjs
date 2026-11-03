// Loading skeletons: each page's skeleton has the same boxes as the loaded page
// (fake data), so nothing jumps when the data lands. Both languages; run with
// and without --mobile. The Daily Sheet is checked on a date switch, the month
// pages on load (the same skeleton shows when switching months). Then last
// month is closed, and the page header (title and month picker) is checked
// again: the picker keeps its width whatever the month's status.
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// The page's blocks and their children: x, y, width, height.
const layout = (page) =>
  page.locator("main div.space-y-4").first().evaluate((root) =>
    [...root.children].flatMap((block) => [block, ...block.children]).map((e) => {
      const r = e.getBoundingClientRect();
      return [r.x, r.y, r.width, r.height].map(Math.round);
    }),
  );

const kl = new Date(Date.now() + 8 * 3600e3);
const lastMonth = new Date(Date.UTC(kl.getUTCFullYear(), kl.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
const languages = [["en", "Switch to English"], ["zh", "中文"]];

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

// Loads a month page with its data held; returns the skeleton's and the loaded
// page's boxes.
async function monthPage(page, path, api, name, shot) {
  const release = await hold(page, api);
  await page.goto(path, { waitUntil: "commit" });
  await page.locator('[aria-busy="true"]').waitFor();
  await pause(1200);
  const skeleton = await layout(page);
  await shot(`${name}-skeleton`);
  release();
  await page.locator('[aria-busy="true"]').waitFor({ state: "detached" });
  await pause(1200);
  const loaded = await layout(page);
  await shot(`${name}-loaded`);
  return [skeleton, loaded];
}

export default async function flow({ page, shot }) {
  for (const [lang, button] of languages) {
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
      compare(`${lang} ${path}`, ...(await monthPage(page, `${path}?month=${lastMonth}`, api, `${lang}-${api}`, shot)));
    }
  }

  // Close last month (seeded net profit RM305.00, all counted as cash).
  await page.goto(`/close?month=${lastMonth}`);
  await page.getByPlaceholder("0.00").nth(0).fill("305");
  await page.getByPlaceholder("0.00").nth(1).fill("0");
  await page.locator("form button[type=submit]").click();
  await page.locator("form button[type=submit]").waitFor({ state: "detached" });

  // The header (block 0, title, picker) is the first three boxes.
  for (const [lang, button] of languages) {
    await page.getByRole("button", { name: button }).click();
    for (const [path, api] of monthPages) {
      const [skeleton, loaded] = await monthPage(page, `${path}?month=${lastMonth}`, api, `${lang}-closed-${api}`, shot);
      compare(`${lang} ${path} (closed month) header`, skeleton.slice(0, 3), loaded.slice(0, 3));
    }
  }
}
