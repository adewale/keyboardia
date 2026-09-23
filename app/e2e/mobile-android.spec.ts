/**
 * Mobile-Specific Tests (Android)
 *
 * Tests for Android-specific mobile behavior.
 * Uses Playwright best practices with proper waits.
 *
 * @see specs/research/PLAYWRIGHT-TESTING.md
 */

import { test, expect, devices, waitForAppReady } from './global-setup';
import { createPopulatedSessionWithRetry } from './test-utils';

// Keep the Pixel viewport, user agent, and touch model without replacing the
// selected Playwright project's browser. The full device descriptor includes
// `defaultBrowserType: chromium`, which made this test launch Chromium even
// when the release matrix collected it as part of the WebKit project.
const { defaultBrowserType: _projectBrowserOverride, ...pixel7 } = devices['Pixel 7'];
test.use(pixel7);

test.describe('Android Mobile', () => {
  test('pages through a populated pattern on Android', async ({ page, request }) => {
    const { id } = await createPopulatedSessionWithRetry(request);
    await page.goto(`/s/${id}`);
    await waitForAppReady(page);

    await expect(page.locator('.portrait-track-row')).toHaveCount(10);
    const secondPage = page.getByRole('button', { name: 'View steps 9-16' });
    await secondPage.tap();
    await expect(secondPage).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.portrait-step-number')).toHaveText([
      '9', '10', '11', '12', '13', '14', '15', '16',
    ]);
    await expect(page.locator('.portrait-track-row').first().locator('.portrait-step-cell').first())
      .toHaveClass(/active/);
  });
});
