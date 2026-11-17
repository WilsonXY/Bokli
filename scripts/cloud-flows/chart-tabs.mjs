import assert from "node:assert/strict";
export default async function chartTabs({page,shot}) {
  await page.goto('/dashboard');
  await page.locator('.overview-trend').waitFor();
  const tabs=page.getByRole('tablist',{name:'趋势数据'});
  const revenue=tabs.getByRole('tab',{name:'总收入',exact:true});
  const costs=tabs.getByRole('tab',{name:'总开销',exact:true});
  await costs.click({timeout:3000});
  assert.equal(await costs.getAttribute('aria-selected'),'true');
  await page.getByRole('tabpanel').getByRole('heading',{name:'每日开销趋势',exact:true}).waitFor();
  await shot('cost-tab',page,{fullPage:false});
  await page.keyboard.press('ArrowLeft');
  assert.equal(await revenue.getAttribute('aria-selected'),'true');
  assert.equal(await revenue.evaluate(el=>el===document.activeElement),true);
  await page.getByRole('tabpanel').getByRole('heading',{name:'每日收入趋势',exact:true}).waitFor();
  await shot('revenue-tab',page,{fullPage:false});
}
