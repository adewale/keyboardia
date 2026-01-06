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
import { test as base, expect, Page, Locator } from '@playwright/test';
import { mockSessionsAPI, createMockSession, clearMockSessions } from './fixtures/network.fixture';
import { API_BASE, createSessionWithRetry } from './test-utils';
import type { SessionState } from './test-utils';

/**
 * Whether we're running in CI environment
 */
export const isCI = !!process.env.CI;

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
   */
  setupMocking: [async ({ page }, use) => {
    if (isCI) {
      await mockSessionsAPI(page);
    }
    await use();

    // Cleanup
    if (isCI) {
      clearMockSessions();
    }
  }, { auto: true }],

  /**
   * Create a session - uses mock in CI, real API locally
   */
  createSession: async ({ request }, use) => {
    await use(async (data: CreateSessionInput) => {
      if (isCI) {
        // In CI, create mock session
        const id = createMockSession({
          tracks: data.tracks ?? [],
          tempo: data.tempo ?? 120,
          swing: data.swing ?? 0,
          version: data.version ?? 1,
        });
        return { id };
      } else {
        // Locally, use real API
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
 */
export async function waitForAppReady(page: Page): Promise<void> {
  // Wait for either track rows OR sample picker to be visible
  await page.locator('.track-row, .sample-picker').first().waitFor({
    state: 'visible',
    timeout: 15000
  });
  // Wait for network to settle
  await page.waitForLoadState('networkidle');
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

export { expect };
