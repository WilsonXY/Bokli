import assert from 'node:assert/strict';

export default async function financialContext({page,shot}) {
  await page.goto('/');
  const today=await page.evaluate(async()=>(await(await fetch('/api/cloud-v1/sheets')).json()).todayKl);
  const date=new Date(Date.parse(`${today}T00:00:00Z`)-86400000).toISOString().slice(0,10);
  await page.goto(`/?date=${date}`);
  await page.locator('#cash-input').fill('5');
  await page.getByRole('button',{name:'保存账单',exact:true}).click();
  const dialog=page.getByRole('dialog');
  assert.equal(await dialog.locator('time[datetime]').count(),1,'Save confirmation must identify the selected calendar date');
  assert.equal(await dialog.locator('time').getAttribute('datetime'),date);
  assert.match(await dialog.locator('time').innerText(),new RegExp(date));
  assert(!await dialog.locator('h3').innerText().then(text=>text.includes('今日')),'Historical confirmation must not call the sheet today');
  await shot('historical-save-date',page,{fullPage:false});
}
