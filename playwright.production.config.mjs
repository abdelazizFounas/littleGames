import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/production',
  timeout: 90000,
  expect: { timeout: 30000 },
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4176',
    trace: 'retain-on-failure',
    launchOptions: {
      ...(process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE'] ? { executablePath: process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE'] } : {}),
      args: ['--enable-unsafe-swiftshader'],
    },
  },
  webServer: {
    command: 'pnpm build && node tests/production/server.mjs',
    url: 'http://127.0.0.1:4176',
    timeout: 120000,
    reuseExistingServer: false,
  },
});
