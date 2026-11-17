import assert from "node:assert/strict";

const geometry = async (surface, buttons) => {
  const panel = await surface.boundingBox();
  const first = await buttons.first().boundingBox();
  const last = await buttons.last().boundingBox();
  assert(panel && first && last);
  return {
    left: Math.round(first.x - panel.x),
    right: Math.round(panel.x + panel.width - last.x - last.width),
    height: Math.round(first.height),
    radius: await buttons.first().evaluate(el => getComputedStyle(el).borderRadius),
  };
};

export default async function dialogGeometry({ page, shot }) {
  await page.goto('/');
  await page.locator('#cash-input').fill('123.45');
  await page.getByRole('button', { name: '保存账单', exact: true }).click();
  const save = page.locator('.confirmation-sheet');
  const saveGeometry = await geometry(save, save.locator('.confirmation-actions > button'));
  await shot('save-dialog', page, { fullPage: false });
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '撤销修改', exact: true }).click();
  const revert = page.locator('dialog[open]');
  const revertGeometry = await geometry(revert, revert.locator('.dialog-actions > button'));
  await shot('revert-dialog', page, { fullPage: false });
  assert.deepEqual(saveGeometry, revertGeometry, 'Financial and native confirmations must share action insets, height and corners');
}
