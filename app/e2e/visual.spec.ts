/**
 * Visual Regression Tests
 *
 * Tests for visual consistency using Playwright's built-in screenshot comparison.
 * Baseline screenshots are stored in e2e/__snapshots__/
 *
 * Run with --update-snapshots to update baselines:
 *   npx playwright test visual.spec.ts --update-snapshots
 *
 * @see specs/research/PLAYWRIGHT-TESTING.md
 */

import { test, expect } from '@playwright/test';
import { waitWithTolerance } from './global-setup';

// Desktop visual tests use a fixed viewport for consistency
test.describe('Visual Regression (Desktop)', () => {
  test.use({ viewport: { width: 1280, height: 720 } });
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.track-row, .sample-picker', { timeout: 15000 });
    // Wait for animations to settle
    await waitWithTolerance(page, 1000);
  });

  test('sequencer grid appearance', async ({ page }) => {
    // Wait for any loading animations
    await waitWithTolerance(page, 500);

    // Take screenshot of the main grid area
    const grid = page.locator('.sequencer-grid, .tracks').first();

    if (await grid.isVisible()) {
      await expect(grid).toHaveScreenshot('sequencer-grid.png', {
        maxDiffPixels: 100, // Allow minor anti-aliasing differences
        threshold: 0.2,
      });
    } else {
      // If no grid, take full page screenshot
      await expect(page).toHaveScreenshot('full-page.png', {
        maxDiffPixels: 200,
        threshold: 0.2,
      });
    }
  });

  test('transport controls appearance', async ({ page }) => {
    await waitWithTolerance(page, 500);

    const transport = page.locator('.transport, .transport-controls').first();

    if (await transport.isVisible()) {
      await expect(transport).toHaveScreenshot('transport-controls.png', {
        maxDiffPixels: 50,
        threshold: 0.2,
      });
    }
  });

  test('sample picker appearance', async ({ page }) => {
    await waitWithTolerance(page, 500);

    const picker = page.locator('.sample-picker').first();

    if (await picker.isVisible()) {
      await expect(picker).toHaveScreenshot('sample-picker.png', {
        maxDiffPixels: 100,
        threshold: 0.2,
      });
    }
  });

  test('track row with active steps', async ({ page }) => {
    await waitWithTolerance(page, 500);

    // Toggle some steps to create a pattern
    const stepCells = page.locator('.step-cell');
    const stepCount = await stepCells.count();

    if (stepCount >= 8) {
      // Create a simple pattern
      await stepCells.nth(0).click();
      await stepCells.nth(4).click();
      await stepCells.nth(8).click();
      await stepCells.nth(12).click();

      await waitWithTolerance(page, 300);

      // Screenshot the first track row
      const trackRow = page.locator('.track-row').first();
      if (await trackRow.isVisible()) {
        await expect(trackRow).toHaveScreenshot('track-row-with-steps.png', {
          maxDiffPixels: 100,
          threshold: 0.2,
        });
      }
    }
  });

  test('velocity lane expanded', async ({ page }) => {
    await waitWithTolerance(page, 500);

    // Try to expand velocity lane
    const velocityToggle = page.locator('[data-testid="velocity-toggle"], .velocity-toggle').first();

    if (await velocityToggle.isVisible({ timeout: 2000 }).catch(() => false)) {
      await velocityToggle.click();
      await waitWithTolerance(page, 300);

      const velocityLane = page.locator('.velocity-lane').first();
      if (await velocityLane.isVisible()) {
        await expect(velocityLane).toHaveScreenshot('velocity-lane-expanded.png', {
          maxDiffPixels: 100,
          threshold: 0.2,
        });
      }
    }
  });
});

test.describe('Responsive Visual Regression', () => {
  test('mobile layout (iPhone)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await page.waitForSelector('.track-row, .sample-picker', { timeout: 15000 });
    await waitWithTolerance(page, 1000);

    await expect(page).toHaveScreenshot('mobile-layout-iphone.png', {
      maxDiffPixels: 200,
      threshold: 0.2,
    });
  });

  test('tablet layout (iPad)', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/');
    await page.waitForSelector('.track-row, .sample-picker', { timeout: 15000 });
    await waitWithTolerance(page, 1000);

    await expect(page).toHaveScreenshot('tablet-layout-ipad.png', {
      maxDiffPixels: 200,
      threshold: 0.2,
    });
  });

  test('wide desktop layout', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/');
    await page.waitForSelector('.track-row, .sample-picker', { timeout: 15000 });
    await waitWithTolerance(page, 1000);

    await expect(page).toHaveScreenshot('desktop-wide.png', {
      maxDiffPixels: 200,
      threshold: 0.2,
    });
  });
});

test.describe('Interaction State Screenshots', () => {
  test('button hover states', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.track-row, .sample-picker', { timeout: 15000 });
    await waitWithTolerance(page, 500);

    // Hover over play button
    const playButton = page.locator('[data-testid="play-button"], .transport button').first();
    if (await playButton.isVisible()) {
      await playButton.hover();
      await waitWithTolerance(page, 200);

      await expect(playButton).toHaveScreenshot('play-button-hover.png', {
        maxDiffPixels: 50,
        threshold: 0.3,
      });
    }
  });

  test('step cell active state', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.step-cell', { timeout: 15000 });
    await waitWithTolerance(page, 500);

    const stepCell = page.locator('.step-cell').first();
    if (await stepCell.isVisible()) {
      // Toggle to active
      await stepCell.click();
      await waitWithTolerance(page, 200);

      await expect(stepCell).toHaveScreenshot('step-cell-active.png', {
        maxDiffPixels: 20,
        threshold: 0.2,
      });
    }
  });

  test('step cell inactive state', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.step-cell', { timeout: 15000 });
    await waitWithTolerance(page, 500);

    // Find an inactive step cell (not the first one, in case it was toggled)
    const stepCell = page.locator('.step-cell').nth(5);
    if (await stepCell.isVisible()) {
      // Make sure it's inactive
      const isActive = await stepCell.evaluate((el) =>
        el.classList.contains('active')
      );
      if (isActive) {
        await stepCell.click(); // Toggle off
        await waitWithTolerance(page, 200);
      }

      await expect(stepCell).toHaveScreenshot('step-cell-inactive.png', {
        maxDiffPixels: 20,
        threshold: 0.2,
      });
    }
  });
});
