import assert from 'node:assert/strict';
export default async function sheetFeedbackContext({page,shot}) {
  await page.goto('/');
  await page.locator('#cash-input').fill('50');
  const date=await page.locator('.date-value').innerText();
  await page.getByRole('button',{name:'保存账单',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'确认保存',exact:true}).click();
  await page.locator('.sheet-profit-summary [role="status"]').filter({hasText:'已保存'}).waitFor();
  assert.equal(await page.locator('.feedback-message').count(),0);
  await page.getByRole('button',{name:'删除当日账单',exact:true}).click();
  const dialog=page.getByRole('dialog');
  assert.equal(await dialog.locator('time').getAttribute('datetime'),date);
  assert.equal(await dialog.getByText(date,{exact:true}).count(),1,'The confirmation should state its date once');
  assert.equal(await dialog.getByText('RM 0.00',{exact:true}).evaluate(el=>el.classList.contains('text-finance-loss')),false,'A zero saved cost is neutral');
  await shot('whole-sheet-delete',page,{fullPage:false});
  await dialog.getByRole('button',{name:'确认删除',exact:true}).click();
  const message=page.locator('.feedback-message').filter({hasText:'当日账单已删除'});
  await message.waitFor();
  const feedback=await message.boundingBox(),dock=await page.locator('.sheet-save-panel').boundingBox();
  const revenue=await page.locator('.daily-revenue').boundingBox();
  assert(feedback&&revenue&&feedback.y+feedback.height<=revenue.y-8,'Feedback belongs below the heading, before entry fields');
  assert(feedback&&dock&&feedback.y>=0&&feedback.y+feedback.height<=dock.y-8,'Deletion feedback must remain fully visible above the dock');
  assert.equal(await page.getByRole('button',{name:'删除当日账单',exact:true}).count(),0);
  await shot('whole-sheet-deleted',page,{fullPage:false});
}
