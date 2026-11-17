import assert from 'node:assert/strict';

export default async function saveStatusAndScale({ page, shot }) {
  await page.goto('/dashboard');
  await page.locator('.overview-trend').waitFor();
  await page.locator('[aria-busy="true"]').first().waitFor({ state: 'detached' });
  const scale = page.locator('.trend-scale');
  assert(await scale.count(), 'The chart needs a visible upper scale value');
  const upper = await scale.innerText();
  await page.getByRole('tab', { name: '日常开销', exact: true }).click();
  assert.equal(await scale.innerText(), upper, 'Revenue and Daily Costs must share a scale');
  await shot('shared-scale', page, { fullPage: false });
  await page.goto('/');
  await page.locator('#cash-input').fill('50');
  const status = page.locator('.sheet-profit-summary [role="status"]');
  await status.filter({ hasText: '未保存' }).waitFor();
  const save = page.locator('.sheet-save-action');
  const undo = page.locator('.sheet-revert-action');
  assert.equal((await save.boundingBox()).height, (await undo.boundingBox()).height, 'Footer actions need equal height');
  assert.equal((await save.boundingBox()).width, (await undo.boundingBox()).width, 'Footer actions need equal width');
  await page.getByRole('button', { name: /添加开销/ }).click();
  await page.locator('.cost-editor input.money-input').fill('5');
  const header = page.locator('.cost-record-header');
  assert.equal(await header.locator('.cost-delete-action').count(), 1, 'Delete belongs to the Cost Line header');
  await save.click();
  await page.getByRole('dialog').getByRole('button', { name: '确认保存', exact: true }).click();
  await status.filter({ hasText: '已保存' }).waitFor();
  assert(await save.isDisabled());
  await shot('stored-status', page, { fullPage: false });
}
