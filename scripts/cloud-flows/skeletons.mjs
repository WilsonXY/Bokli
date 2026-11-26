import { setLanguage } from "./settings-helpers.mjs";
// Loading skeletons: nothing above the fold jumps when the data lands. Both
// languages; run with and without --mobile. The Daily Sheet (Mom's main page)
// is checked box for box on a date switch. The month pages are checked on load
// (the same skeleton shows when switching months) for the page header and where
// the content starts only: their cards change height with language and data,
// so the owner chose not to mirror every card. Then last
// month is closed, and the page header (title and month picker) is checked
// again: the picker keeps its width whatever the month's status.
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// The page's top-level layout sections: x, y, width, height.
const layout = (page) =>
  // Each view (and its skeleton) renders one root <div> under <main>.
  page.locator("main > div").first().evaluate((root) =>
    [...root.children].map((block) => {
      const r = block.getBoundingClientRect();
      return [r.x, r.y, r.width, r.height].map(Math.round);
    }),
  );

const kl = new Date(Date.now() + 8 * 3600e3);
const lastMonth = new Date(Date.UTC(kl.getUTCFullYear(), kl.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
const languages = [["en", "en"], ["zh-Hans", "zh"]];
const languageReady = (page, lang) =>
  page.waitForFunction((expected) => document.documentElement.lang === expected, lang);

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
async function monthPage(page, path, api, lang, name, shot) {
  const release = await hold(page, api);
  await page.goto(path, { waitUntil: "commit" });
  await page.locator('[aria-busy="true"]').waitFor();
  await languageReady(page, lang);
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
  page.setDefaultTimeout(60000); // this machine can be slow; data loads took 7 s
  for (const [lang, button] of languages) {
    await setLanguage(page, button);
    await page.goto("/");
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
      const [skeleton, loaded] = await monthPage(page, `${path}?month=${lastMonth}`, api, lang, `${lang}-${api}`, shot);
      // Header box, then the content's top-left corner and width.
      const start = (boxes) => [boxes[0], boxes[1]?.slice(0, 3)];
      compare(`${lang} ${path} header and content start`, start(skeleton), start(loaded));
    }
  }

  // Close last month (seeded net profit RM305.00, all counted as cash).
  await page.goto(`/close?month=${lastMonth}`);
  await page.getByPlaceholder("0.00").nth(0).fill("305");
  await page.getByPlaceholder("0.00").nth(1).fill("0");
  await page.locator("form button[type=submit]").click();
  await page.locator("form button[type=submit]").waitFor({ state: "detached" });

  // The header (block 0) keeps its height and width whatever the month's status.
  for (const [lang, button] of languages) {
    await setLanguage(page, button);
    for (const [path, api] of monthPages) {
      const [skeleton, loaded] = await monthPage(page, `${path}?month=${lastMonth}`, api, lang, `${lang}-closed-${api}`, shot);
      compare(`${lang} ${path} (closed month) header`, skeleton.slice(0, 1), loaded.slice(0, 1));
    }
  }
}
