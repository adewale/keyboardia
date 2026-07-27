/**
 * Mobile-Specific Tests (iPhone)
 *
 * Tests for mobile viewport behavior, touch interactions, and responsive UI.
 * Uses Playwright best practices with proper waits.
 *
 * NOTE: These tests use WebKit (Safari) browser via devices['iPhone 14'].
 * Run with: npx playwright test mobile-iphone --project=mobile-safari
 * Will skip if running with --project=chromium or if WebKit isn't installed.
 *
 * @see specs/research/PLAYWRIGHT-TESTING.md
 */

import { test, expect, waitForAppReady, waitForAnimation, useMockAPI } from './global-setup';
import { createPopulatedSessionWithRetry } from './test-utils';

// These tests require mobile-safari project for proper iPhone emulation with touch support
// Skip with mock API or when touch is not enabled (webkit Desktop Safari doesn't have hasTouch)
// For local CI: npx playwright test e2e/mobile-iphone.spec.ts --project=mobile-safari
test.skip(
  ({ hasTouch }) => useMockAPI || !hasTouch,
  'iPhone tests require touch support (run with --project=mobile-safari)'
);

test.describe('Mobile Layout (iPhone)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
  });

  test('app is usable on mobile viewport', async ({ page }) => {
    const mainContent = page.locator('.App, main, #root').first();
    await expect(mainContent).toBeVisible();

    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);

    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 10);
  });

  test('touch targets are adequate size', async ({ page }) => {
    const minTouchSize = 44;

    const controls = [
      page.locator('.portrait-play-btn'),
      page.locator('.orientation-hint-dismiss'),
    ];
    for (const control of controls) {
      await expect(control).toBeVisible();
      const box = await control.boundingBox();
      expect(box, 'visible portrait control has no layout box').not.toBeNull();
      expect(box!.width).toBeGreaterThanOrEqual(minTouchSize);
      expect(box!.height).toBeGreaterThanOrEqual(minTouchSize);
    }
  });

  test('portrait mode hides editing controls and directs users to rotate', async ({ page }) => {
    await expect(page.locator('.sample-picker')).toBeHidden();
    await expect(page.locator('.orientation-hint')).toContainText('Rotate to edit');
  });

  test('populated portrait tracks fit without horizontal overflow', async ({ page, request }) => {
    const { id } = await createPopulatedSessionWithRetry(request);
    await page.goto(`/s/${id}`);
    await waitForAppReady(page);

    const rows = page.locator('.portrait-track-row');
    await expect(rows).toHaveCount(10);
    const grid = page.locator('.portrait-grid');
    const scrollInfo = await grid.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    expect(scrollInfo.scrollWidth).toBeLessThanOrEqual(scrollInfo.clientWidth + 1);
    await expect(rows.last().locator('.portrait-step-cell').last()).toBeVisible();
  });

  test('velocity lane is hidden on small screens', async ({ page }) => {
    // The test name is the claim; assert it rather than logging it.
    await expect(page.locator('.velocity-lane')).toBeHidden();
  });
});

test.describe('Mobile Touch Interactions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
  });

  test('portrait step cells are read-only', async ({ page, request }) => {
    const { id } = await createPopulatedSessionWithRetry(request);
    await page.goto(`/s/${id}`);
    await waitForAppReady(page);

    const stepCell = page.locator('.portrait-step-cell').first();
    await expect(stepCell).toBeVisible();
    await expect(stepCell).toHaveCSS('pointer-events', 'none');
  });

  test('no ghost clicks on mobile', async ({ page }) => {
    await page.evaluate(() => {
      (window as unknown as { __clicks: number[] }).__clicks = [];
      document.addEventListener('click', () => {
        (window as unknown as { __clicks: number[] }).__clicks.push(Date.now());
      });
    });

    const secondPage = page.getByRole('button', { name: 'View steps 9-16' });
    await secondPage.tap();
    await expect(secondPage).toHaveAttribute('aria-pressed', 'true');
    await waitForAnimation(page);

    const clicks = await page.evaluate(() => {
      return (window as unknown as { __clicks: number[] }).__clicks;
    });
    expect(clicks).toHaveLength(1);
  });

  test('portrait play control works with tap', async ({ page }) => {
    const playButton = page.locator('.portrait-play-btn');
    await expect(playButton).toHaveAttribute('aria-label', 'Play');

    await playButton.tap();
    await expect(playButton).toHaveAttribute('aria-label', 'Stop');
    await expect(playButton).toHaveClass(/playing/);

    await playButton.tap();
    await expect(playButton).toHaveAttribute('aria-label', 'Play');
    await expect(playButton).not.toHaveClass(/playing/);
  });
});
