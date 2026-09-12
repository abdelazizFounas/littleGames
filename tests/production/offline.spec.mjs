import { test, expect } from '@playwright/test';

test('built games run under production CSP and remain available offline', async ({ page, context }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  // Go offline before either game has been visited: all required chunks must
  // come from the PWA precache, including the renderer and CSP compatibility.
  await context.setOffline(true);
  await page.goto('/guide');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  // One browser navigates between games; these steps must run in order.
  /* oxlint-disable no-await-in-loop */
  for (const game of ['arena', 'pong']) {
    await page.goto(`/practice/${game}`);
    await page.getByRole('button', { name: 'Let’s play' }).click();
    await expect(page.locator('canvas')).toBeVisible();
    await expect(page.locator('.practice-overlay')).toHaveCount(0);
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Resume game' })).toBeVisible();
  }
  expect(errors).toEqual([]);
});
