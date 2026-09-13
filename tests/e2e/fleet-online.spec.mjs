import { test, expect } from '@playwright/test';

test('Fleet private match queues deployment, exchanges shots, and survives reload', async ({
  browser,
}) => {
  test.skip(!process.env['NAKAMA_INTEGRATION'], 'Requires an isolated Nakama server.');
  const one = await browser.newContext(),
    two = await browser.newContext();
  const a = await one.newPage(),
    b = await two.newPage();
  const errors = [];
  for (const page of [a, b]) {
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('dialog', (dialog) => dialog.accept());
  }
  try {
    await a.goto('http://127.0.0.1:5175/games/battleship');
    await a.getByRole('link', { name: 'Play online' }).click();
    await a.getByRole('button', { name: 'Play as guest' }).click();
    await a.getByRole('button', { name: 'Create lobby' }).click();
    await a.getByLabel('Password — leave empty').fill('fleet-integration');
    await a.getByRole('button', { name: 'Open the lobby' }).click();
    await a.getByRole('button', { name: 'Invite a friend' }).click();
    await a.locator('.invite__link').waitFor();
    const invitation = await a.locator('.invite__link').textContent();
    await a.getByRole('button', { name: 'Auto arrange' }).click();
    await a.getByRole('button', { name: 'Deploy fleet' }).click();
    await expect(a.getByRole('heading', { name: 'Fleet deployed. Standing by.' })).toBeVisible();
    await b.goto(invitation);
    await b.getByRole('button', { name: 'Join as guest' }).click();
    await expect(b).toHaveURL(/games\/battleship\?match=/);
    await b.getByRole('button', { name: 'Auto arrange' }).click();
    await b.getByRole('button', { name: 'Deploy fleet' }).click();
    await expect(a.getByRole('heading', { name: 'Your move, commander.' })).toBeVisible();
    await a.getByRole('button', { name: 'Target A1, unexplored', exact: true }).click();
    await a.getByRole('button', { name: 'Fire torpedo' }).click();
    await expect(a.getByRole('button', { name: /Target A1, (miss|hit|sunk)/ })).toBeVisible();
    await expect(b.getByRole('button', { name: /Position A1, (miss|hit|sunk)/ })).toBeVisible();
    await a.reload();
    await expect(a.getByRole('button', { name: /Target A1, (miss|hit|sunk)/ })).toBeVisible();
    await expect(a.locator('.fleet-grid--enemy .fleet-vessel')).toHaveCount(0);
    await expect(a.locator('.fleet-grid--own .fleet-vessel')).toHaveCount(5);
    expect(errors).toEqual([]);
  } finally {
    await one.close();
    await two.close();
  }
});
