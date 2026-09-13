import { test, expect } from '@playwright/test';
for (const width of [390, 768, 1440])
  test(`Ice Clash practice runs and fits ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/practice/hockey?difficulty=hard');
    await page.getByRole('button', { name: 'Let’s play' }).click();
    await expect(page.locator('.hockey-overlay')).toHaveCount(0);
    await page.waitForTimeout(1600);
    const before = await page
      .getByLabel('Ice hockey rink')
      .evaluate((canvas) => canvas.toDataURL());
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(600);
    await page.keyboard.up('ArrowRight');
    await page.keyboard.press('Space');
    const after = await page.getByLabel('Ice hockey rink').evaluate((canvas) => canvas.toDataURL());
    expect(after).not.toBe(before);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Resume game' })).toBeVisible();
    await page.getByRole('button', { name: 'Resume game' }).click();
    await page.getByRole('button', { name: 'Restart', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Let’s play' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(errors).toEqual([]);
  });
for (const difficulty of ['easy', 'hard', 'extra-hard'])
  test(`Ice Clash ${difficulty} starts`, async ({ page }) => {
    await page.goto(`/practice/hockey?difficulty=${difficulty}`);
    await page.getByRole('button', { name: 'Let’s play' }).click();
    await expect(page.getByLabel('Ice hockey rink')).toBeVisible();
    await expect(page.locator(`input[value="${difficulty}"]`)).toBeChecked();
  });

test('Ice Clash touch controls and rink fit portrait and landscape fullscreen', async ({
  browser,
}) => {
  const context = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 844, height: 390 },
  });
  const page = await context.newPage();
  await page.goto('/practice/hockey');
  await page.getByRole('button', { name: 'Let’s play' }).click();
  await page.getByRole('button', { name: 'Fullscreen', exact: true }).click();
  await expect(page.locator('.hockey-game')).toHaveJSProperty('offsetHeight', 390);
  const bounds = await page.getByLabel('Ice hockey rink').boundingBox();
  expect(bounds.height).toBeGreaterThan(150);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(391);
  await expect(page.getByRole('button', { name: 'SHOOT' })).toBeInViewport();
  const stick = page.getByLabel('Movement joystick');
  await stick.dispatchEvent('pointerdown', {
    pointerId: 1,
    pointerType: 'touch',
    clientX: 55,
    clientY: 280,
  });
  await stick.dispatchEvent('pointermove', {
    pointerId: 1,
    pointerType: 'touch',
    clientX: 95,
    clientY: 280,
  });
  await page
    .getByRole('button', { name: 'SHOOT' })
    .dispatchEvent('pointerdown', { pointerId: 2, pointerType: 'touch' });
  await stick.dispatchEvent('pointerup', { pointerId: 1, pointerType: 'touch' });
  await page.screenshot({ path: 'artifacts/ice-clash-landscape-fullscreen.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'SHOOT' })).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.fullscreenElement.scrollHeight <= innerHeight)).toBe(
    true,
  );
  await context.close();
});
