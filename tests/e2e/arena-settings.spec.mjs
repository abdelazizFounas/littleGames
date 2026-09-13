import { test, expect } from '@playwright/test';

test('Arena practice settings open with P, apply, persist, and remain inside fullscreen', async ({page})=>{
  await page.goto('/practice/arena');
  await page.getByRole('button',{name:'Let’s play'}).click();
  await page.keyboard.press('KeyP');
  const panel=page.getByRole('dialog',{name:'Arena settings'});
  await expect(panel).toBeVisible();
  await panel.getByLabel('Field of view').fill('1.1');
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('littlegames.arena.settings')).look.fieldOfView)).toBe(1.1);
  await panel.getByRole('button',{name:'Back to the game'}).click();
  await expect(panel).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Fullscreen',exact:false}).last().click();
  if (!await panel.isVisible()) await page.getByRole('button',{name:'Settings',exact:false}).click();
  await expect(panel).toBeVisible();
  expect(await panel.evaluate(element=>document.fullscreenElement?.contains(element))).toBe(true);
  await expect(panel.getByLabel('Field of view')).toHaveValue('1.1');
  await page.evaluate(()=>document.exitFullscreen());
  await page.reload();
  await page.getByRole('button',{name:'Settings',exact:false}).click();
  await expect(panel.getByLabel('Field of view')).toHaveValue('1.1');
});

test('Mobile Arena practice offers joystick and touchpad, keeps settings scrollable and saved',async({browser})=>{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const page=await context.newPage();
  await page.goto('http://127.0.0.1:5175/practice/arena');
  await page.getByRole('button',{name:'Let’s play'}).click();
  await page.getByRole('button',{name:'Settings',exact:false}).click();
  const panel=page.getByRole('dialog',{name:'Arena settings'});
  await expect(panel).toBeVisible();
  await panel.getByLabel('View control').selectOption('touchpad');
  await panel.getByRole('checkbox',{name:'Swap the halves'}).check();
  await panel.getByRole('button',{name:'Back to the game'}).click();
  await expect(page.locator('.arena-touch')).toHaveAttribute('data-look-mode','touchpad');
  await expect(page.locator('.arena-touch')).toHaveClass(/arena-touch--swapped/);
  await page.reload();
  await page.getByRole('button',{name:'Settings',exact:false}).click();
  await expect(panel.getByLabel('View control')).toHaveValue('touchpad');
  await panel.getByLabel('View control').selectOption('joystick');
  await panel.getByRole('button',{name:'Back to the game'}).click();
  await expect(page.locator('.arena-touch')).toHaveAttribute('data-look-mode','joystick');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await context.close();
});

test('Touchpad stops when the finger stops; joystick keeps turning; settings release held input',async({page})=>{
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    const {createArenaInput}=await import('/src/features/game/arena-input-sources.ts');
    const {DEFAULT_ARENA_SETTINGS}=await import('/src/features/game/arena-settings.ts');
    const original=window.matchMedia.bind(window);
    window.matchMedia=(query)=>query==='(pointer: coarse)'?{...original(query),matches:true}:original(query);
    const container=document.createElement('div');container.style.cssText='position:fixed;width:800px;height:500px;top:0;left:0';const canvas=document.createElement('canvas');container.append(canvas);document.body.append(container);
    const input=createArenaInput(canvas,container,{onLockChange(){},onLockRefused(){},onOpenSettings(){}},{...DEFAULT_ARENA_SETTINGS,touch:{...DEFAULT_ARENA_SETTINGS.touch,lookMode:'touchpad'}});input.start();
    const turn=container.querySelector('.arena-touch__zone--turn');
    const send=(type,x)=>turn.dispatchEvent(new PointerEvent(type,{pointerId:1,pointerType:'touch',clientX:x,clientY:250,bubbles:true}));
    send('pointerdown',500);send('pointermove',600);const afterSwipe=input.forward();input.advance(.5);const afterHold=input.forward();send('pointerup',600);
    input.setSettings(DEFAULT_ARENA_SETTINGS);send('pointerdown',500);send('pointermove',600);input.advance(.2);const joystickA=input.forward();input.advance(.2);const joystickB=input.forward();
    input.setEnabled(false);input.advance(.5);const disabled=input.forward();input.stop();container.remove();window.matchMedia=original;
    return {afterSwipe,afterHold,joystickA,joystickB,disabled};
  });
  expect(result.afterSwipe).toEqual(result.afterHold);expect(result.joystickA).not.toEqual(result.joystickB);expect(result.disabled).toEqual(result.joystickB);
});
