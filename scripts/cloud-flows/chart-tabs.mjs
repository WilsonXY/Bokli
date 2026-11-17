import assert from "node:assert/strict";
export default async function chartTabs({page,shot}) {
  await page.goto('/dashboard');
  await page.locator('.overview-trend').waitFor();
  await page.locator('[aria-busy="true"]').first().waitFor({state:'detached'});
  const tabs=page.getByRole('tablist',{name:'趋势数据'});
  const originalViewport=page.viewportSize();
  for(const width of [320,390,1280]) {
    await page.setViewportSize({width,height:844});
    const margins=await tabs.evaluate(rail=>{
      const bounds=rail.getBoundingClientRect();
      const buttons=rail.querySelectorAll('button');
      const first=buttons[0].getBoundingClientRect(),last=buttons[buttons.length-1].getBoundingClientRect();
      return {left:first.left-bounds.left,right:bounds.right-last.right,firstWidth:first.width,lastWidth:last.width,pairWidth:last.right-first.left};
    });
    assert(Math.abs(margins.left-margins.right)<=1,'The chart tabs must be centered with equal space at both ends');
    assert(Math.abs(margins.firstWidth-margins.lastWidth)<=1,'Both tab shapes need the same width');
    if(width<=390) assert(margins.pairWidth<=260&&margins.left>=16&&margins.right>=16,'Phone tabs need a compact pair with clear outer space');
  }
  await page.setViewportSize(originalViewport);
  const revenue=tabs.getByRole('tab',{name:'营业收入',exact:true});
  const costs=tabs.getByRole('tab',{name:'日常开销',exact:true});
  const records=await page.locator('.daily-record').allTextContents();
  await costs.click({timeout:3000});
  assert.deepEqual(await page.locator('.daily-record').allTextContents(),records,'Chart tabs must leave the separate Daily Sheets list unchanged');
  assert.equal(await costs.getAttribute('aria-selected'),'true');
  await page.getByRole('tabpanel').getByRole('heading',{name:'每日开销趋势',exact:true}).waitFor();
  const swatch=await page.locator('.trend-reference-key').evaluate(el=>['::before','::after'].map(pseudo=>{const style=getComputedStyle(el,pseudo);return {width:parseFloat(style.width),height:parseFloat(style.height),border:style.borderStyle};}));
  assert(swatch.every(column=>column.height>column.width&&column.border==='dashed')&&swatch[0].height!==swatch[1].height,'The Revenue legend must depict outlined columns rather than an unchecked checkbox or a line series');
  assert.equal(await page.locator('.trend-legends .trend-legend').count(),2,'Both solid Costs and outlined Revenue need an explicit legend');
  await page.locator('.overview-trend').scrollIntoViewIfNeeded();
  await shot('cost-tab',page,{fullPage:false});
  await page.keyboard.press('ArrowLeft');
  assert.equal(await revenue.getAttribute('aria-selected'),'true');
  assert.equal(await revenue.evaluate(el=>el===document.activeElement),true);
  await page.getByRole('tabpanel').getByRole('heading',{name:'每日收入趋势',exact:true}).waitFor();
  await page.locator('.trend-frame').click({position:{x:10,y:10}});
  await page.locator('.overview-trend').scrollIntoViewIfNeeded();
  await shot('revenue-tab',page,{fullPage:false});
  await page.goto('/settings');
  await page.getByRole('radio',{name:/深色模式/}).check();
  await page.goto('/dashboard');
  await page.locator('[aria-busy="true"]').first().waitFor({state:'detached'});
  await page.getByRole('tab',{name:'日常开销',exact:true}).click();
  await page.locator('.overview-trend').scrollIntoViewIfNeeded();
  await shot('cost-tab-dark',page,{fullPage:false});
  await page.getByRole('tab',{name:'营业收入',exact:true}).click();
  await shot('revenue-tab-dark',page,{fullPage:false});
}
