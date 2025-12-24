import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  // Retry flaky tests in CI (multiplayer/timing tests can be sensitive)
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: 'http://localhost:5175',
    headless: true,
  },
  webServer: {
    command: 'npm run dev -- --port 5175',
    port: 5175,
    reuseExistingServer: true,
    timeout: 60000,
  },
});
