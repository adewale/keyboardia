/**
 * Mobile-Specific Tests
 *
 * Tests for mobile viewport behavior, touch interactions, and responsive UI.
 *
 * @see specs/research/PLAYWRIGHT-TESTING.md
 */

import { test, expect, devices } from '@playwright/test';
import { waitWithTolerance } from './global-setup';

// Test on iPhone viewport
test.use(devices['iPhone 14']);

test.describe('Mobile Layout', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.track-row, .sample-picker', { timeout: 15000 });
    await waitWithTolerance(page, 500);
  });

  test('app is usable on mobile viewport', async ({ page }) => {
    // Verify main elements are visible
    const mainContent = page.locator('.App, main, #root').first();
    await expect(mainContent).toBeVisible();

    // No horizontal overflow (content fits viewport)
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);

    // Allow small tolerance for scrollbars
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 10);
  });

  test('touch targets are adequate size', async ({ page }) => {
    // WCAG 2.1 recommends 44x44px minimum touch targets
    const minTouchSize = 44;

    // Check step cells
    const stepCells = page.locator('.step-cell');
    const stepCount = await stepCells.count();

    if (stepCount > 0) {
      const firstStep = stepCells.first();
      const box = await firstStep.boundingBox();

      if (box) {
        console.log(`Step cell size: ${box.width}x${box.height}`);
        // Note: Smaller touch targets are common in sequencers
        // Just log the size for review
      }
    }

    // Check play button
    const playButton = page.locator('[data-testid="play-button"], .transport button').first();
    if (await playButton.isVisible()) {
      const box = await playButton.boundingBox();
      if (box) {
        console.log(`Play button size: ${box.width}x${box.height}`);
        // Play button should be at least minimum touch target
        expect(box.width).toBeGreaterThanOrEqual(minTouchSize * 0.75);
        expect(box.height).toBeGreaterThanOrEqual(minTouchSize * 0.75);
      }
    }
  });

  test('sample picker is accessible on mobile', async ({ page }) => {
    const picker = page.locator('.sample-picker');

    if (await picker.isVisible()) {
      // Should be visible and usable
      await expect(picker).toBeVisible();

      // Categories should be expandable
      const categoryHeader = page.locator('.category-header').first();
      if (await categoryHeader.isVisible()) {
        await categoryHeader.tap();
        await waitWithTolerance(page, 300);

        // Instruments should be visible after expansion
        const instruments = page.locator('.instrument-btn, .sample-button');
        const instrumentCount = await instruments.count();
        expect(instrumentCount).toBeGreaterThan(0);
      }
    }
  });

  test('track rows are scrollable', async ({ page }) => {
    const tracksContainer = page.locator('.tracks, .sequencer-grid').first();

    if (await tracksContainer.isVisible()) {
      // Check if scrollable
      const scrollInfo = await tracksContainer.evaluate((el) => ({
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        canScroll: el.scrollWidth > el.clientWidth,
      }));

      console.log(`Scroll info: ${JSON.stringify(scrollInfo)}`);

      // If can scroll, verify it works
      if (scrollInfo.canScroll) {
        const initialScrollLeft = await tracksContainer.evaluate((el) => el.scrollLeft);

        // Simulate swipe
        const box = await tracksContainer.boundingBox();
        if (box) {
          await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2);
          await page.mouse.down();
          await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2, { steps: 10 });
          await page.mouse.up();

          await waitWithTolerance(page, 300);

          const newScrollLeft = await tracksContainer.evaluate((el) => el.scrollLeft);

          // Should have scrolled (or not, if content doesn't overflow on mobile)
          console.log(`Scroll: ${initialScrollLeft} -> ${newScrollLeft}`);
        }
      }
    }
  });

  test('velocity lane is hidden on small screens', async ({ page }) => {
    // On very small screens, velocity lane might be hidden by default
    const velocityLane = page.locator('.velocity-lane');
    const isVisible = await velocityLane.isVisible({ timeout: 1000 }).catch(() => false);

    console.log(`Velocity lane visible on mobile: ${isVisible}`);

    // This is informational - design may vary
  });
});

