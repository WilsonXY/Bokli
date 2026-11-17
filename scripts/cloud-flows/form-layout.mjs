import assert from 'node:assert/strict';

export default async function formLayout({page,shot}) {
  await page.goto('/');
  for(const category of ['restock','transport','other']) {
    await page.getByRole('button',{name:/添加开销/}).click();
    await page.locator('.cost-editor select').selectOption(category);
    await page.locator('.cost-editor input.money-input').fill('5');
  }
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
}
