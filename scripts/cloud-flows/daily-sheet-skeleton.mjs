// Daily Sheet skeleton: switching dates shows a skeleton with the same boxes
// as the loaded (empty) sheet, so nothing jumps when the data lands.
// Run with and without --mobile.
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// The sheet's top-level blocks and their direct children, as rounded rects.
const layout = (page) =>
  page.$$eval("main > div > div.space-y-4 > *, main > div > div.space-y-4 > * > *", (els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return [r.x, r.y, r.width, r.height].map(Math.round);
    }),
  );

export default async function flow({ page, shot }) {
  await page.goto("/");
  await page.getByRole("button", { name: "Switch to English" }).click();
  await page.locator("#cash-input").waitFor();
  await pause(1000);

  // Hold the next sheet load so the skeleton stays on screen.
  let release;
  await page.route("**/api/**sheets*", async (route) => {
    await new Promise((r) => (release = r));
    await route.continue();
  });
  await page.getByRole("button", { name: "Prev Day" }).click();
  await page.locator('[aria-busy="true"]').waitFor();
  await pause(1500);
  const skeleton = await layout(page);
  await shot("skeleton");

  release();
  await page.locator("#cash-input").waitFor();
  await pause(1500);
  const loaded = await layout(page);
  await shot("loaded");

  const off = loaded
    .map((box, i) => [i, box, skeleton[i]])
    .filter(([, box, sk]) => !sk || box.some((v, j) => Math.abs(v - sk[j]) > 1));
  if (skeleton.length !== loaded.length || off.length) {
    throw new Error(`skeleton boxes differ from the loaded sheet:\n${JSON.stringify({ skeleton, loaded, off })}`);
  }
}
