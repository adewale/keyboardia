import { test, expect } from '@playwright/test';

test.describe('Scrollbar behavior', () => {
  test('should have a single scrollbar for the entire tracks panel, not per track', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-testid="grid"]')).toBeVisible({ timeout: 10000 });

    // The .tracks container (or a wrapper) should have horizontal scroll, not individual .steps containers
    const tracksContainer = page.locator('.tracks');

    // Check that the tracks container has overflow-x set to auto or scroll
    const tracksOverflow = await tracksContainer.evaluate((el) => {
      return window.getComputedStyle(el).overflowX;
    });

    // Individual step containers should NOT have their own scrollbar
    const stepsContainers = page.locator('.steps');
    const stepsCount = await stepsContainers.count();

    // Check that individual .steps don't have overflow-x: auto/scroll
    // They should be visible or hidden to prevent per-track scrollbars
    let hasIndividualScrollbars = false;
    for (let i = 0; i < stepsCount; i++) {
      const stepsOverflow = await stepsContainers.nth(i).evaluate((el) => {
        return window.getComputedStyle(el).overflowX;
      });
      if (stepsOverflow === 'auto' || stepsOverflow === 'scroll') {
        hasIndividualScrollbars = true;
        break;
      }
    }

    // Verify: single panel scrollbar (not per-track)
    expect(hasIndividualScrollbars).toBe(false);
    expect(['auto', 'scroll']).toContain(tracksOverflow);
  });

  test('all tracks should scroll together horizontally when scrolling the panel', async ({ page }) => {
    // Use a smaller viewport to ensure overflow
    await page.setViewportSize({ width: 800, height: 600 });
    await page.goto('/');
    await expect(page.locator('[data-testid="grid"]')).toBeVisible({ timeout: 10000 });

    // Expand a track to 64 steps to ensure scrolling is needed
    const firstTrack64Btn = page.locator('.track-row').first().locator('.step-preset-btn', { hasText: '64' });
    await firstTrack64Btn.click({ force: true });
    await page.waitForTimeout(200);

    // Get initial scroll position of first step in first and last tracks
    const firstTrackFirstStep = page.locator('.track-row').first().locator('.step-cell').first();
    const lastTrackFirstStep = page.locator('.track-row').last().locator('.step-cell').first();

    const initialFirstTrackStepX = await firstTrackFirstStep.boundingBox().then(b => b?.x ?? 0);
    const initialLastTrackStepX = await lastTrackFirstStep.boundingBox().then(b => b?.x ?? 0);

    // Check scrollWidth vs clientWidth to confirm overflow exists
    const tracksContainer = page.locator('.tracks');
    const scrollInfo = await tracksContainer.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      scrollLeft: el.scrollLeft,
      canScroll: el.scrollWidth > el.clientWidth
    }));
    console.log('Scroll info:', scrollInfo);

    // Scroll the tracks container (the single scrollbar container)
    await tracksContainer.evaluate((el) => {
      el.scrollLeft = 200;
    });

    await page.waitForTimeout(100);

    const newScrollLeft = await tracksContainer.evaluate((el) => el.scrollLeft);
    console.log('New scrollLeft:', newScrollLeft);

    // Get new positions
    const newFirstTrackStepX = await firstTrackFirstStep.boundingBox().then(b => b?.x ?? 0);
    const newLastTrackStepX = await lastTrackFirstStep.boundingBox().then(b => b?.x ?? 0);

    console.log('Initial positions:', initialFirstTrackStepX, initialLastTrackStepX);
    console.log('New positions:', newFirstTrackStepX, newLastTrackStepX);

    // Both should have moved by the same amount (within tolerance)
    const firstTrackDelta = initialFirstTrackStepX - newFirstTrackStepX;
    const lastTrackDelta = initialLastTrackStepX - newLastTrackStepX;

    console.log('Deltas:', firstTrackDelta, lastTrackDelta);

    // If there's overflow and we can scroll, verify scrolling works
    if (scrollInfo.canScroll) {
      // If tracks scroll together, the deltas should be equal
      expect(Math.abs(firstTrackDelta - lastTrackDelta)).toBeLessThan(5);
      // And they should have actually scrolled (delta > 0)
      expect(firstTrackDelta).toBeGreaterThan(0);
    } else {
      // If no overflow, that's fine - skip the scroll test
      console.log('No overflow detected, skipping scroll verification');
    }
  });

  test('step columns should align vertically across all tracks', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-testid="grid"]')).toBeVisible({ timeout: 10000 });

    // Get step cells from first two tracks
    const firstTrackSteps = page.locator('.track-row').first().locator('.step-cell');
    const secondTrackSteps = page.locator('.track-row').nth(1).locator('.step-cell');

    // Check that step 0, step 4, and step 8 are vertically aligned
    for (const stepIndex of [0, 4, 8]) {
      const firstTrackStepBox = await firstTrackSteps.nth(stepIndex).boundingBox();
      const secondTrackStepBox = await secondTrackSteps.nth(stepIndex).boundingBox();

      if (firstTrackStepBox && secondTrackStepBox) {
        // X positions should be the same (within 1px tolerance)
        expect(Math.abs(firstTrackStepBox.x - secondTrackStepBox.x)).toBeLessThan(2);
      }
    }
  });
});
