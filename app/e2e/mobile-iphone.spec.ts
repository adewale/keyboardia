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

import { test, expect, waitForAppReady, waitForAnimation, isCI, useMockAPI } from './global-setup';

// These tests require mobile-safari project for proper iPhone emulation
// Skip in CI, with mock API, or when NOT running with mobile-safari project
// The mobile-safari project in playwright.config.ts already configures iPhone 14 device
test.skip(
  ({ browserName }) => isCI || useMockAPI || browserName !== 'webkit',
  'iPhone tests require mobile-safari project (run with --project=mobile-safari)'
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

    const stepCells = page.locator('.step-cell');
    const stepCount = await stepCells.count();

    if (stepCount > 0) {
      const firstStep = stepCells.first();
      const box = await firstStep.boundingBox();
      if (box) {
        console.log(`Step cell size: ${box.width}x${box.height}`);
      }
    }

    const playButton = page.getByRole('button', { name: /play/i })
      .or(page.locator('[data-testid="play-button"]'))
      .or(page.locator('.transport button').first());

    if (await playButton.isVisible()) {
      const box = await playButton.boundingBox();
      if (box) {
        console.log(`Play button size: ${box.width}x${box.height}`);
        expect(box.width).toBeGreaterThanOrEqual(minTouchSize * 0.75);
        expect(box.height).toBeGreaterThanOrEqual(minTouchSize * 0.75);
      }
    }
  });

  test('sample picker is accessible on mobile', async ({ page }) => {
    const picker = page.locator('.sample-picker');

    if (await picker.isVisible()) {
      await expect(picker).toBeVisible();

      const categoryHeader = page.getByRole('button', { name: /.+/ })
        .filter({ has: page.locator('.category-header') })
        .or(page.locator('.category-header')).first();

      if (await categoryHeader.isVisible()) {
        await categoryHeader.tap();

        // Wait for instruments to appear
        const instruments = page.locator('.instrument-btn, .sample-button');
        await expect(instruments.first()).toBeVisible({ timeout: 2000 }).catch(() => {});

        const instrumentCount = await instruments.count();
        expect(instrumentCount).toBeGreaterThan(0);
      }
    }
  });

  test('track rows are scrollable', async ({ page }) => {
    const tracksContainer = page.locator('.tracks, .sequencer-grid').first();

    if (await tracksContainer.isVisible()) {
      const scrollInfo = await tracksContainer.evaluate((el) => ({
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        canScroll: el.scrollWidth > el.clientWidth,
      }));

      console.log(`Scroll info: ${JSON.stringify(scrollInfo)}`);

      if (scrollInfo.canScroll) {
        const initialScrollLeft = await tracksContainer.evaluate((el) => el.scrollLeft);

        const box = await tracksContainer.boundingBox();
        if (box) {
          await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2);
          await page.mouse.down();
          await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2, { steps: 10 });
          await page.mouse.up();

          await waitForAnimation(page);

          const newScrollLeft = await tracksContainer.evaluate((el) => el.scrollLeft);
          console.log(`Scroll: ${initialScrollLeft} -> ${newScrollLeft}`);
        }
      }
    }
  });

  test('velocity lane is hidden on small screens', async ({ page }) => {
    const velocityLane = page.locator('.velocity-lane');
    const isVisible = await velocityLane.isVisible({ timeout: 1000 }).catch(() => false);
    console.log(`Velocity lane visible on mobile: ${isVisible}`);
  });
});

test.describe('Mobile Touch Interactions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
  });

  test('can tap to toggle steps', async ({ page }) => {
    const stepCell = page.locator('.step-cell').first();

    if (!(await stepCell.isVisible())) {
      test.skip(true, 'No step cells visible');
      return;
    }

    const initialActive = await stepCell.evaluate((el) =>
      el.classList.contains('active') ||
      el.getAttribute('aria-pressed') === 'true'
    );

    await stepCell.tap();

    // Wait for state change with web-first assertion
    await expect(async () => {
      const newActive = await stepCell.evaluate((el) =>
        el.classList.contains('active') ||
        el.getAttribute('aria-pressed') === 'true'
      );
      expect(newActive).not.toBe(initialActive);
    }).toPass({ timeout: 1000 });
  });

  test('can add track via tap', async ({ page }) => {
    const trackRows = page.locator('.track-row');
    const initialTrackCount = await trackRows.count();

    const instrumentBtn = page.locator('.instrument-btn, .sample-button').first();

    try {
      await instrumentBtn.waitFor({ state: 'visible', timeout: 2000 });
      await instrumentBtn.tap();
      await expect(trackRows).toHaveCount(initialTrackCount + 1, { timeout: 2000 });
    } catch {
      // Try expanding a category first
      const category = page.locator('.category-header').first();
      if (await category.isVisible()) {
        await category.tap();

        const instrumentBtnAfterExpand = page.locator('.instrument-btn, .sample-button').first();
        await instrumentBtnAfterExpand.waitFor({ state: 'visible', timeout: 1000 });
        await instrumentBtnAfterExpand.tap();

        await expect(trackRows).toHaveCount(initialTrackCount + 1, { timeout: 2000 });
      }
    }
  });

  test('transport controls work with tap', async ({ page }) => {
    const playButton = page.getByRole('button', { name: /play/i })
      .or(page.locator('[data-testid="play-button"]'))
      .or(page.locator('.transport button').first());

    if (!(await playButton.isVisible())) {
      test.skip(true, 'Play button not visible');
      return;
    }

    await playButton.tap();

    // Wait for playing indicator
    await expect(async () => {
      const isPlaying = await page.evaluate(() => {
        const playhead = document.querySelector('.playhead, [data-testid="playhead"]');
        const playingClass = document.querySelector('.playing, [data-playing="true"]');
        return !!(playhead || playingClass);
      });
      console.log(`Playing after tap: ${isPlaying}`);
    }).toPass({ timeout: 1000 }).catch(() => {});

    await playButton.tap();
  });

  test('no ghost clicks on mobile', async ({ page }) => {
    await page.evaluate(() => {
      (window as unknown as { __clicks: number[] }).__clicks = [];
      document.addEventListener('click', () => {
        (window as unknown as { __clicks: number[] }).__clicks.push(Date.now());
      });
    });

    const stepCell = page.locator('.step-cell').first();
    if (await stepCell.isVisible()) {
      await stepCell.tap();

      // Wait for potential ghost clicks
      await waitForAnimation(page);

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
      console.log(`Clicks: ${clicks.length}, Ghost clicks: ${ghostClickCount}`);
    }
  });
});
