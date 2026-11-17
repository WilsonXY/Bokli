import assert from 'node:assert/strict';

export default async function formLayout({page,shot}) {
  await page.goto('/');
  for(const category of ['restock','transport','other']) {
    await page.getByRole('button',{name:/添加开销/}).click();
    await page.locator('.cost-editor select').selectOption(category);
    await page.locator('.cost-editor input.money-input').fill('5');
  }
  const active=page.locator('.cost-entry-card').last();
  assert.equal(await active.locator('.cost-record-header .cost-delete-action').count(),1,'Delete must identify its Cost Line in the header');
  const remove=await active.locator('.cost-delete-action').boundingBox();
  const chevron=await active.locator('.record-chevron').boundingBox();
  assert(remove&&chevron&&remove.width>=44&&remove.height>=44&&remove.x+remove.width<=chevron.x-8,'Delete and collapse need separate comfortable targets');
  const gap=await active.evaluate(card=>card.querySelector('.cost-editor label').getBoundingClientRect().top-card.querySelector('.cost-category-label').getBoundingClientRect().bottom);
  assert(gap>=8&&gap<=20,'The expanded summary must lead into its fields without an oversized gap');
  const edges=await page.locator('.cost-record-summary .tabular-nums').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().right));
  const note=await page.locator('.cost-editor .note-input').boundingBox();
  const editor=await page.locator('.cost-editor').evaluate(el=>({width:el.getBoundingClientRect().width,padding:parseFloat(getComputedStyle(el).paddingLeft)+parseFloat(getComputedStyle(el).paddingRight)}));
  assert(note);
  assert(Math.max(...edges)-Math.min(...edges)<=1,'Expanding a Cost Line must preserve the amount column');
  assert(note.width>=editor.width-editor.padding-2,'Notes need the full available editor width');
  await page.getByRole('button',{name:'保存账单',exact:true}).click();
  const error=page.locator('[id^="other-note-error-"]');
  await error.waitFor();
  const bounds=await error.boundingBox();
  assert(bounds&&bounds.width>=note.width-1,'Note validation needs the same full width as its field');
  await shot('full-width-note',page,{fullPage:false});
  await page.locator('.cost-record-summary').nth(1).click();
  const middle=page.locator('.cost-entry-card').nth(1);
  assert.equal(await middle.locator('.cost-editor').count(),1);
  assert.equal(await middle.locator('.cost-delete-action').count(),1,'The middle Cost Line must own its delete action');
  await middle.scrollIntoViewIfNeeded();
  await shot('middle-cost-entry',page,{fullPage:false});
}
