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
  const arrow=select.locator('..').locator('svg');
  const closedArrow=await arrow.evaluate(el=>getComputedStyle(el).transform);
  await select.click();
  assert.notEqual(await arrow.evaluate(el=>getComputedStyle(el).transform),closedArrow,'Category menus must use the same expanded indicator as month menus');
  await page.waitForFunction(selector=>document.querySelector(selector)?.matches(':open'),selector);
  const layout=await select.evaluate(el=>{
    const picker=getComputedStyle(el,'::picker(select)');
    const trigger=el.getBoundingClientRect();
    const options=[...el.options].map(option=>{const r=option.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,height:r.height,fontSize:parseFloat(getComputedStyle(option).fontSize)};});
    return {appearance:picker.appearance,background:picker.backgroundColor,borderRadius:picker.borderRadius,bottomInset:parseFloat(picker.paddingBottom)+parseFloat(picker.borderBottomWidth),fieldFont:parseFloat(getComputedStyle(el).fontSize),trigger:{left:trigger.left,right:trigger.right,bottom:trigger.bottom},options,width:innerWidth,height:innerHeight};
  });
  assert.equal(layout.appearance,'base-select','The options list must be styled too, rather than using the OS dialog');
  assert.notEqual(layout.background,'rgba(0, 0, 0, 0)');
  assert(parseFloat(layout.borderRadius)>=8);
  for(const option of layout.options) {
    assert(option.height>=44,'Options need comfortable touch targets');
    if(layout.width<=767) assert(option.fontSize>=18,'Phone category choices need larger text while retaining comfortable rows');
    assert(option.left>=0&&option.right<=layout.width,'The open menu must stay inside the viewport');
  }
  const first=layout.options[0],last=layout.options.at(-1);
  if(layout.width<=767) {
    assert(first.top>=layout.trigger.bottom,'Phone menus must open below the field after making room');
    assert.equal(layout.fieldFont,first.fontSize,'Closed category values must be as readable as their open options');
    const dock=page.locator('.sheet-save-panel');
    if(await dock.isVisible()) {
      const bounds=await dock.boundingBox();
      assert(bounds&&last.bottom+layout.bottomInset<=bounds.y-8,'An open category menu needs a clear gap above the save dock');
    }
    if(selector.startsWith('#cost-category')) assert(await select.evaluate(el=>el.closest('.cost-entry-card').querySelector('.cost-record-header').getBoundingClientRect().top>=0),'The active Cost Line header must remain visible while choosing its category');
  }
  const menuHeight=layout.options.reduce((sum,option)=>sum+option.height,0)+24;
  if(layout.height-layout.trigger.bottom>=menuHeight) assert(first.top>=layout.trigger.bottom,'Open below the field when the full menu fits there');
  assert(first.top>=0&&last.bottom<=layout.height,'The options must remain visible above or below the field');
  assert(Math.abs(first.left-layout.trigger.left)<=16,'The menu must stay anchored to its field');
  if(selector==='#expense-category') {
    const actions=page.locator('.expense-entry-card .entry-actions');
    assert.equal(await actions.evaluate(el=>getComputedStyle(el).visibility),'visible','Covered form actions must remain visible so the form never appears cleared');
    assert(await actions.evaluate(el=>parseFloat(getComputedStyle(el).opacity)<=.5),'Covered form actions must be subdued while choosing a category');
  }
  await shot(name,page,{fullPage:false});
}

