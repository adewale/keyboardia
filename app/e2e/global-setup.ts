/**
 * Global E2E Test Setup
 *
 * Configures test environment for CI vs local development.
 * In CI: Uses mocked API responses for reliability
 * Locally: Uses real backend for full integration testing
 *
 * @see specs/research/PLAYWRIGHT-TESTING.md
 */

import { test as base, expect } from '@playwright/test';
import { mockSessionsAPI, createMockSession, clearMockSessions } from './fixtures/network.fixture';
import { API_BASE, createSessionWithRetry } from './test-utils';

/**
 * Whether we're running in CI environment
 */
export const isCI = !!process.env.CI;

/**
 * Test base with conditional mocking
 *
 * In CI: Mocks API calls for reliability
 * Locally: Uses real backend
 */
export const test = base.extend<{
  setupMocking: void;
  createSession: (data: Record<string, unknown>) => Promise<{ id: string }>;
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
    await use(async (data: Record<string, unknown>) => {
      if (isCI) {
        // In CI, create mock session
        const id = createMockSession({
          tracks: data.tracks as [],
          tempo: (data.tempo as number) ?? 120,
          swing: (data.swing as number) ?? 0,
          version: (data.version as number) ?? 1,
        });
        return { id };
      } else {
        // Locally, use real API
        return createSessionWithRetry(request, data);
      }
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

/**
 * Wait timeout multiplier for CI
 */
export const WAIT_MULTIPLIER = isCI ? 1.5 : 1;

/**
 * Helper to wait with CI-adjusted timing
 */
export async function waitWithTolerance(page: import('@playwright/test').Page, ms: number): Promise<void> {
  await page.waitForTimeout(Math.round(ms * WAIT_MULTIPLIER));
}

export { expect };
