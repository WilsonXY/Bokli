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
  assert(await error.locator('.save-error-copy>span').evaluateAll(nodes=>nodes.every(el=>parseFloat(getComputedStyle(el).fontSize)>=16)),'Recovery guidance needs normal readable body text');
  assert.equal(await page.locator('.sheet-profit-summary [role="status"]').innerText(),'Save failed','The persistent Save area must also identify the failed attempt');
  assert.equal(await error.getByText('Not saved. Your draft is kept.',{exact:true}).count(),1,'An unidentified rejection must state that the draft remains available');
  assert.equal(await error.getByText('Try saving again. If it still fails, ask for help.',{exact:true}).count(),1,'An unqualified rejection must offer recovery without blaming an unidentified field');
  assert(await page.getByRole('button',{name:'Save Sheet',exact:true}).isEnabled(),'A rejected write must allow another save attempt');
  const box=await error.boundingBox(),dock=await page.locator('.sheet-save-panel').boundingBox();
  assert.equal(await page.locator('#cash-input').inputValue(),'50','A rejected write must retain the cash draft');
  assert.equal(await page.locator('.cost-entry-card').count(),12,'A rejected write must retain every Cost Line');
  assert(await error.evaluate(el=>el===document.activeElement),'A newly reported failure must receive accessible focus');
  assert(await error.getByText('The amounts could not be verified.',{exact:true}).evaluate(el=>el.getBoundingClientRect().height<=30),'The short failure reason must fit on one line instead of wrapping beside the close button');
  await shot('failed-save-feedback',page,{fullPage:false});
  assert(box&&dock&&box.y>=0&&box.y+box.height<=dock.y-8,'A failed save must bring its error into view without losing the draft');
  await page.unroute('**/api/cloud-v1/sheets');
  await page.getByRole('button',{name:'Save Sheet',exact:true}).click();
  const committed=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/cloud-v1/sheets'&&response.request().method()==='POST'&&response.ok());
  await page.getByRole('dialog').getByRole('button',{name:'Confirm & Save',exact:true}).click();
  await committed;
  await page.locator('.sheet-profit-summary [role="status"]').filter({hasText:/^Saved$/}).waitFor();
  await page.reload();
  await page.locator('.sheet-profit-summary [role="status"]').filter({hasText:/^Saved$/}).waitFor();
  assert.equal(await page.locator('#cash-input').inputValue(),'50');
  assert.equal(await page.locator('.cost-entry-card').count(),12,'Retry must store every retained Cost Line');
  assert(await page.locator('.sheet-save-status').evaluate(el=>el.classList.contains('is-saved')&&getComputedStyle(el).color!==getComputedStyle(document.querySelector('.sheet-profit-summary')).color),'A stored sheet must show a distinct green Saved confirmation');
  await shot('retried-and-stored',page,{fullPage:false});
}
