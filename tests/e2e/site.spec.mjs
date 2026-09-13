import { test, expect } from '@playwright/test';

for (const width of [390, 768, 1440]) {
  test(`public catalog works at ${width}px`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('A little break.');
    await expect(page.locator('.cover-card')).toHaveCount(4);
    await page.getByRole('button', { name: 'Strategy', exact: true }).click();
    await expect(page.locator('.cover-card')).toHaveCount(2);
    await expect(page.locator('.cover-card h3')).toHaveText(['Fleet Command', 'Pocket Artillery']);
    await page.getByRole('button', { name: 'All games', exact: true }).click();
    await page.getByRole('searchbox').fill('pong');
    await expect(page.locator('.cover-card h3')).toHaveText('Neon Pong');
    await page.getByRole('searchbox').fill('no-such-game');
    await expect(page.getByRole('heading', { name: 'No games match your search.' })).toBeVisible();
    await page.getByRole('button', { name: 'Show all games' }).click();
    await expect(page.locator('.cover-card')).toHaveCount(4);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('game pages preserve the destination through sign-in', async ({ page }) => {
  await page.goto('/games/arena');
  await expect(page.getByRole('heading', { name: 'Rift Arena', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Play online' }).click();
  await expect(page).toHaveURL(/login\?next=%2Fgames%2Farena/);
  await expect(page.getByRole('button', { name: 'Play as guest' })).toBeVisible();
});

test('guide, data page, and missing routes remain navigable', async ({ page }) => {
  await page.goto('/guide');
  await page.locator('summary').filter({ hasText: 'Do I need an account?' }).click();
  await expect(page.getByText('Practice works without an account', { exact: false })).toBeVisible();
  await page.getByRole('link', { name: 'Your data', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'What the game remembers.' })).toBeVisible();
  await page.goto('/not-a-page');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: /back/i }).first()).toBeVisible();
});

for (const game of ['arena', 'pong']) {
  test(`${game} practice loads, plays, pauses, and restarts`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`/practice/${game}`);
    const play = page.getByRole('button', { name: 'Let’s play' });
    await expect(play).toBeVisible({ timeout: 45000 });
    await play.click();
    await expect(page.locator('.practice-overlay')).toHaveCount(0);
    await expect(page.locator('canvas')).toBeVisible();
    if (game === 'arena') {
      await expect.poll(() => page.evaluate(() => !!document.pointerLockElement)).toBe(true);
      await page.keyboard.down('KeyD');
      await page.waitForTimeout(150);
      await page.keyboard.up('KeyD');
      await page.mouse.down({ button: 'right' });
      await page.waitForTimeout(250);
      await page.mouse.click(720, 580);
      await page.mouse.up({ button: 'right' });
    }
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Resume game' })).toBeVisible();
    await page.getByRole('button', { name: 'Restart', exact: true }).click();
    await expect(play).toBeVisible();
    await page.getByRole('link', { name: /Try .* practice/ }).first().click();
    await expect(page.locator('canvas')).toHaveCount(1);
    expect(errors).toEqual([]);
  });
}

test('touch Arena supports two sticks without a foreign release cancelling movement', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:5175/practice/arena');
  await page.getByRole('button', { name: 'Let’s play' }).click();
  await expect(page.locator('.arena-touch')).toBeVisible();
  await page.locator('.arena-touch__zone--move').dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 250 });
  await page.locator('.arena-touch__zone--move').dispatchEvent('pointermove', { pointerId: 1, pointerType: 'touch', clientX: 140, clientY: 250 });
  await page.locator('.arena-touch__zone--turn').dispatchEvent('pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 700, clientY: 250 });
  await page.locator('.arena-touch__zone--move').dispatchEvent('pointerup', { pointerId: 2, pointerType: 'touch' });
  await expect(page.locator('.arena-touch__mark').first()).toHaveCSS('opacity', '1');
  await page.locator('.arena-touch__zone--move').dispatchEvent('pointerup', { pointerId: 1, pointerType: 'touch' });
  await expect(page.locator('.arena-touch__mark').first()).toHaveCSS('opacity', '0');
  await context.close();
});
