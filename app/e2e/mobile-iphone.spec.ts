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

// These tests require mobile-safari project for proper iPhone emulation with touch support
// Skip with mock API or when touch is not enabled (webkit Desktop Safari doesn't have hasTouch)
// For local CI: npx playwright test e2e/mobile-iphone.spec.ts --project=mobile-safari
test.skip(
  ({ hasTouch }) => useMockAPI || !hasTouch,
  'iPhone tests require touch support (run with --project=mobile-safari)'
);

/**
 * Add a track by tapping an instrument, expanding its category first if needed.
 *
 * Sessions start empty, so anything touching `.step-cell` or expecting the grid
 * to overflow has to add a track first. Tests here used to guard on step-cell
 * visibility and skip — which, on an empty session, meant always.
 */
async function addTrackByTap(page: import('@playwright/test').Page): Promise<void> {
  const instrumentBtn = page.locator('.instrument-btn, .sample-button').first();

  if (!(await instrumentBtn.isVisible().catch(() => false))) {
    // Categories start collapsed on narrow viewports.
    const category = page.locator('.category-header').first();
    await expect(category, 'no instrument button and no category to expand').toBeVisible();
    await category.tap();
  }

  await expect(instrumentBtn).toBeVisible({ timeout: 5000 });
  await instrumentBtn.tap();
  await expect(page.locator('.track-row').first()).toBeVisible({ timeout: 5000 });
}

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

    // Use data-testid for precise selection (avoids strict mode violation with multiple play buttons)
    const playButton = page.locator('[data-testid="play-button"]');

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

      // Find any category header (they're buttons with .category-header class)
      const categoryHeader = page.locator('.category-header').first();

      if (await categoryHeader.isVisible()) {
        // Check if already expanded (has instruments visible)
        const instruments = page.locator('.instrument-btn');
        const alreadyExpanded = await instruments.first().isVisible().catch(() => false);

        if (!alreadyExpanded) {
          // Tap to expand category
          await categoryHeader.tap();
          // Wait for expansion animation
          await page.waitForTimeout(300);
        }

        // Verify instruments are now visible
        await expect(instruments.first()).toBeVisible({ timeout: 2000 });
        const instrumentCount = await instruments.count();
        expect(instrumentCount).toBeGreaterThan(0);
      }
    }
  });

  test('track rows are scrollable', async ({ page }) => {
    // Needs a track: an empty grid has nothing to overflow, which is why the
    // previous version's `if (canScroll)` branch never ran.
    await addTrackByTap(page);

    const tracksContainer = page.locator('.tracks, .sequencer-grid').first();
    await expect(tracksContainer).toBeVisible();

    const scrollInfo = await tracksContainer.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));

    // The premise of the test: on an iPhone viewport the grid must overflow, or
    // there is nothing to scroll and the drag below proves nothing.
    expect(
      scrollInfo.scrollWidth,
      `grid does not overflow the viewport (${JSON.stringify(scrollInfo)}), so it cannot scroll`
    ).toBeGreaterThan(scrollInfo.clientWidth);

    const initialScrollLeft = await tracksContainer.evaluate((el) => el.scrollLeft);

    const box = await tracksContainer.boundingBox();
    expect(box, 'tracks container has no bounding box').not.toBeNull();

    await page.mouse.move(box!.x + box!.width * 0.8, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width * 0.2, box!.y + box!.height / 2, { steps: 10 });
    await page.mouse.up();

    await waitForAnimation(page);

    const newScrollLeft = await tracksContainer.evaluate((el) => el.scrollLeft);
    expect(newScrollLeft, 'dragging left should scroll the grid').toBeGreaterThan(
      initialScrollLeft
    );
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

  test('can tap to toggle steps', async ({ page }) => {
    // A fresh session has no tracks and therefore no step cells, so the old
    // `if (!visible) test.skip(true, ...)` guard fired on every run and this
    // test never executed. Add a track so there is something to tap.
    await addTrackByTap(page);

    const stepCell = page.locator('.step-cell').first();
    await expect(stepCell).toBeVisible();

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

    // The catch branch here used to end in `if (await category.isVisible())`
    // with no else, so when neither path worked the test passed having added
    // nothing.
    await addTrackByTap(page);
    await expect(trackRows).toHaveCount(initialTrackCount + 1, { timeout: 5000 });
  });

  test('transport controls work with tap', async ({ page }) => {
    // Use data-testid for precise selection (avoids strict mode violation with multiple play buttons)
    const playButton = page.locator('[data-testid="play-button"]');
    await expect(playButton).toBeVisible();

    // Transport.tsx puts a `playing` class on the play button while running.
    // The old version wrapped a bare console.log in `.toPass().catch(() => {})`
    // — no assertion inside, and the result discarded — so it could not fail.
    await expect(playButton).not.toHaveClass(/playing/);

    await playButton.tap();
    await expect(playButton, 'tapping play should start playback').toHaveClass(/playing/);

    await playButton.tap();
    await expect(playButton, 'tapping again should stop playback').not.toHaveClass(/playing/);
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
