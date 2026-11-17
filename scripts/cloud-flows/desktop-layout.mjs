import assert from 'node:assert/strict';

export default async function desktopLayout({page,shot}) {
  page.setDefaultNavigationTimeout(60000);
  let headingLeft,monthRight,contentRight;
  for(const [path,name] of [['/','daily-sheet'],['/dashboard?month=2026-10','overview'],['/expenses?month=2026-10','expenses'],['/close?month=2026-10','month-close'],['/settings','settings']]) {
    await page.goto(path);
    const heading=page.locator('main h1');
    await heading.waitFor();
    await page.locator('[aria-busy=true]').first().waitFor({state:'detached'});
    await page.evaluate(()=>document.fonts.ready);
    const box=await heading.boundingBox();
    assert(box);
    headingLeft??=box.x;
    assert(Math.abs(box.x-headingLeft)<=1,'Desktop destinations must retain one heading edge');
    const month=page.locator('.month-picker-trigger');
    if(await month.count()) {
      const bounds=await month.boundingBox();
      assert(bounds);
      monthRight??=bounds.x+bounds.width;
      assert(Math.abs(bounds.x+bounds.width-monthRight)<=1,'Desktop month controls must retain their toolbar edge');
    }
    const right=await page.locator('main .page-stack, main .daily-layout, main .dashboard-layout').first().evaluate(root=>Math.max(...[...root.children].filter(el=>!el.matches('.page-heading,.sheet-page-heading,.sheet-date-bar,dialog')&&el.getBoundingClientRect().width>0).map(el=>el.getBoundingClientRect().right)));
    contentRight??=right;
    assert(Math.abs(right-contentRight)<=1,`Desktop destinations must share one content width (${path}: ${right} vs ${contentRight})`);
    if(await month.count()) assert(Math.abs((await month.boundingBox()).x+(await month.boundingBox()).width-right)<=1,'The month control must line up with the content it changes');
    await page.waitForTimeout(900);
    await shot(name,page,{fullPage:false});
  }
}
