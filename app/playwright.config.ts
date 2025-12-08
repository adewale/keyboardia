import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
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
