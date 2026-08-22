import { defineConfig, devices } from '@playwright/test';

function configuredPort(name: string, fallback: number): number {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }
  return value;
}

const comparisonPort = configuredPort('STACK_A_COMPARISON_PORT', 4179);

export default defineConfig({
  testDir: './identity',
  timeout: 60_000,
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR || 'test-results/stack-a-identity',
  forbidOnly: !!process.env.CI,
  retries: 0,
  fullyParallel: false,
  workers: 1,
  reporter: [
    ['json', { outputFile: process.env.PLAYWRIGHT_JSON_OUTPUT_FILE || 'test-results/stack-a-identity-results.json' }],
    ...(process.env.CI ? [['github' as const]] : [['list' as const]]),
  ],
  use: {
    baseURL: `http://127.0.0.1:${comparisonPort}`,
    ...devices['Desktop Chrome'],
    locale: 'en-GB',
    timezoneId: 'Europe/London',
    colorScheme: 'dark',
    deviceScaleFactor: 1,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'stack-a-chromium',
      testMatch: 'stack-a-identity.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'stack-b-chromium',
      testMatch: 'stack-b-visual.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'stack-a-mobile-webkit',
      testMatch: 'stack-a-mobile-behavior.spec.ts',
      use: { ...devices['iPhone 13'], browserName: 'webkit', hasTouch: true },
    },
    {
      name: 'site-color-safety-chromium',
      testMatch: 'site-color-safety.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'node scripts/serve-stack-a-comparison.mjs',
    url: `http://127.0.0.1:${comparisonPort}/__stack-a-ready`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
