import { defineConfig, devices } from '@playwright/test';

const ignoredSpecs: RegExp[] = [];
if (!process.env.RUN_STAGING_E2E) ignoredSpecs.push(/e2e\/staging\//);
if (process.env.E2E_FUNCTIONAL_ONLY === '1') ignoredSpecs.push(/e2e\/visual\.spec\.ts$/);

// Playwright's headless WebKit process does not provide a stable real-time
// audio-analysis environment. These exhaustive AnalyserNode probes can wedge
// one WebKit worker for minutes and then make unrelated UI contracts time out.
// Chromium remains the audio-capable browser lane; WebKit still runs the UI,
// collaboration, layout and lightweight metering contracts below.
const headlessWebkitAudioProbes = [
  /e2e\/advanced-sub-bass-session\.spec\.ts$/,
  /e2e\/all-instruments-master-output\.spec\.ts$/,
  /e2e\/instrument-range-session\.spec\.ts$/,
];

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
  // Staging specs depend on a live external environment and a specific session,
  // so they are excluded by default. Opt in with `npm run test:e2e:staging`
  // (which sets RUN_STAGING_E2E=1).
  testIgnore: ignoredSpecs,
  timeout: 30000,
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR || 'test-results',
  forbidOnly: !!process.env.CI,

  // Required coverage must pass on its first attempt. Any future advisory
  // command that wants retries must opt in explicitly.
  retries: 0,

  // Parallel execution
  // - CI: 4 workers for reasonable parallelism
  // - Local: 2 workers by default to avoid 429 rate limiting
  // - Serial mode: Use E2E_SERIAL=1 or npm run test:e2e:serial for single worker
  fullyParallel: !process.env.E2E_SERIAL,
  workers: process.env.CI ? 4 : (process.env.E2E_SERIAL ? 1 : 2),

  // Reporting
  reporter: [
    ['html', { open: 'never', outputFolder: process.env.PLAYWRIGHT_HTML_REPORT || 'playwright-report' }],
    ['json', { outputFile: process.env.PLAYWRIGHT_JSON_OUTPUT_FILE || 'test-results/results.json' }],
    ...(process.env.CI ? [['github' as const]] : [['list' as const]]),
  ],

  use: {
    // Support PLAYWRIGHT_BASE_URL for full-stack testing against wrangler dev
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5175',
    headless: true,

    // Tracing for debugging failures
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',

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
      // Recording every headless WebKit context keeps a media pipeline alive
      // while the app creates its own Web Audio graph. That combination can
      // wedge the browser process; traces and failure screenshots still retain
      // deterministic diagnostics for this lane.
      use: { ...devices['Desktop Safari'], video: 'off' },
      dependencies: ['chromium'],
      // A second headless WebKit audio process can starve the first process and
      // create deterministic 30-40 second cascades in otherwise fast tests.
      workers: 1,
      testIgnore: [...ignoredSpecs, ...headlessWebkitAudioProbes],
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 7'] },
      dependencies: ['chromium'],
    },
    {
      name: 'mobile-safari',
      // Serialize the focused mobile WebKit contract. Multiple native audio
      // contexts in one headless WebKit process can starve one another, and
      // video capture keeps an additional media pipeline alive.
      workers: 1,
      use: { ...devices['iPhone 14'], video: 'off' },
      // Can run independently for local testing; CI still runs chromium first via workflow order
    },
    {
      name: 'mobile-safari-large',
      use: { ...devices['iPhone 15 Pro Max'] },
      dependencies: ['chromium'],
    },
  ],

  // Only start webServer when not using external server (PLAYWRIGHT_BASE_URL)
  // Full-stack testing via test:e2e:full-stack manages wrangler dev externally
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: process.env.USE_MOCK_API
          ? 'USE_MOCK_API=1 npm run dev -- --port 5175'
          : 'npm run dev -- --port 5175',
        port: 5175,
        // Mock-API tests must not reuse an existing non-mock Vite server;
        // doing so routes /api to the real backend proxy and hides regressions
        // as 405s or stale session data.
        reuseExistingServer: !process.env.CI && process.env.USE_MOCK_API !== '1',
        timeout: 120000,
      },
});
