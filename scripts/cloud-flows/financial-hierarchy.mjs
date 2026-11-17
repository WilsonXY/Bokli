import assert from 'node:assert/strict';

export default async function financialHierarchy({ page, shot }) {
  for (const theme of ['light', 'dark']) {
    await page.goto('/settings');
    await page.getByRole('radio', { name: theme === 'light' ? /明亮模式/ : /深色模式/ }).check();
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto('/dashboard');
      await page.locator('.cost-bar-row').first().waitFor();
      const rows = await page.locator('.cost-bar-row').evaluateAll(nodes => nodes.map(row => {
        const amount = row.querySelector('dd').getBoundingClientRect();
        const percent = row.querySelector('small').getBoundingClientRect();
        const bar = row.querySelector('.cost-bar-track').getBoundingClientRect();
        return { amountBottom: amount.bottom, percentTop: percent.top, percentLeft: percent.left, barRight: bar.right };
      }));
      for (const row of rows) {
        assert(row.percentTop >= row.amountBottom + 4, 'Percentages need their own line clear of the monetary amount');
        assert(row.percentLeft >= row.barRight + 8, 'Percentages need a clear gap beside the bar');
      }
      await page.locator('.overview-costs').scrollIntoViewIfNeeded();
      await shot(`distribution-${theme}-${width}`, page, { fullPage: false });
    }
  }
  await page.goto('/');
  await page.getByRole('button', { name: /添加开销/ }).click();
  await page.locator('.cost-editor input.money-input').fill('5');
  const note = await page.locator('.cost-editor .note-input').boundingBox();
  const remove = await page.locator('.cost-record-header .cost-delete-action').boundingBox();
  assert(note && remove && remove.y + remove.height < note.y, 'Delete must belong to the Cost Line header, clear of the Note field');
  const hierarchy = await page.locator('.daily-costs').evaluate(section => ({
    total: parseFloat(getComputedStyle(section.querySelector('.section-heading>span:last-child')).fontSize),
    row: parseFloat(getComputedStyle(section.querySelector('.money-list-value')).fontSize),
  }));
  assert(hierarchy.total >= hierarchy.row, 'A section total must be at least as prominent as its individual amounts');
  await page.locator('.cost-editor').scrollIntoViewIfNeeded();
  await shot('cost-actions-and-total', page, { fullPage: false });
}
