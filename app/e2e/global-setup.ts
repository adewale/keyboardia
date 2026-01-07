/**
 * Global E2E Test Setup
 *
 * Configures test environment for CI vs local development.
 * In CI: Uses mocked API responses for reliability
 * Locally: Uses real backend for full integration testing
 *
 * @see specs/research/PLAYWRIGHT-TESTING.md
 */

/* eslint-disable react-hooks/rules-of-hooks */
import { test as base, expect, Page, Locator, devices } from '@playwright/test';
import { mockSessionsAPI, createMockSession, clearMockSessions } from './fixtures/network.fixture';
import { API_BASE, createSessionWithRetry } from './test-utils';
import type { SessionState } from './test-utils';

/**
 * Whether we're running in CI environment
 */
export const isCI = !!process.env.CI;

/**
 * Whether Vite's mock API is active
 * When true, Vite handles all API mocking at the server level
 * and Playwright-level mocking should be disabled to avoid conflicts
 */
export const useMockAPI = process.env.USE_MOCK_API === '1';

/**
 * Whether to use Playwright-level route mocking
 * Only needed when CI is true AND Vite mock is NOT active
 * (When Vite mock is active, it handles all API requests)
 */
export const usePlaywrightMocking = isCI && !useMockAPI;

/**
 * Input type for creating sessions - partial session state
 */
export interface CreateSessionInput {
  tracks?: SessionState['tracks'];
  tempo?: number;
  swing?: number;
  version?: number;
}

/**
 * Test base with conditional mocking
 *
 * In CI: Mocks API calls for reliability
 * Locally: Uses real backend
 */
export const test = base.extend<{
  setupMocking: void;
  createSession: (data: CreateSessionInput) => Promise<{ id: string }>;
  isolatedPage: Page;
}>({
  /**
   * Setup API mocking for CI environment
   * Only activates when Playwright mocking is needed (CI without Vite mock)
   */
  setupMocking: [async ({ page }, use) => {
    if (usePlaywrightMocking) {
      await mockSessionsAPI(page);
    }
    await use();

    // Cleanup
    if (usePlaywrightMocking) {
      clearMockSessions();
    }
  }, { auto: true }],

  /**
   * Create a session - uses mock in CI with Playwright mocking, real API otherwise
   * When USE_MOCK_API=1, Vite handles session creation at server level
   */
  createSession: async ({ request }, use) => {
    await use(async (data: CreateSessionInput) => {
      if (usePlaywrightMocking) {
        // CI without Vite mock: use Playwright mock session
        const id = createMockSession({
          tracks: data.tracks ?? [],
          tempo: data.tempo ?? 120,
          swing: data.swing ?? 0,
          version: data.version ?? 1,
        });
        return { id };
      } else {
        // With Vite mock or real backend: use HTTP API
        return createSessionWithRetry(request, data);
      }
    });
  },

  /**
   * Isolated page fixture with clean state
   */
  isolatedPage: async ({ page }, use) => {
    // Clear storage before test
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await use(page);
    // Clean up after test
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
  },
});

/**
 * Base URL helper
 */
export function getBaseUrl(): string {
  return isCI ? 'http://localhost:5175' : API_BASE;
}

/**
 * Timing tolerance multiplier for CI
 * CI environments have more variable timing, so we increase tolerances
 */
export const TIMING_TOLERANCE = isCI ? 2 : 1;

// ============================================================================
// SMART WAIT UTILITIES
// These replace the anti-pattern of waitForTimeout with proper Playwright waits
// ============================================================================

/**
 * Wait for the app to be ready for interaction.
 * Uses proper Playwright waits instead of fixed timeouts.
 *
 * Handles two app states:
 * 1. Landing page at `/` - clicks "Start" to create session and enter sequencer
 * 2. Sequencer at `/s/{id}` - waits for track rows or sample picker
 *
 * In CI, includes additional error detection and longer timeouts.
 */
