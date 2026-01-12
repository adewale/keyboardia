import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E Test Configuration
 *
 * Features:
 * - Cross-browser testing (Chromium, WebKit)
 * - Mobile viewport testing (iPhone, Pixel)
 * - Tracing and screenshots on failure
 * - Auto-starting dev server
 *
 * Note: Firefox was removed due to persistent drag-and-drop failures
 * that don't occur in real Firefox browsers. The failures appear to be
 * Playwright-specific issues with Firefox's drag event handling.
 *
 * @see specs/research/PLAYWRIGHT-TESTING.md
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30000,

  // Retry flaky tests in CI (multiplayer/timing tests can be sensitive)
  retries: process.env.CI ? 2 : 0,

  // Parallel execution
  // - CI: 4 workers for reasonable parallelism
  // - Local: 2 workers by default to avoid 429 rate limiting
  // - Serial mode: Use E2E_SERIAL=1 or npm run test:e2e:serial for single worker
  fullyParallel: !process.env.E2E_SERIAL,
  workers: process.env.CI ? 4 : (process.env.E2E_SERIAL ? 1 : 2),

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
  // Strategy: Run Chromium first as smoke test, other browsers depend on it passing
  // This gives fast feedback (~3-5 min) while still ensuring cross-browser compatibility
  projects: [
    // Primary: Chromium runs first (smoke test)
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },

    // Secondary: Only run if Chromium passes
    // Note: Firefox removed - see comment at top of file
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      dependencies: ['chromium'],
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 7'] },
      dependencies: ['chromium'],
    },
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 14'] },
      // Can run independently for local testing; CI still runs chromium first via workflow order
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