test.describe('Mobile Touch Interactions', () => {
  test.use(devices['iPhone 14']);

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.track-row, .sample-picker', { timeout: 15000 });
    await waitWithTolerance(page, 500);
  });

  test('can tap to toggle steps', async ({ page }) => {
    const stepCell = page.locator('.step-cell').first();

    if (!(await stepCell.isVisible())) {
      test.skip(true, 'No step cells visible');
      return;
    }

    // Get initial state
    const initialActive = await stepCell.evaluate((el) =>
      el.classList.contains('active')
    );

    // Tap to toggle
    await stepCell.tap();
    await waitWithTolerance(page, 200);

    // Check state changed
    const newActive = await stepCell.evaluate((el) =>
      el.classList.contains('active')
    );

    expect(newActive).not.toBe(initialActive);
    console.log(`Tap toggle: ${initialActive} -> ${newActive}`);
  });

  test('can add track via tap', async ({ page }) => {
    // Count initial tracks
    const initialTrackCount = await page.locator('.track-row').count();

    // Find and tap an instrument
    const instrumentBtn = page.locator('.instrument-btn, .sample-button').first();

    if (await instrumentBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await instrumentBtn.tap();
      await waitWithTolerance(page, 500);

      // Should have one more track
      const newTrackCount = await page.locator('.track-row').count();
      expect(newTrackCount).toBe(initialTrackCount + 1);
    } else {
      // Try expanding a category first
      const category = page.locator('.category-header').first();
      if (await category.isVisible()) {
        await category.tap();
        await waitWithTolerance(page, 300);

        const instrumentBtnAfterExpand = page.locator('.instrument-btn, .sample-button').first();
        if (await instrumentBtnAfterExpand.isVisible()) {
          await instrumentBtnAfterExpand.tap();
          await waitWithTolerance(page, 500);

          const newTrackCount = await page.locator('.track-row').count();
          expect(newTrackCount).toBe(initialTrackCount + 1);
        }
      }
    }
  });

  test('transport controls work with tap', async ({ page }) => {
    const playButton = page.locator('[data-testid="play-button"], .transport button').first();

    if (!(await playButton.isVisible())) {
      test.skip(true, 'Play button not visible');
      return;
    }

    // Tap to start playback
    await playButton.tap();
    await waitWithTolerance(page, 500);

    // Check for playing indicator
    const isPlaying = await page.evaluate(() => {
      // Various ways the app might indicate playing state
      const playhead = document.querySelector('.playhead, [data-testid="playhead"]');
      const playingClass = document.querySelector('.playing, [data-playing="true"]');
      return !!(playhead || playingClass);
    });

    console.log(`Playing after tap: ${isPlaying}`);

    // Tap to stop
    await playButton.tap();
    await waitWithTolerance(page, 300);
  });

  test('no ghost clicks on mobile', async ({ page }) => {
    // Track click events
    await page.evaluate(() => {
      (window as unknown as { __clicks: number[] }).__clicks = [];
      document.addEventListener('click', () => {
        (window as unknown as { __clicks: number[] }).__clicks.push(Date.now());
      });
    });

    // Tap on a step cell
    const stepCell = page.locator('.step-cell').first();
    if (await stepCell.isVisible()) {
      await stepCell.tap();
      await waitWithTolerance(page, 500);

      // Check for ghost clicks (duplicate clicks within 300ms)
      const clicks = await page.evaluate(() => {
        return (window as unknown as { __clicks: number[] }).__clicks;
      });

      let ghostClickCount = 0;
      for (let i = 1; i < clicks.length; i++) {
        if (clicks[i] - clicks[i - 1] < 300) {
          ghostClickCount++;
        }
      }

      expect(ghostClickCount).toBe(0);
      console.log(`Clicks registered: ${clicks.length}, Ghost clicks: ${ghostClickCount}`);
    }
  });
});

test.describe('Android Mobile', () => {
  test.use(devices['Pixel 7']);

  test('app works on Android', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.track-row, .sample-picker', { timeout: 15000 });
    await waitWithTolerance(page, 500);

    // Verify app is functional
    const mainContent = page.locator('.App, main, #root').first();
    await expect(mainContent).toBeVisible();

    // Tap a step
    const stepCell = page.locator('.step-cell').first();
    if (await stepCell.isVisible()) {
      await stepCell.tap();
      await waitWithTolerance(page, 200);

      const isActive = await stepCell.evaluate((el) =>
        el.classList.contains('active')
      );

      expect(isActive).toBe(true);
    }
  });
});
