import assert from 'node:assert/strict';

export default async function compositionCharts({page,shot}) {
  for(const theme of ['light','dark']) {
    await page.goto('/settings');
    await page.getByRole('radio',{name:theme==='light'?/明亮模式/:/深色模式/}).check();
    for(const width of [320,390]) {
      await page.setViewportSize({width,height:844});
      await page.goto('/dashboard');
      await page.locator('[aria-busy="true"]').first().waitFor({state:'detached'});
      await page.locator('.revenue-donut').waitFor();
      assert.equal(await page.locator('.cash-account dd').innerText(),'RM 1,350.00');
      assert.equal(await page.locator('.tng-account dd').innerText(),'RM 350.00');
      assert.match(await page.locator('.revenue-donut').innerText(),/79%/);
      const colors=await page.evaluate(()=>({segments:[...document.querySelectorAll('.revenue-donut circle')].map(el=>getComputedStyle(el).stroke),icons:['.tng-account dt>span','.cash-account dt>span'].map(selector=>getComputedStyle(document.querySelector(selector)).color)}));
      assert.deepEqual(colors.segments,colors.icons,'Donut segments and their payment-channel legend icons must use matching colors in both themes');
      assert.deepEqual(await page.locator('.composition-total').allTextContents(),['RM 1,700.00','RM 475.00'],'Each composition needs its nearby monetary total');
      const amounts=await page.locator('.cost-bar-row dd').allTextContents();
      assert.deepEqual(amounts,['RM 450.00','RM 25.00']);
      const bars=await page.locator('.cost-bar-row').evaluateAll(rows=>rows.map(row=>({bar:getComputedStyle(row.querySelector('.cost-bar-track>span')).backgroundColor,dot:getComputedStyle(row.querySelector('.cost-bar-dot')).backgroundColor})));
      assert(bars.every(row=>row.bar===row.dot)&&new Set(bars.map(row=>row.bar)).size===bars.length,'Each cost category needs its own colour, matched by the dot beside its name');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await page.locator('.overview-composition').scrollIntoViewIfNeeded();
      await shot(`composition-${theme}-${width}`,page,{fullPage:false});
    }
  }
}
