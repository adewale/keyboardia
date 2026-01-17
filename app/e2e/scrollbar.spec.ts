/**
 * Scrollbar Behavior Tests
 *
 * Tests for correct horizontal scrolling behavior across tracks.
 * Uses Playwright best practices with proper waits.
 * Verifies single scrollbar for entire panel, not per-track scrollbars.
 *
 * NOTE: Some tests are desktop-only because mobile browsers use touch scrolling
 * which reports CSS overflow properties differently.
 *
 * @see specs/research/PLAYWRIGHT-TESTING.md
 */

import { test, expect, waitForAnimation, getBaseUrl } from './global-setup';
import { createSessionWithRetry } from './test-utils';

const API_BASE = getBaseUrl();

/**
 * Check if running on a mobile browser project.
 */
function isMobileProject(projectName: string): boolean {
  return projectName.startsWith('mobile-');
}

/**
 * Create a test session with multiple tracks for scrollbar testing
 */
async function createTestSession(request: Parameters<typeof createSessionWithRetry>[0], stepCount = 16) {
  const steps = Array(64).fill(false);
  steps[0] = true;
  steps[4] = true;

  return createSessionWithRetry(request, {
    tracks: [
      {
        id: 'test-track-1',
        name: 'Kick',
        sampleId: 'kick',
        steps,
        parameterLocks: Array(64).fill(null),
        volume: 1,
        muted: false,
        transpose: 0,
        stepCount,
      },
      {
        id: 'test-track-2',
        name: 'Snare',
        sampleId: 'snare',
        steps,
        parameterLocks: Array(64).fill(null),
        volume: 1,
        muted: false,
        transpose: 0,
        stepCount,
      },
    ],
    tempo: 120,
    swing: 0,
    version: 1,
  });
}

test.describe('Scrollbar behavior', () => {
  test.beforeEach(async ({ page, request }) => {
    const { id } = await createTestSession(request);
    await page.goto(`${API_BASE}/s/${id}`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[data-testid="grid"]')).toBeVisible({ timeout: 10000 });
    // Wait for WebSocket connection to ensure state is fully synced
    await expect(page.locator('.connection-status--connected')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.track-row').first()).toBeVisible({ timeout: 5000 });
  });

  test('should have a single scrollbar for the entire tracks panel, not per track', async ({ page }, testInfo) => {
    // Skip on mobile - touch scrolling reports overflow differently than desktop scrollbars
    test.skip(isMobileProject(testInfo.project.name), 'Desktop-only - CSS overflow behaves differently with touch scrolling');

    // Check if tracks container exists
    const tracksContainer = page.locator('.tracks, .sequencer-grid');
    if (!(await tracksContainer.isVisible({ timeout: 2000 }).catch(() => false))) {
      test.skip(true, 'No tracks container found');
      return;
    }

    // The .tracks container should have horizontal scroll
    const tracksOverflow = await tracksContainer.evaluate((el) => {
      return window.getComputedStyle(el).overflowX;
    });

    // Individual step containers should NOT have their own scrollbar
    const stepsContainers = page.locator('.steps');
    const stepsCount = await stepsContainers.count();

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
    expect(['auto', 'scroll', 'visible']).toContain(tracksOverflow);
  });

  test('all tracks should scroll together horizontally when scrolling the panel', async ({ page, request }) => {
    // Create a new session with 64 steps to ensure scrolling is needed
    const { id } = await createTestSession(request, 64);
    await page.goto(`${API_BASE}/s/${id}`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[data-testid="grid"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.track-row').first()).toBeVisible({ timeout: 5000 });

    // Use a viewport size that causes overflow
    await page.setViewportSize({ width: 1024, height: 768 });
    await waitForAnimation(page);

    // Check for track rows
    const trackRows = page.locator('.track-row');
    const trackCount = await trackRows.count();

    if (trackCount < 1) {
      test.skip(true, 'No tracks available');
      return;
    }

    // Try to expand a track to 64 steps to ensure scrolling is needed
    const stepCountSelect = page.locator('.step-count-select').first();
    if (await stepCountSelect.isVisible({ timeout: 1000 }).catch(() => false)) {
      await stepCountSelect.selectOption('64');
      await waitForAnimation(page);
    }

    // Get initial positions
    const firstTrackFirstStep = page.locator('.track-row').first().locator('.step-cell').first();
    const lastTrackFirstStep = page.locator('.track-row').last().locator('.step-cell').first();

    if (!(await firstTrackFirstStep.isVisible()) || !(await lastTrackFirstStep.isVisible())) {
      test.skip(true, 'Step cells not visible');
      return;
    }

    const initialFirstBox = await firstTrackFirstStep.boundingBox();
    const initialLastBox = await lastTrackFirstStep.boundingBox();

    if (!initialFirstBox || !initialLastBox) {
      test.skip(true, 'Could not get step cell bounding boxes');
      return;
    }

    // Scroll the tracks container
    const tracksContainer = page.locator('.tracks, .sequencer-grid');
    const scrollInfo = await tracksContainer.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      canScroll: el.scrollWidth > el.clientWidth,
    }));

    if (!scrollInfo.canScroll) {
      console.log('No overflow detected, skipping scroll verification');
      return;
    }

    await tracksContainer.evaluate((el) => {
      el.scrollLeft = 200;
    });
    await waitForAnimation(page);

    // Get new positions
    const newFirstBox = await firstTrackFirstStep.boundingBox();
    const newLastBox = await lastTrackFirstStep.boundingBox();

    if (!newFirstBox || !newLastBox) {
      return;
    }

    // Both should have moved by the same amount
    const firstTrackDelta = initialFirstBox.x - newFirstBox.x;
    const lastTrackDelta = initialLastBox.x - newLastBox.x;

    // If tracks scroll together, the deltas should be equal (within tolerance)
    expect(Math.abs(firstTrackDelta - lastTrackDelta)).toBeLessThan(5);
    // And they should have actually scrolled
    expect(firstTrackDelta).toBeGreaterThan(0);
  });

  test('step columns should align vertically across all tracks', async ({ page }) => {

    const trackRows = page.locator('.track-row');
    const trackCount = await trackRows.count();

    if (trackCount < 2) {
      test.skip(true, 'Test requires at least 2 tracks');
      return;
    }

    // Wait for tracks to be fully rendered
    await expect(trackRows.first().locator('.step-cell').first()).toBeVisible();
    await expect(trackRows.nth(1).locator('.step-cell').first()).toBeVisible();

    // Get step cells from first two tracks
    const firstTrackSteps = trackRows.first().locator('.step-cell');
    const secondTrackSteps = trackRows.nth(1).locator('.step-cell');

    // Check that step 0, step 4, and step 8 are vertically aligned
    for (const stepIndex of [0, 4, 8]) {
      const firstTrackStepBox = await firstTrackSteps.nth(stepIndex).boundingBox();
      const secondTrackStepBox = await secondTrackSteps.nth(stepIndex).boundingBox();

      if (firstTrackStepBox && secondTrackStepBox) {
        // X positions should be the same (within tolerance for subpixel rendering)
        expect(Math.abs(firstTrackStepBox.x - secondTrackStepBox.x)).toBeLessThan(3);
      }
    }
  });
});
