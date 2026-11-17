import assert from "node:assert/strict";
export default async function revertDraft({page,shot}) {
  await page.goto("/");
  await page.locator("#cash-input").fill("123.45");
  await page.getByRole("button",{name:"撤销修改",exact:true}).click();
  const dialog=page.getByRole("dialog");
  await dialog.waitFor();
  assert.equal(await dialog.locator('time').getAttribute('datetime'),await page.locator('.date-value').innerText(),'Undo must identify the Daily Sheet it affects');
  assert.match(await dialog.innerText(),/全部未保存修改/,'Undo must clearly apply to every unsaved change on this sheet');
  await shot("revert-confirmation",page,{fullPage:false});
  await dialog.getByRole("button",{name:"取消",exact:true}).click();
  assert.equal(await page.locator("#cash-input").inputValue(),"123.45");
  await page.getByRole("button",{name:"撤销修改",exact:true}).click();
  await page.getByRole("dialog").getByRole("button",{name:"确认撤销",exact:true}).click();
  assert.equal(await page.locator("#cash-input").inputValue(),"");
  await page.waitForFunction(()=>document.activeElement?.id==="cash-input");
  assert.equal(await page.evaluate(async()=>(await(await fetch("/api/cloud-v1/sheets")).json()).data),null);
  await shot("reverted-without-saving",page,{fullPage:false});
}
