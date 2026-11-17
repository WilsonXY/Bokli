import assert from 'node:assert/strict';
import {chooseLanguage} from './preferences.mjs';

async function openExpenseForm(page) {
  await page.goto('/expenses');
  await page.locator('.expense-month-summary').waitFor();
  if(!await page.locator('#expense-category').count()) await page.getByRole('button',{name:/^(添加支出|Add Expense)$/}).click();
  await page.locator('#expense-category').waitFor();
}

async function openPicker(page, selector, shot, name) {
  const select=page.locator(selector);
  await select.scrollIntoViewIfNeeded();
  assert.equal(await select.evaluate(el=>getComputedStyle(el).appearance),'base-select','Category menus must use the app-styled picker on desktop and phone');
  await select.click();
  await page.waitForFunction(selector=>document.querySelector(selector)?.matches(':open'),selector);
  const layout=await select.evaluate(el=>{
    const picker=getComputedStyle(el,'::picker(select)');
    const trigger=el.getBoundingClientRect();
    const options=[...el.options].map(option=>{const r=option.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,height:r.height};});
    return {appearance:picker.appearance,background:picker.backgroundColor,borderRadius:picker.borderRadius,trigger:{left:trigger.left,right:trigger.right},options,width:innerWidth,height:innerHeight};
  });
  assert.equal(layout.appearance,'base-select','The options list must be styled too, rather than using the OS dialog');
  assert.notEqual(layout.background,'rgba(0, 0, 0, 0)');
  assert(parseFloat(layout.borderRadius)>=8);
  for(const option of layout.options) {
    assert(option.height>=44,'Options need comfortable touch targets');
    assert(option.left>=0&&option.right<=layout.width,'The open menu must stay inside the viewport');
  }
  const first=layout.options[0],last=layout.options.at(-1);
  assert(first.top>=0&&last.bottom<=layout.height,'The options must remain visible above or below the field');
  assert(Math.abs(first.left-layout.trigger.left)<=16,'The menu must stay anchored to its field');
  await shot(name,page,{fullPage:false});
}

export default async function categoryDropdowns({page,shot}) {
  await openExpenseForm(page);
  await page.locator('#expense-amount').fill('5');
  for(const width of [1280,390,320]) {
    await page.setViewportSize({width,height:844});
    await openPicker(page,'#expense-category',shot,`expense-menu-light-${width}`);
    await page.locator('#expense-category option[value="utilities"]').click();
    assert.equal(await page.locator('#expense-category').inputValue(),'utilities');
    assert(!await page.locator('#expense-category').evaluate(el=>el.matches(':open')));
  }
  await page.goto('/');
  await page.getByRole('button',{name:/添加开销/}).click();
  await page.locator('.cost-editor input.money-input').fill('5');
  for(const width of [1280,390,320]) {
    await page.setViewportSize({width,height:844});
    await openPicker(page,'#cost-category-0',shot,`cost-menu-light-${width}`);
    await page.keyboard.press('Escape');
    assert(!await page.locator('#cost-category-0').evaluate(el=>el.matches(':open')));
  }
  await page.locator('#cost-category-0').focus();
  await page.setViewportSize({width:320,height:560});
  await page.locator('#cost-category-0').scrollIntoViewIfNeeded();
  await page.keyboard.press('Space');
  await page.keyboard.press('End');
  const last=await page.locator('#cost-category-0 option').last().boundingBox();
  assert(last&&last.y>=0&&last.y+last.height<=560,'A short phone viewport must let the final option scroll into view');
  await shot('cost-menu-short-phone',page,{fullPage:false});
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#cost-category-0').inputValue(),'other','Keyboard selection must still update the Cost Line');
  await page.getByRole('button',{name:'保存账单',exact:true}).click();
  await page.locator('[id^="other-note-error-"]').waitFor();
  await page.goto('/settings');
  await page.getByRole('radio',{name:/深色模式/}).check();
  await openExpenseForm(page);
  for(const width of [1280,390,320]) {
    await page.setViewportSize({width,height:844});
    await openPicker(page,'#expense-category',shot,`expense-menu-dark-${width}`);
    await page.keyboard.press('Escape');
  }
  await page.locator('#expense-category').click();
  await page.mouse.click(8,8);
  assert(!await page.locator('#expense-category').evaluate(el=>el.matches(':open')),'Tapping outside must dismiss the category menu');
  await chooseLanguage(page,'en');
  await openExpenseForm(page);
  await openPicker(page,'#expense-category',shot,'expense-menu-english-phone');
  await page.keyboard.press('Escape');
}
