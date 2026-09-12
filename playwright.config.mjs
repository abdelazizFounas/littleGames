import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:5175',
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      ...(process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE'] ? { executablePath: process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE'] } : {}),
      args: ['--enable-unsafe-swiftshader'],
    },
  },
  webServer: {
    command: 'pnpm --filter @littlegames/ui exec vite --host 127.0.0.1 --port 5175 --strictPort',
    url: 'http://127.0.0.1:5175',
    reuseExistingServer: !process.env['CI'],
    env: { NAKAMA_SOCKET_SERVER_KEY: process.env['NAKAMA_SOCKET_SERVER_KEY'] ?? 'e2e-public-key', VITE_NAKAMA_HOST: '127.0.0.1', VITE_NAKAMA_PORT: process.env['NAKAMA_PORT'] ?? '7350', VITE_NAKAMA_USE_SSL: 'false' },
  },
});
