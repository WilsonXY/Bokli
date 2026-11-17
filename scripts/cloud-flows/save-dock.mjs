import assert from "node:assert/strict";
export default async function saveDock({page,shot}) {
  await page.goto('/');
  const initialSave = await page.getByRole('button',{name:'保存账单',exact:true}).boundingBox();
  assert(initialSave);
  await page.locator('#cash-input').fill('50');
  for(const category of ['restock','transport','gas']) {
    await page.getByRole('button',{name:/添加开销/}).click();
    await page.locator('.cost-editor select').selectOption(category);
    await page.locator('input[inputmode="decimal"]').nth(2).fill('5');
  }
  const note=page.locator('.cost-editor .note-input');
  await note.fill('手机录入检查');
  for(const [width,height] of [[390,844],[320,844],[390,560]]) {
    await page.setViewportSize({width,height});
    await note.scrollIntoViewIfNeeded();
    await note.click();
    const save=await page.getByRole('button',{name:'保存账单',exact:true}).boundingBox();
    const dock=await page.locator('.sheet-save-panel').boundingBox();
    const total=await page.locator('.sheet-profit-summary').boundingBox();
    const nav=await page.locator('.mobile-navigation').boundingBox();
    const field=await note.boundingBox();
    assert(save&&dock&&nav&&field&&total);
    if(width===390 && height===844) assert.equal(Math.round(save.x),Math.round(initialSave.x),'Save must stay in the same position after editing reveals Revert');
    assert(dock.x>=0 && dock.x+dock.width<=width,'The whole Save dock must fit inside the phone viewport');
    assert(save.y>=0 && save.y+save.height<=nav.y-8,'Save must stay reachable above navigation while entering costs');
    assert.equal(Math.round(dock.y+dock.height),Math.round(nav.y),'Save and navigation must form one opaque footer without a gap');
    assert(total.y>=dock.y && total.y+total.height<=dock.y+dock.height,'The running profit must remain inside the visible Save area');
    assert(field.y>=0 && field.y+field.height<=dock.y-8,'The Save dock must leave the focused field clear');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await shot(`entry-${width}-${height}`,page,{fullPage:false});
  }
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'保存账单',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'确认保存',exact:true}).click();
  const saved=page.locator('.sheet-save-action');
  await saved.getByText('已保存',{exact:true}).waitFor();
  assert.equal(await saved.isDisabled(),true,'A stored, unchanged sheet should show a completed state');
  await shot('stored-sheet',page,{fullPage:false});
  await page.locator('#cash-input').fill('51');
  assert.equal(await saved.isEnabled(),true,'Editing a stored sheet must make Save available again');
  await page.setViewportSize({width:320,height:844});
  for(const [amount,expected] of [['1000000','RM 999,985.00'],['1000000000','RM 999,999,985.00'],['1000000000000','RM 999,999,999,985.00']]) {
    await page.locator('#cash-input').fill(amount);
    await page.locator('.sheet-profit-summary').getByText(expected,{exact:true}).waitFor();
    const value=await page.locator('.sheet-profit-summary>div:last-child').boundingBox();
    const actions=await page.locator('.sheet-actions').boundingBox();
    assert(value&&actions&&value.x+value.width<=actions.x-8,'Large profit values must remain fully clear of footer actions');
  }
}

