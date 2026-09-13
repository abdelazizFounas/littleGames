/* eslint-disable no-await-in-loop -- Both commanders act in authoritative turn order. */
import {test,expect} from '@playwright/test';
test('Pocket Artillery private match shares options, resolves both turns, and restores a tank',async({browser})=>{
 test.skip(!process.env['NAKAMA_INTEGRATION'],'Requires isolated Nakama.');
 const one=await browser.newContext(),two=await browser.newContext();const a=await one.newPage(),b=await two.newPage();const errors=[];
 for(const page of [a,b])page.on('pageerror',error=>errors.push(error.message));
 try{
  await a.goto('http://127.0.0.1:5175/games/artillery');await a.getByRole('link',{name:'Play online'}).click();await a.getByRole('button',{name:'Play as guest'}).click();await a.getByRole('button',{name:'Create lobby'}).click();await a.getByRole('button',{name:'Open the lobby'}).click();
  await a.getByRole('button',{name:/Alpine Echo/}).click();await expect(a.getByRole('button',{name:/Alpine Echo/})).toHaveAttribute('aria-pressed','true');await a.getByLabel('Match length').selectOption('1');await expect(a.getByLabel('Match length')).toHaveValue('1');
  await a.getByRole('button',{name:'Invite a friend'}).click();const link=await a.locator('.invite__link').textContent();await b.goto(link);await b.getByRole('button',{name:'Join as guest'}).click();
  await expect(b.getByRole('button',{name:/Alpine Echo/})).toHaveAttribute('aria-pressed','true');await expect(b.getByLabel('Match length')).toHaveValue('1');await expect(b.getByLabel('Match length')).toBeDisabled();
  await a.getByRole('button',{name:'Ready to fire'}).click();await expect(b.getByText('Your rival is ready.',{exact:false})).toBeVisible();await b.getByRole('button',{name:'Ready to fire'}).click();
  await expect(a.getByRole('slider',{name:'Firing angle'})).toBeEnabled();await expect(b.getByRole('slider',{name:'Firing angle'})).toBeDisabled();
  for(const page of [a,b]){await expect(page.getByRole('button',{name:'Fire shell'})).toBeEnabled({timeout:20000});await page.getByRole('button',{name:'Fire shell'}).click();await expect(a.locator('.artillery-flight-trail')).toBeVisible();await expect(b.locator('.artillery-flight-trail')).toBeVisible();await expect(a.locator('.artillery-flight-trail')).toHaveCount(0);}
  const armor=await a.getByRole('meter',{name:'Your armor'}).getAttribute('aria-valuenow');await a.reload();await expect(a.getByRole('meter',{name:'Your armor'})).toHaveAttribute('aria-valuenow',armor);await expect(a.locator('.artillery-flight-trail')).toHaveCount(0);await expect(a.getByRole('slider',{name:'Firing angle'})).toBeEnabled({timeout:20000});
  expect(errors).toEqual([]);
 }finally{await one.close();await two.close();}
});
for(const mobile of [false,true])test(`Arena online settings work on ${mobile?'mobile':'desktop'}`,async({browser})=>{
 test.skip(!process.env['NAKAMA_INTEGRATION'],'Requires isolated Nakama.');
 const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},hasTouch:mobile,isMobile:mobile});const page=await context.newPage();
 try{
  await page.goto('http://127.0.0.1:5175/games/arena');await page.getByRole('link',{name:'Play online'}).click();await page.getByRole('button',{name:'Play as guest'}).click();await page.getByRole('button',{name:'Create lobby'}).click();await page.getByRole('button',{name:'Open the lobby'}).click();
  await page.locator('.arena-settings-launch').click();const panel=page.getByRole('dialog',{name:'Arena settings'});await expect(panel).toBeVisible();
  await panel.getByLabel('Field of view').fill('1.2');if(mobile)await panel.getByLabel('View control').selectOption('touchpad');await panel.getByRole('button',{name:'Back to the game'}).click();await expect(panel).toHaveCount(0);
  if(mobile){await expect(page.locator('.arena-touch')).toHaveAttribute('data-look-mode','touchpad');expect(await page.evaluate(()=>document.pointerLockElement===null)).toBe(true);}else{await page.keyboard.press('KeyP');await expect(panel).toBeVisible();}
  await page.reload();await page.locator('.arena-settings-launch').click();await expect(panel.getByLabel('Field of view')).toHaveValue('1.2');if(mobile)await expect(panel.getByLabel('View control')).toHaveValue('touchpad');
 }finally{await context.close();}
});
