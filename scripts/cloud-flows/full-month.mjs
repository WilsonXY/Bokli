import assert from 'node:assert/strict';

// A busy month: 20 recorded days using all six Daily Cost categories.
const categories = ['restock', 'gas', 'transport', 'wages-daily', 'maintenance', 'other'];

export default async function fullMonth({ page, shot }) {
  page.setDefaultNavigationTimeout(60000);
  for (let day = 1; day <= 20; day++) {
    const date = `2026-09-${String(day).padStart(2, '0')}`;
    await page.goto(`/?date=${date}`);
    await page.locator('#cash-input').fill(String(400 + day * 13 % 250));
    const category = categories[day % categories.length];
    await page.getByRole('button', { name: /添加开销/ }).click();
    await page.locator('#cost-category-0').selectOption(category);
    await page.locator('.cost-editor input.money-input').fill(String(30 + day * 7 % 90));
    if (category === 'other') await page.locator('.cost-editor .note-input').fill('杂项');
    await page.locator('.sheet-save-action').click();
    await page.getByRole('dialog').getByRole('button', { name: '确认保存', exact: true }).click();
    await page.locator('.sheet-profit-summary [role="status"]').filter({ hasText: '已保存' }).waitFor();
  }
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/dashboard?month=2026-09');
    await page.locator('[aria-busy="true"]').first().waitFor({ state: 'detached' });
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator('.trend-column').count(), 20, 'Every recorded day needs its own column');
    const labels = await page.locator('.trend-value-label').evaluateAll(nodes => nodes.map(el => el.getBoundingClientRect().toJSON()));
    for (let i = 1; i < labels.length; i++) assert(labels[i].left >= labels[i - 1].right + 4, 'Value labels must never collide in a busy month');
    assert.equal(await page.locator('.cost-bar-row').count(), 6, 'All six categories appear in the distribution');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'A busy month must not overflow the phone');
    await page.locator('.overview-trend').scrollIntoViewIfNeeded();
    await shot(`busy-month-revenue-${width}`, page, { fullPage: false });
    await page.getByRole('tab', { name: '日常开销', exact: true }).click();
    await shot(`busy-month-costs-${width}`, page, { fullPage: false });
    await page.locator('.overview-composition').scrollIntoViewIfNeeded();
    await page.locator('.cost-bar-row').last().scrollIntoViewIfNeeded();
    await shot(`busy-month-distribution-${width}`, page, { fullPage: false });
  }
}