export async function waitForAppReady(page: Page): Promise<void> {
  const timeout = isCI ? 30000 : 15000;

  // First, wait for the page to complete initial load
  await page.waitForLoadState('domcontentloaded');

  // Check for any JavaScript errors that might prevent rendering
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  // Check if we're on the landing page
  const landingPage = page.locator('.landing');
  const isLanding = await landingPage.isVisible().catch(() => false);

  if (isLanding) {
    // Click the "Start" button to create a session and enter the sequencer
    const startButton = page.locator('.landing-btn.primary, button:has-text("Start"), button:has-text("Create")').first();
    await startButton.waitFor({ state: 'visible', timeout: 5000 });
    await startButton.click();

    // Wait for URL to change to /s/{sessionId}
    await page.waitForURL(/\/s\/[a-zA-Z0-9_-]+/, { timeout });
  }

  // Wait for either track rows OR sample picker to be visible
  try {
    await page.locator('.track-row, .sample-picker').first().waitFor({
      state: 'visible',
      timeout
    });
  } catch {
    // On timeout, gather diagnostic info
    const html = await page.content();
    const hasRoot = html.includes('id="root"');
    const hasApp = html.includes('class="app"') || html.includes('class="App"');
    const hasError = html.includes('error') || html.includes('Error');
    const currentUrl = page.url();

    // Check what elements ARE visible
    const visibleElements = await page.evaluate(() => {
      const root = document.getElementById('root');
      if (!root) return 'No #root element';
      if (!root.children.length) return '#root is empty';
      return Array.from(root.querySelectorAll('*'))
        .slice(0, 10)
        .map(el => `${el.tagName.toLowerCase()}.${el.className}`)
        .join(', ');
    });

    const diagnostics = [
      `Timeout waiting for app to be ready (${timeout}ms)`,
      `Current URL: ${currentUrl}`,
      `Has #root: ${hasRoot}`,
      `Has app class: ${hasApp}`,
      `Has error text: ${hasError}`,
      `JS errors: ${errors.length ? errors.join('; ') : 'none'}`,
      `Visible elements: ${visibleElements}`,
    ].join('\n');

    throw new Error(diagnostics);
  }

  // Wait for network to settle (with timeout to prevent hanging)
  await page.waitForLoadState('networkidle').catch(() => {
    // networkidle can timeout if there are ongoing WebSocket connections
    // This is acceptable for app readiness
  });
}

/**
 * Wait for an element to be stable (no animations).
 * Useful after UI interactions that trigger animations.
 */
export async function waitForStable(locator: Locator): Promise<void> {
  // Wait for element to be visible and enabled
  await locator.waitFor({ state: 'visible' });
  // Playwright auto-waits for actionability, but we can also check stability
  await expect(locator).toBeVisible();
}

/**
 * Wait for a state change after an action.
 * Replaces arbitrary timeouts with assertion-based waiting.
 */
export async function waitForStateChange(
  page: Page,
  checkFn: () => Promise<boolean>,
  options: { timeout?: number; interval?: number } = {}
): Promise<void> {
  const { timeout = 5000, interval = 100 } = options;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    if (await checkFn()) {
      return;
    }
    await page.waitForTimeout(interval);
  }
  throw new Error(`State change not detected within ${timeout}ms`);
}

/**
 * Wait for animation to complete.
 * Only use this for genuine CSS animations where no other wait is possible.
 * This is the ONLY acceptable use of waitForTimeout.
 */
export async function waitForAnimation(page: Page): Promise<void> {
  // 300ms is the typical CSS transition duration
  // This is acceptable per Playwright docs for animations outside our control
  await page.waitForTimeout(isCI ? 450 : 300);
}

/**
 * Wait for drag operation to complete.
 * Drag operations may need a brief pause for the browser to process.
 */
export async function waitForDragComplete(page: Page): Promise<void> {
  // Small wait for drag event propagation
  await page.waitForTimeout(isCI ? 75 : 50);
}

/**
 * @deprecated Use waitForAppReady, waitForStable, or web-first assertions instead.
 * This function exists only for backwards compatibility during migration.
 */
export async function waitWithTolerance(page: Page, _ms: number): Promise<void> {
  // Log deprecation warning in development
  if (!isCI) {
    console.warn(
      'DEPRECATED: waitWithTolerance() is an anti-pattern. ' +
      'Use waitForAppReady(), waitForStable(), or expect().toBeVisible() instead.'
    );
  }
  // For now, just wait for network idle as a reasonable default
  await page.waitForLoadState('networkidle').catch(() => {
    // Fallback if networkidle times out
  });
}

export { expect, devices };
export type { Page, Locator };
