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

import {
  test,
  expect,
  waitForAnimation,
  waitForCollaborationReady,
  getBaseUrl,
} from './global-setup';
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
  const steps = Array(128).fill(false);
  steps[0] = true;
  steps[4] = true;

  return createSessionWithRetry(request, {
    tracks: [
      {
        id: 'test-track-1',
        name: 'Kick',
        sampleId: 'kick',
        steps,
        parameterLocks: Array(128).fill(null),
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
        parameterLocks: Array(128).fill(null),
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
    await waitForCollaborationReady(page);
    await expect(page.locator('.track-row').first()).toBeVisible({ timeout: 5000 });
  });

  test('should have a single scrollbar for the entire tracks panel, not per track', async ({ page }, testInfo) => {
    // Skip on mobile - touch scrolling reports overflow differently than desktop scrollbars
    test.skip(isMobileProject(testInfo.project.name), 'Desktop-only - CSS overflow behaves differently with touch scrolling');

    // beforeEach already asserted the grid and a track row are visible, so a
    // missing tracks container is a regression rather than a reason to skip.
    const tracksContainer = page.locator('.tracks, .sequencer-grid');
    await expect(tracksContainer.first()).toBeVisible({ timeout: 5000 });

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
    // createTestSession() seeds two tracks, so an empty grid means loading
    // broke — fail rather than skip.
    const trackRows = page.locator('.track-row');
    await expect(trackRows).not.toHaveCount(0);

    // Try to expand a track to 64 steps to ensure scrolling is needed
    const stepCountSelect = page.locator('.step-count-select').first();
    if (await stepCountSelect.isVisible({ timeout: 1000 }).catch(() => false)) {
      await stepCountSelect.selectOption('64');
      await waitForAnimation(page);
    }

    // Get initial positions
    const firstTrackFirstStep = page.locator('.track-row').first().locator('.step-cell').first();
    const lastTrackFirstStep = page.locator('.track-row').last().locator('.step-cell').first();

    await expect(firstTrackFirstStep).toBeVisible();
    await expect(lastTrackFirstStep).toBeVisible();

    const initialFirstBox = await firstTrackFirstStep.boundingBox();
    const initialLastBox = await lastTrackFirstStep.boundingBox();

    expect(initialFirstBox, 'first step cell has no bounding box').not.toBeNull();
    expect(initialLastBox, 'last step cell has no bounding box').not.toBeNull();

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

  test('pattern tools panel should stay visible when scrolling horizontally', async ({ page, request }, testInfo) => {
    // Skip on mobile - pattern tools panel is hidden on mobile
    test.skip(isMobileProject(testInfo.project.name), 'Desktop-only - pattern tools panel hidden on mobile');

    // Create a session with 64 steps to ensure horizontal scrolling is needed
    const { id } = await createTestSession(request, 64);
    await page.goto(`${API_BASE}/s/${id}`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[data-testid="grid"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.track-row').first()).toBeVisible({ timeout: 5000 });

    // Use a viewport that causes overflow
    await page.setViewportSize({ width: 1024, height: 768 });
    await waitForAnimation(page);

    // Open pattern tools panel
    const patternToolsToggle = page.locator('.pattern-tools-toggle').first();
    await expect(patternToolsToggle).toBeVisible({ timeout: 5000 });

    await patternToolsToggle.click();
    await waitForAnimation(page);

    const patternToolsPanel = page.locator('.pattern-tools-panel').first();
    await expect(patternToolsPanel, 'toggle should open the pattern tools panel')
      .toBeVisible({ timeout: 5000 });

    // Get initial position of the pattern tools panel
    const initialBox = await patternToolsPanel.boundingBox();
    expect(initialBox, 'pattern tools panel has no bounding box').not.toBeNull();

    // Verify the panel is initially visible (left edge >= 0)
    expect(initialBox.x).toBeGreaterThanOrEqual(0);

    // Scroll horizontally by a significant amount
    const tracksContainer = page.locator('.tracks, .sequencer-grid');
    const scrollInfo = await tracksContainer.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      canScroll: el.scrollWidth > el.clientWidth,
    }));

    // The 1024px viewport set above is narrower than the seeded 16-step grid,
    // so overflow is the expected state. No overflow means the layout changed
    // and this test's premise is broken — surface that instead of skipping.
    expect(
      scrollInfo.canScroll,
      `expected horizontal overflow at 1024px: ${JSON.stringify(scrollInfo)}`
    ).toBe(true);

    // Scroll right by 400px
    await tracksContainer.evaluate((el) => {
      el.scrollLeft = 400;
    });
    await waitForAnimation(page);

    // Verify the scroll actually happened
    const scrollLeft = await tracksContainer.evaluate((el) => el.scrollLeft);
    expect(scrollLeft).toBeGreaterThan(0);

    // Get new position of pattern tools panel
    const newBox = await patternToolsPanel.boundingBox();
    if (!newBox) {
      // Panel disappeared after scroll - this is a bug
      expect(newBox).not.toBeNull();
      return;
    }

    // The pattern tools panel should still be visible (left edge >= 0)
    // If sticky is working, the panel stays at left edge
    // If not, the panel scrolls off-screen (negative x)
    expect(newBox.x).toBeGreaterThanOrEqual(0);

    // Additionally, the panel should be within the viewport
    expect(newBox.x).toBeLessThan(1024); // viewport width
  });

  test('step columns should align vertically across all tracks', async ({ page }) => {

    // createTestSession() seeds two tracks; fewer means the fixture or session
    // loading regressed.
    const trackRows = page.locator('.track-row');
    await expect(trackRows.nth(1)).toBeVisible();

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
