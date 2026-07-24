import { test, expect, waitForAnimation } from './global-setup';

const HOLBY_PATH = '/s/8444f694-0a9a-41f3-815d-b9c6eb518c50';

/**
 * Blocking visual coverage uses an exact checked-in state, a stable mock UUID,
 * fixed viewports, and reduced motion. It never builds the screenshot state by
 * clicking random catalogue entries or racing playback.
 */
test.describe('Deterministic populated-session visuals', () => {
  test.beforeEach(async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Populated visual baselines target Chromium');
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('Holby portrait consumption view', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(HOLBY_PATH);
    await expect(page.locator('.portrait-track-row')).toHaveCount(10, { timeout: 15_000 });
    await expect(page.locator('.portrait-session-name')).toHaveText('Holby');
    await waitForAnimation(page);

    await expect(page).toHaveScreenshot('holby-populated-portrait.png', {
      // GitHub's Linux font package renders labels slightly heavier than the
      // Playwright container while preserving the same geometry and state.
      maxDiffPixelRatio: 0.01,
      threshold: 0.2,
    });
  });

  test('Holby landscape editing view', async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await page.goto(HOLBY_PATH);
    await expect(page.locator('.track-row')).toHaveCount(10, { timeout: 15_000 });
    await expect(page.locator('.session-name')).toHaveText('Holby');
    await waitForAnimation(page);

    await expect(page).toHaveScreenshot('holby-populated-landscape.png', {
      maxDiffPixelRatio: 0.035,
      threshold: 0.2,
    });
  });
});
