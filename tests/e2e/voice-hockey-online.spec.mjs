/* eslint-disable no-await-in-loop -- Joining players and checking departures is sequential. */
import { test, expect, chromium } from '@playwright/test';
const origin = process.env['PLAYWRIGHT_LIVE_ORIGIN'] ?? 'http://127.0.0.1:5175';
test('Ice Clash online exchanges movement and restores the same seat', async ({ browser }) => {
  test.skip(!process.env['NAKAMA_INTEGRATION'], 'Requires isolated Nakama.');
  const one = await browser.newContext(),
    two = await browser.newContext();
  const a = await one.newPage(),
    b = await two.newPage();
  try {
    await openMatch(a, 'hockey');
    await invite(a, b);
    await expect(a.locator('.hockey-overlay')).toHaveCount(0);
    await expect(b.locator('.hockey-overlay')).toHaveCount(0);
    await a.getByLabel('Ice hockey rink').click();
    await a.waitForTimeout(1700);
    const before = await b.getByLabel('Ice hockey rink').evaluate((canvas) => canvas.toDataURL());
    await a.keyboard.down('ArrowRight');
    await a.waitForTimeout(650);
    await a.keyboard.up('ArrowRight');
    const after = await b.getByLabel('Ice hockey rink').evaluate((canvas) => canvas.toDataURL());
    expect(after).not.toBe(before);
    await a.keyboard.down('ArrowDown');
    await a.waitForTimeout(650);
    await a.keyboard.up('ArrowDown');
    await a.keyboard.down('Space');
    await expect(a.getByRole('progressbar', { name: 'Shot power' })).toHaveAttribute(
      'aria-valuenow',
      '100',
    );
    await a.keyboard.up('Space');
    await expect(a.getByRole('progressbar', { name: 'Shot power' })).toHaveAttribute(
      'aria-valuenow',
      '0',
    );
    await a.reload();
    await expect(a.locator('.hockey-overlay')).toHaveCount(0);
    await expect(b.locator('.hockey-overlay')).toHaveCount(0);
  } finally {
    await one.close();
    await two.close();
  }
});
async function openMatch(page, game) {
  await page.goto(`${origin}/games/${game}`);
  await page.getByRole('link', { name: 'Play online' }).click();
  await page.getByRole('button', { name: 'Play as guest' }).click();
  await page.getByRole('button', { name: 'Create lobby' }).click();
  await page.getByRole('button', { name: 'Open the lobby' }).click();
}
async function invite(a, b) {
  await a.getByRole('button', { name: 'Invite a friend' }).click();
  const link = await a.locator('.invite__link').textContent();
  await b.goto(link);
  await b.getByRole('button', { name: 'Join as guest' }).click();
}
test('Match voice establishes real P2P audio, mutes tracks and individual peers, and tears down', async () => {
  test.skip(!process.env['NAKAMA_INTEGRATION'], 'Requires Nakama and PeerServer.');
  const browser = await chromium.launch({
    executablePath: process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE'],
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  const one = await browser.newContext(),
    two = await browser.newContext();
  for (const context of [one, two])
    await context.addInitScript(() => {
      window.voiceTestTracks = [];
      window.voiceTestAudios = [];
      window.voiceTestConnections = [];
      const get = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        const stream = await get(constraints);
        window.voiceTestTracks.push(...stream.getAudioTracks());
        return stream;
      };
      const AudioConstructor = window.Audio;
      window.Audio = function (...args) {
        const element = new AudioConstructor(...args);
        window.voiceTestAudios.push(element);
        return element;
      };
      const Connection = window.RTCPeerConnection;
      window.RTCPeerConnection = class extends Connection {
        constructor(...args) {
          super(...args);
          window.voiceTestConnections.push(this);
        }
      };
    });
  const a = await one.newPage(),
    b = await two.newPage();
  try {
    await openMatch(a, 'battleship');
    await invite(a, b);
    await a.getByRole('button', { name: 'Join voice' }).click();
    await expect(a.getByRole('button', { name: 'Mute microphone' })).toBeEnabled();
    await b.getByRole('button', { name: 'Join voice' }).click();
    await expect(a.locator('.voice-room__members li')).toHaveCount(1, { timeout: 30000 });
    await expect(b.locator('.voice-room__members li')).toHaveCount(1, { timeout: 30000 });
    expect(
      await a.evaluate(() =>
        window.voiceTestConnections
          .filter((connection) => connection.getSenders().length > 0)
          .flatMap((connection) =>
            connection.getConfiguration().iceServers.flatMap((server) => server.urls),
          ),
      ),
    ).toEqual(['stun:stun.l.google.com:19302']);
    await expect
      .poll(async () =>
        a.evaluate(async () => {
          // PeerJS also creates and closes a feature-detection connection.
          const reports = await Promise.all(
            window.voiceTestConnections.map(async (connection) =>
              Array.from((await connection.getStats()).values()),
            ),
          );
          return reports
            .flat()
            .some(
              (report) =>
                report.type === 'inbound-rtp' &&
                report.kind === 'audio' &&
                report.bytesReceived > 0,
            );
        }),
      )
      .toBe(true);
    await a.getByRole('button', { name: 'Mute microphone', exact: true }).click();
    expect(await a.evaluate(() => window.voiceTestTracks.every((track) => !track.enabled))).toBe(
      true,
    );
    await a.getByRole('button', { name: 'Unmute microphone', exact: true }).click();
    expect(await a.evaluate(() => window.voiceTestTracks.every((track) => track.enabled))).toBe(
      true,
    );
    await a.locator('.voice-room__members button').first().click();
    expect(await a.evaluate(() => window.voiceTestAudios.at(-1).muted)).toBe(true);
    await a.locator('.voice-room__members button').first().click();
    expect(await a.evaluate(() => window.voiceTestAudios.at(-1).muted)).toBe(false);
    await a.getByRole('button', { name: 'Leave voice' }).click();
    expect(
      await a.evaluate(() => window.voiceTestTracks.every((track) => track.readyState === 'ended')),
    ).toBe(true);
    expect(
      await a.evaluate(() =>
        window.voiceTestConnections.every((connection) => connection.connectionState === 'closed'),
      ),
    ).toBe(true);
    await expect(b.locator('.voice-room__members li')).toHaveCount(0, { timeout: 15000 });
    await a.getByRole('button', { name: 'Join voice' }).click();
    await expect(b.locator('.voice-room__members li')).toHaveCount(1, { timeout: 30000 });
    await a.goto(`${origin}/`);
    await expect(b.locator('.voice-room__members li')).toHaveCount(0, { timeout: 15000 });
    await b.getByRole('button', { name: 'Leave voice' }).click();
  } finally {
    await browser.close();
  }
});
