/**
 * Mobile-Specific Tests (Android)
 *
 * Tests for Android-specific mobile behavior.
 * Uses Playwright best practices with proper waits.
 *
 * @see specs/research/PLAYWRIGHT-TESTING.md
 */

import { test, expect, devices } from '@playwright/test';
import { waitForAppReady } from './global-setup';

// Skip in CI - requires real backend infrastructure
test.skip(!!process.env.CI, 'Skipped in CI - requires real backend');

// Device configuration must be at top level
test.use(devices['Pixel 7']);

test.describe('Android Mobile', () => {
  test('app works on Android', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    const mainContent = page.locator('.App, main, #root').first();
    await expect(mainContent).toBeVisible();

    const stepCell = page.locator('.step-cell').first();
    if (await stepCell.isVisible()) {
      await stepCell.tap();

      await expect(stepCell).toHaveClass(/active/, { timeout: 1000 })
        .catch(() => expect(stepCell).toHaveAttribute('aria-pressed', 'true'));
    }
  });
});
