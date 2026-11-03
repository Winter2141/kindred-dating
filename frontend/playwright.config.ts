import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end tests: the real API (fresh SQLite database, demo data, fast personas) and the
 * real web app, driven in Chromium with a fake camera and microphone for calls.
 *
 * Locally the tests use the installed Microsoft Edge; CI installs Playwright's Chromium.
 */
const API_PORT = 8100
const WEB_PORT = 5190

export default defineConfig({
  testDir: './e2e',
  // The tests share one database and the demo accounts, so they run one at a time.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1280, height: 800 },
    permissions: ['camera', 'microphone'],
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        channel: process.env.CI ? undefined : 'msedge',
        launchOptions: {
          args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
        },
      },
    },
  ],
  webServer: [
    {
      command: `node e2e/start-api.mjs ${API_PORT} ${WEB_PORT}`,
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      timeout: 90_000,
      reuseExistingServer: false,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      env: { KINDRED_API_URL: `http://127.0.0.1:${API_PORT}` },
      timeout: 90_000,
      reuseExistingServer: false,
    },
  ],
})
