import { defineConfig, devices } from '@playwright/test';

const clientPort = 15_173;
const serverPort = 18_787;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? 'line'
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${clientPort}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      name: 'WebSocket-Server',
      command: 'node --import tsx server/src/index.ts',
      port: serverPort,
      env: { CATAN_SERVER_PORT: String(serverPort), CATAN_SERVER_HOST: '127.0.0.1' },
      reuseExistingServer: false,
      timeout: 30_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    },
    {
      name: 'Vite-Client',
      command: `npm -w @catan/client run dev -- --host 127.0.0.1 --port ${clientPort} --strictPort`,
      url: `http://127.0.0.1:${clientPort}`,
      env: { CATAN_SERVER_PORT: String(serverPort) },
      reuseExistingServer: false,
      timeout: 30_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    },
  ],
});
