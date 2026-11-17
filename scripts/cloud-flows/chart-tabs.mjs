import assert from "node:assert/strict";
export default async function chartTabs({page,shot}) {
  await page.goto('/dashboard');
  await page.locator('.overview-trend').waitFor();
  const tabs=page.getByRole('tablist',{name:'趋势数据'});
  const revenue=tabs.getByRole('tab',{name:'总收入',exact:true});
  const costs=tabs.getByRole('tab',{name:'总开销',exact:true});
  const records=await page.locator('.daily-record').allTextContents();
  await costs.click({timeout:3000});
  assert.deepEqual(await page.locator('.daily-record').allTextContents(),records,'Chart tabs must leave the separate Daily Sheets list unchanged');
  assert.equal(await costs.getAttribute('aria-selected'),'true');
  await page.getByRole('tabpanel').getByRole('heading',{name:'每日开销趋势',exact:true}).waitFor();
  await page.locator('.overview-trend').scrollIntoViewIfNeeded();
  await shot('cost-tab',page,{fullPage:false});
  await page.keyboard.press('ArrowLeft');
  assert.equal(await revenue.getAttribute('aria-selected'),'true');
  assert.equal(await revenue.evaluate(el=>el===document.activeElement),true);
  await page.getByRole('tabpanel').getByRole('heading',{name:'每日收入趋势',exact:true}).waitFor();
  await page.getByRole('tabpanel').getByRole('heading',{name:'每日收入趋势',exact:true}).click();
  await page.locator('.overview-trend').scrollIntoViewIfNeeded();
  await shot('revenue-tab',page,{fullPage:false});
}
