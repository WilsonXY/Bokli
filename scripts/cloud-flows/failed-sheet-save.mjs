import assert from 'node:assert/strict';
import {chooseLanguage} from './preferences.mjs';
export default async function failedSheetSave({page,shot}) {
  await page.goto('/');
  await chooseLanguage(page,'en');
  await page.locator('#cash-input').fill('50');
  const status=page.locator('.sheet-profit-summary [role="status"]');
  assert.equal(await status.innerText(),'Unsaved');
  assert.equal(await status.filter({hasText:/^Saved$/}).count(),0,'Unsaved must never satisfy the save-completion check');
  for(let i=0;i<12;i++) {
    await page.getByRole('button',{name:'Add Cost',exact:true}).click();
    await page.locator('.cost-editor input.money-input').fill('2');
    await page.locator('.cost-editor .note-input').fill(`Distinct cost ${i+1}`);
  }
  await page.locator('.cost-editor .note-input').scrollIntoViewIfNeeded();
  await page.route('**/api/cloud-v1/sheets',async route=>{
    if(route.request().method()==='POST')await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'Forced validation failure',code:'invalidAmount'})});
    else await route.continue();
  });
  await page.getByRole('button',{name:'Save Sheet',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Confirm & Save',exact:true}).click();
  const error=page.getByRole('alert').filter({hasText:/amount/i});
  await error.waitFor();
  const box=await error.boundingBox(),dock=await page.locator('.sheet-save-panel').boundingBox();
  assert.equal(await page.locator('#cash-input').inputValue(),'50','A rejected write must retain the cash draft');
  assert.equal(await page.locator('.cost-entry-card').count(),12,'A rejected write must retain every Cost Line');
  assert(await error.evaluate(el=>el===document.activeElement),'A newly reported failure must receive accessible focus');
  await shot('failed-save-feedback',page,{fullPage:false});
  assert(box&&dock&&box.y>=0&&box.y+box.height<=dock.y-8,'A failed save must bring its error into view without losing the draft');
}
