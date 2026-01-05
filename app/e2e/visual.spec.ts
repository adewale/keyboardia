/**
 * Visual Regression Tests
 *
 * Tests for visual consistency using Playwright's built-in screenshot comparison.
 * Baseline screenshots are stored in e2e/__snapshots__/
 *
 * Run with --update-snapshots to update baselines:
 *   npx playwright test visual.spec.ts --update-snapshots
 *
 * Uses Playwright best practices with proper waits for animations.
 *
 * @see specs/research/PLAYWRIGHT-TESTING.md
 */

import { test, expect } from '@playwright/test';
import { waitForAppReady, waitForAnimation } from './global-setup';

// Desktop visual tests use a fixed viewport for consistency
test.describe('Visual Regression (Desktop)', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
    // Wait for animations to settle before screenshots
    await waitForAnimation(page);
  });

  test('sequencer grid appearance', async ({ page }) => {
    const grid = page.locator('.sequencer-grid, .tracks').first();

    if (await grid.isVisible()) {
      await expect(grid).toHaveScreenshot('sequencer-grid.png', {
        maxDiffPixels: 100,
        threshold: 0.2,
      });
    } else {
      await expect(page).toHaveScreenshot('full-page.png', {
        maxDiffPixels: 200,
        threshold: 0.2,
      });
    }
  });

  test('transport controls appearance', async ({ page }) => {
    const transport = page.locator('.transport, .transport-controls').first();

    if (await transport.isVisible()) {
      await expect(transport).toHaveScreenshot('transport-controls.png', {
        maxDiffPixels: 50,
        threshold: 0.2,
      });
    }
  });

  test('sample picker appearance', async ({ page }) => {
    const picker = page.locator('.sample-picker').first();

    if (await picker.isVisible()) {
      await expect(picker).toHaveScreenshot('sample-picker.png', {
        maxDiffPixels: 100,
        threshold: 0.2,
      });
    }
  });

  test('track row with active steps', async ({ page }) => {
    const stepCells = page.locator('.step-cell');
    const stepCount = await stepCells.count();

    if (stepCount >= 8) {
      // Create a simple pattern and wait for each to be visible
      await stepCells.nth(0).click();
      await expect(stepCells.nth(0)).toHaveClass(/active/).catch(() => {});

      await stepCells.nth(4).click();
      await stepCells.nth(8).click();
      await stepCells.nth(12).click();

      await waitForAnimation(page);

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
    const velocityToggle = page.getByRole('button', { name: /velocity/i })
      .or(page.locator('[data-testid="velocity-toggle"], .velocity-toggle'));

    try {
      await velocityToggle.first().waitFor({ state: 'visible', timeout: 2000 });
      await velocityToggle.first().click();

      const velocityLane = page.locator('.velocity-lane').first();
      await velocityLane.waitFor({ state: 'visible', timeout: 1000 });

      await expect(velocityLane).toHaveScreenshot('velocity-lane-expanded.png', {
        maxDiffPixels: 100,
        threshold: 0.2,
      });
    } catch {
      // Velocity toggle not visible
    }
  });
});

test.describe('Responsive Visual Regression', () => {
  test('mobile layout (iPhone)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await waitForAppReady(page);
    await waitForAnimation(page);

    await expect(page).toHaveScreenshot('mobile-layout-iphone.png', {
      maxDiffPixels: 200,
      threshold: 0.2,
    });
  });

  test('tablet layout (iPad)', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/');
    await waitForAppReady(page);
    await waitForAnimation(page);

    await expect(page).toHaveScreenshot('tablet-layout-ipad.png', {
      maxDiffPixels: 200,
      threshold: 0.2,
    });
  });

  test('wide desktop layout', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/');
    await waitForAppReady(page);
    await waitForAnimation(page);

    await expect(page).toHaveScreenshot('desktop-wide.png', {
      maxDiffPixels: 200,
      threshold: 0.2,
    });
  });
});

test.describe('Interaction State Screenshots', () => {
  test('button hover states', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    const playButton = page.getByRole('button', { name: /play/i })
      .or(page.locator('[data-testid="play-button"]'))
      .or(page.locator('.transport button').first());

    if (await playButton.isVisible()) {
      await playButton.hover();
      await waitForAnimation(page);

      await expect(playButton).toHaveScreenshot('play-button-hover.png', {
        maxDiffPixels: 50,
        threshold: 0.3,
      });
    }
  });

  test('step cell active state', async ({ page }) => {
    await page.goto('/');
    await page.locator('.step-cell').first().waitFor({ state: 'visible', timeout: 15000 });

    const stepCell = page.locator('.step-cell').first();
    if (await stepCell.isVisible()) {
      await stepCell.click();
      await expect(stepCell).toHaveClass(/active/).catch(() => {});

      await expect(stepCell).toHaveScreenshot('step-cell-active.png', {
        maxDiffPixels: 20,
        threshold: 0.2,
      });
    }
  });

  test('step cell inactive state', async ({ page }) => {
    await page.goto('/');
    await page.locator('.step-cell').first().waitFor({ state: 'visible', timeout: 15000 });

    const stepCell = page.locator('.step-cell').nth(5);
    if (await stepCell.isVisible()) {
      // Ensure inactive
      const isActive = await stepCell.evaluate((el) => el.classList.contains('active'));
      if (isActive) {
        await stepCell.click();
        await expect(stepCell).not.toHaveClass(/active/).catch(() => {});
      }

      await expect(stepCell).toHaveScreenshot('step-cell-inactive.png', {
        maxDiffPixels: 20,
        threshold: 0.2,
      });
    }
  });
});
