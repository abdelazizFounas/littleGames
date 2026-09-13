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

test('Fleet placement illuminates every cell, including alternating tiles and invalid positions', async ({
  page,
}) => {
  await page.goto('/practice/battleship');
  await page.getByRole('button', { name: 'Let’s play' }).click();
  await page.getByRole('button', { name: 'Select carrier, 5 cells' }).click();
  async function uniform(selector, count, color) {
    const cells = page.locator(selector);
    await expect(cells).toHaveCount(count);
    expect(
      await cells.evaluateAll((items) => [
        ...new Set(items.map((item) => getComputedStyle(item).backgroundColor)),
      ]),
    ).toEqual([color]);
  }
  await page.getByRole('button', { name: 'Position A1, unexplored', exact: true }).hover();
  await uniform('.fleet-cell--preview', 5, 'rgba(140, 221, 168, 0.3)');
  await page.getByRole('button', { name: 'Rotate', exact: false }).click();
  await page.getByRole('button', { name: 'Position A3, unexplored', exact: true }).hover();
  await uniform('.fleet-cell--preview', 5, 'rgba(140, 221, 168, 0.3)');
  await page.getByRole('button', { name: 'Position I3, unexplored', exact: true }).hover();
  await uniform('.fleet-cell--invalid', 2, 'rgba(237, 129, 102, 0.376)');
  await page.getByRole('button', { name: 'Position A3, unexplored', exact: true }).click();
  await expect(page.locator('.fleet-cell--occupied')).toHaveCount(5);
  await page.getByRole('button', { name: 'Position A3, carrier', exact: true }).hover();
  await uniform('.fleet-cell--invalid', 4, 'rgba(237, 129, 102, 0.376)');
});

test('Fleet pauses an in-flight torpedo and reduced motion skips travel', async ({ page }) => {
  await page.goto('/practice/battleship');
  await page.getByRole('button', { name: 'Let’s play' }).click();
  await page.getByRole('button', { name: 'Auto arrange' }).click();
  await page.getByRole('button', { name: 'Deploy fleet' }).click();
  await page.getByRole('button', { name: 'Target A1, unexplored', exact: true }).click();
  await page.getByRole('button', { name: 'Fire torpedo' }).click();
  await expect(page.locator('.fleet-effects--flight')).toBeVisible();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resume game' })).toBeVisible();
  await expect
    .poll(() => page.locator('.fleet-effects__ocean').evaluate((svg) => svg.animationsPaused()))
    .toBe(true);
  await page.getByRole('button', { name: 'Resume game' }).click();
  await expect(page.getByRole('button', { name: /Target A1, (miss|hit|sunk)/ })).toBeVisible();
  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Let’s play' }).click();
  await page.getByRole('button', { name: 'Auto arrange' }).click();
  await page.getByRole('button', { name: 'Deploy fleet' }).click();
  await page.getByRole('button', { name: 'Target A1, unexplored', exact: true }).click();
  await page.getByRole('button', { name: 'Fire torpedo' }).click();
  await expect(page.getByRole('button', { name: /Target A1, (miss|hit|sunk)/ })).toBeVisible();
  await expect(page.locator('.fleet-effects__ocean')).toHaveCount(0);
});