async function checkMonthMenu(page,shot,name) {
  const trigger=page.locator('.month-picker-trigger');
  await trigger.click();
  const menu=page.locator('.month-options');
  await menu.waitFor();
  const anchor=await trigger.boundingBox(),popup=await menu.boundingBox();
  assert(anchor&&popup&&popup.width>=anchor.width&&Math.abs(anchor.x+anchor.width-popup.x-popup.width)<1,'Month menus must align to the trigger edge while leaving room for their options');
  assert(popup.x>=0&&popup.x+popup.width<=page.viewportSize().width,'Month menus must remain inside the viewport');
  assert(await menu.getByRole('option').evaluateAll(nodes=>nodes.every(el=>el.getBoundingClientRect().height>=44&&parseFloat(getComputedStyle(el).fontSize)>=(innerWidth<=767?18:16))),'Month options need the same readable type and comfortable rows as category options');
  const selected=menu.getByRole('option',{selected:true});
  assert.equal(await selected.locator('svg path[d="m5 12 4 4L19 6"]').count(),1,'The selected month must have a visible selection check');
  assert(await selected.locator('svg path[d="m5 12 4 4L19 6"]').locator('..').evaluate(el=>el.getBoundingClientRect().width>=20&&parseFloat(getComputedStyle(el).strokeWidth)>=2),'Month selection checks need a clear matching stroke');
  await shot(name,page,{fullPage:false});
  await selected.click();
  assert.equal(await menu.count(),0);
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
    assert.equal(await page.locator('.expense-entry-card .entry-actions').evaluate(el=>getComputedStyle(el).visibility),'visible','Form actions must return after selection');
    assert.equal(await page.locator('.expense-entry-card .entry-actions').evaluate(el=>getComputedStyle(el).opacity),'1','Form actions must regain their normal emphasis after selection');
    if(width!==390) await checkMonthMenu(page,shot,`month-menu-light-${width}`);
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
  const highlights=await page.locator('#cost-category-0').evaluate(el=>({selected:getComputedStyle(el.selectedOptions[0]).backgroundColor,focused:getComputedStyle(el.options[el.options.length-1]).backgroundColor}));
  assert.notEqual(highlights.selected,highlights.focused,'Keyboard focus and the stored selection must remain visually distinct');
  const last=await page.locator('#cost-category-0 option').last().boundingBox();
  assert(last&&last.y>=0&&last.y+last.height<=560,'A short phone viewport must let the final option scroll into view');
  for(const control of await page.locator('.sheet-save-panel,.workspace-sidebar').all()) {
    assert.equal(await control.evaluate(el=>getComputedStyle(el).visibility),'visible','Underlying controls must remain visible during category selection');
    assert(await control.evaluate(el=>parseFloat(getComputedStyle(el).opacity)<=.25&&getComputedStyle(el).pointerEvents==='none'),'Short-height selection must subdue competing bottom controls');
  }
  await shot('cost-menu-short-phone',page,{fullPage:false});
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#cost-category-0').inputValue(),'other','Keyboard selection must still update the Cost Line');
  for(const control of await page.locator('.sheet-save-panel,.workspace-sidebar').all()) {
    assert.equal(await control.evaluate(el=>getComputedStyle(el).opacity),'1','Bottom controls must return as soon as category selection finishes');
  }
  await page.getByRole('button',{name:'保存账单',exact:true}).click();
  await page.locator('[id^="other-note-error-"]').waitFor();
  await page.locator('#cost-category-0').click();
  await page.keyboard.press('Escape');
  assert(await page.locator('.sheet-save-panel').isVisible()&&await page.locator('.mobile-navigation').isVisible(),'Dismissing a short-height menu must also restore the bottom controls');
  await page.setViewportSize({width:320,height:360});
  const shortSelect=page.locator('#cost-category-0');
  await shortSelect.focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('Home');
  const firstBefore=await shortSelect.locator('option').first().boundingBox();
  await page.keyboard.press('End');
  const firstAfter=await shortSelect.locator('option').first().boundingBox();
  const lastAfter=await shortSelect.locator('option').last().boundingBox();
  assert(firstBefore&&firstAfter&&firstAfter.y<firstBefore.y,'The fixed six-option menu must scroll internally in a very short viewport');
  assert(lastAfter&&lastAfter.y>=0&&lastAfter.y+lastAfter.height<=360,'The final option must be fully visible after scrolling');
  assert(await shortSelect.evaluate(el=>getComputedStyle(el,'::picker(select)').scrollbarWidth!=='none'),'Scrolling menus must retain their browser scrollbar cue');
  await shot('cost-menu-scrolled-phone',page,{fullPage:false});
  await page.keyboard.press('Enter');
  assert.equal(await shortSelect.inputValue(),'other');
  await page.goto('/settings');
  await page.getByRole('radio',{name:/深色模式/}).check();
  await openExpenseForm(page);
  for(const width of [1280,390,320]) {
    await page.setViewportSize({width,height:844});
    await openPicker(page,'#expense-category',shot,`expense-menu-dark-${width}`);
    assert(await page.locator('#expense-category').evaluate(el=>getComputedStyle(el,'::picker(select)').backgroundColor!==getComputedStyle(document.querySelector('.expense-entry-card')).backgroundColor),'Dark menus must stand apart from their card surface');
    await page.keyboard.press('Escape');
    if(width===320) await checkMonthMenu(page,shot,'month-menu-dark-phone');
  }
  await page.locator('#expense-category').click();
  await page.mouse.click(8,8);
  assert(!await page.locator('#expense-category').evaluate(el=>el.matches(':open')),'Tapping outside must dismiss the category menu');
  await chooseLanguage(page,'en');
  await openExpenseForm(page);
  await openPicker(page,'#expense-category',shot,'expense-menu-english-phone');
  await page.keyboard.press('Escape');
  const category=page.locator('#expense-category');
  await category.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.querySelector('#expense-category')?.matches(':open'));
  await page.keyboard.press('Escape');
  if(await page.evaluate(()=>navigator.maxTouchPoints>0)) {
    await category.tap();
    await page.waitForFunction(()=>document.querySelector('#expense-category')?.matches(':open'));
    await shot('touch-menu-open',page,{fullPage:false});
    await category.locator('option[value="other"]').tap();
    assert.equal(await category.inputValue(),'other');
    assert(!await category.evaluate(el=>el.matches(':open')),'Touch selection must close the menu without reopening it');
  }
  await category.evaluate(el=>Object.defineProperty(el,'showPicker',{value:undefined,configurable:true}));
  await category.click();
  await page.waitForFunction(()=>document.querySelector('#expense-category')?.matches(':open'));
  await page.keyboard.press('Escape');
  await category.evaluate(el=>delete el.showPicker);
}
