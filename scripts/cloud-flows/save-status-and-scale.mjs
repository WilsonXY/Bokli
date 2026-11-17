import assert from 'node:assert/strict';

export default async function saveStatusAndScale({ page, shot }) {
  await page.goto('/dashboard');
  await page.locator('.overview-trend').waitFor();
  await page.locator('[aria-busy="true"]').first().waitFor({ state: 'detached' });
  const unit = page.locator('.trend-unit');
  assert.equal(await unit.evaluate(el=>el.tagName.toLowerCase()),'span','Currency belongs in the chart header, away from point labels');
  assert.equal(await unit.textContent(),'RM');
  assert.equal(await page.locator('.trend-scale').count(),0,'Avoid duplicating a point amount as an upper-axis label');
  await page.getByRole('tab', { name: '日常开销', exact: true }).click();
  await page.setViewportSize({width:320,height:844});
  await page.waitForFunction(()=>{const svg=document.querySelector('.trend-plot');return svg&&Math.abs(svg.viewBox.baseVal.width-svg.getBoundingClientRect().width)<1;});
  assert.deepEqual(await page.locator('.trend-value-label').allTextContents(),['175.00','150.00','150.00'],'All three exact point values must remain readable at 320px');
  const currency=await unit.boundingBox();
  const plot=await page.locator('.trend-plot').boundingBox();
  assert(currency&&plot&&currency.y+currency.height<=plot.y-8,'The currency must stay clear of point labels');
  await shot('explicit-scales-320', page, { fullPage: false });
  await page.setViewportSize({width:390,height:844});
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
  assert.equal(await page.locator('.cost-editor .record-actions .cost-delete-action').count(),1,'Delete belongs to the opened record details');
  await save.click();
  await page.getByRole('dialog').getByRole('button', { name: '确认保存', exact: true }).click();
  await status.filter({ hasText: '已保存' }).waitFor();
  assert(await save.isDisabled());
  await shot('stored-status', page, { fullPage: false });
}
