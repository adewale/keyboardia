import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E Test Configuration
 *
 * Features:
 * - Cross-browser testing (Chromium, Firefox, WebKit)
 * - Mobile viewport testing (iPhone, Pixel)
 * - Tracing and screenshots on failure
 * - Auto-starting dev server
 *
 * @see specs/research/PLAYWRIGHT-TESTING.md
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30000,

  // Retry flaky tests in CI (multiplayer/timing tests can be sensitive)
  retries: process.env.CI ? 2 : 0,

  // Parallel execution
  fullyParallel: true,
  workers: process.env.CI ? 4 : undefined,

  // Reporting
  reporter: [
    ['html', { open: 'never' }],
    ['json', { outputFile: 'test-results/results.json' }],
    ...(process.env.CI ? [['github' as const]] : [['list' as const]]),
  ],

  use: {
    baseURL: 'http://localhost:5175',
    headless: true,

    // Tracing for debugging failures
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',

    // Timeouts
    actionTimeout: 10000,
    navigationTimeout: 30000,
  },

  // Cross-browser + mobile projects
  projects: [
    // Desktop browsers
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },

    // Mobile viewports
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 14'] },
    },
  ],

  webServer: {
    command: process.env.USE_MOCK_API
      ? 'USE_MOCK_API=1 npm run dev -- --port 5175'
      : 'npm run dev -- --port 5175',
    port: 5175,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
