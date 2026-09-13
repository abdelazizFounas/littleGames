import { test, expect } from '@playwright/test';

for (const game of ['arena', 'pong', 'battleship']) {
  for (const difficulty of ['easy', 'hard', 'extra-hard']) {
    test(`${game} starts at ${difficulty}`, async ({ page }) => {
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`/practice/${game}?difficulty=${difficulty}`);
      await expect(page.locator(`input[value="${difficulty}"]`)).toBeChecked();
      await page.getByRole('button', { name: 'Let’s play' }).click();
      await expect(page.locator('.practice-overlay')).toHaveCount(0);
      if (game === 'battleship') {
        await page.getByRole('button', { name: 'Auto arrange' }).click();
        await page.getByRole('button', { name: 'Deploy fleet' }).click();
        await expect(page.getByRole('heading', { name: 'Your move, commander.' })).toBeVisible();
        await page.getByRole('button', { name: 'Target A1, unexplored', exact: true }).click();
        await page.getByRole('button', { name: 'Fire torpedo' }).click();
        await expect(
          page.getByRole('button', { name: /Target A1, (miss|hit|sunk)/ }),
        ).toBeVisible();
      } else await expect(page.locator('canvas')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: 'Resume game' })).toBeVisible();
      expect(errors).toEqual([]);
    });
  }
}

test('Fleet supports manual placement, keyboard aiming, restart, and difficulty reset', async ({
  page,
}) => {
  await page.goto('/practice/battleship');
  await page.getByRole('button', { name: 'Let’s play' }).click();
  await page.getByRole('button', { name: 'Select carrier, 5 cells' }).click();
  await page.getByRole('button', { name: 'Position A1, unexplored', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Position A1, carrier', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Auto arrange' }).click();
  await page.getByRole('button', { name: 'Deploy fleet' }).click();
  const target = page.getByRole('button', { name: 'Target A1, unexplored', exact: true });
  await target.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Fire torpedo' })).toBeEnabled();
  await page.getByRole('button', { name: 'Fire torpedo' }).click();
  await expect(page.getByRole('button', { name: /Target A2, (miss|hit|sunk)/ })).toBeVisible();
  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Let’s play' })).toBeVisible();
  await page.locator('input[value="extra-hard"]').check();
  await expect(page).toHaveURL(/difficulty=extra-hard/);
  await page.getByRole('button', { name: 'Let’s play' }).click();
  await expect(page.getByRole('button', { name: 'Deploy fleet' })).toBeDisabled();
});

for (const width of [390, 768, 1440]) {
  test(`Fleet layout fits ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/practice/battleship');
    await page.getByRole('button', { name: 'Let’s play' }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByRole('button', { name: 'Auto arrange' }).click();
    await page.getByRole('button', { name: 'Deploy fleet' }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}

test('Fleet pause controls remain usable in fullscreen', async ({ page }) => {
  await page.goto('/practice/battleship');
  await page.getByRole('button', { name: 'Let’s play' }).click();
  await page.getByRole('button', { name: 'Fullscreen', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => document.fullscreenElement?.className))
    .toBe('fleet-command');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resume game' })).toBeVisible();
  await page.getByRole('button', { name: 'Resume game' }).click();
  await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
});
