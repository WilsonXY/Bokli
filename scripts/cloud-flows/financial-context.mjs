import assert from 'node:assert/strict';
import {chooseLanguage} from './preferences.mjs';

export default async function financialContext({page,shot}) {
  await page.goto('/');
  const today=await page.evaluate(async()=>(await(await fetch('/api/cloud-v1/sheets')).json()).todayKl);
  const date=new Date(Date.parse(`${today}T00:00:00Z`)-86400000).toISOString().slice(0,10);
  await page.goto(`/?date=${date}`);
  await page.locator('#cash-input').fill('5');
  await page.locator('#tng-input').fill('7');
  await page.getByRole('button',{name:'保存账单',exact:true}).click();
  const dialog=page.getByRole('dialog');
  assert.equal(await dialog.locator('time[datetime]').count(),1,'Save confirmation must identify the selected calendar date');
  assert.equal(await dialog.locator('time').getAttribute('datetime'),date);
  assert.match(await dialog.locator('time').innerText(),new RegExp(date));
  assert(!await dialog.locator('h3').innerText().then(text=>text.includes('今日')),'Historical confirmation must not call the sheet today');
  assert.equal(await dialog.locator('[data-channel="cash"]').count(),1,'Cash must be independently reviewable');
  assert.match(await dialog.locator('[data-channel="cash"]').innerText(),/现金\s*RM 5\.00/,'Cash must be independently reviewable');
  assert.match(await dialog.locator('[data-channel="tng"]').innerText(),/TnG\s*RM 7\.00/,'TnG must be independently reviewable');
  await shot('historical-save-date',page,{fullPage:false});
  await dialog.getByRole('button',{name:'取消',exact:true}).click();
  await page.getByRole('button',{name:/添加开销/}).click();
  await page.locator('.cost-editor input.money-input').fill('5');
  await page.locator('.cost-editor .cost-delete-action').click();
  await page.getByRole('dialog').getByText('保存账单后生效。',{exact:true}).waitFor();
  await shot('draft-delete-timing',page,{fullPage:false});
  await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();
  await page.goto('/expenses');
  await page.locator('.expense-month-summary').waitFor();
  await page.getByRole('button',{name:'添加支出',exact:true}).click();
  assert(await page.locator('.expense-month-summary').isVisible(),'Monthly totals must remain visible during Operating Expense entry');
  await shot('expense-context-retained',page,{fullPage:false});
  await chooseLanguage(page,'en');
  await page.goto('/');
  await page.locator('#cash-input').waitFor();
  for (const width of [320,390]) {
    await page.setViewportSize({width,height:844});
    await page.evaluate(()=>document.fonts.ready);
    const today=page.locator('.date-today-badge');
    const fit=await today.evaluate(el=>{
      const range=document.createRange();range.selectNodeContents(el);
      return {button:el.getBoundingClientRect().width,text:range.getBoundingClientRect().width};
    });
    assert(fit.button-fit.text>=22,'Today needs comfortable horizontal padding in English');
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'The wider Today button must fit the narrow phone');
    await shot(`english-today-${width}`,page,{fullPage:false});
  }
}
