/**
 * Last Cell Flickering Test
 *
 * Tests that the last step cell doesn't flicker during playback.
 * Uses increased timing tolerances for CI reliability.
 *
 * @see specs/research/PLAYWRIGHT-TESTING.md
 */

import { test, expect, TIMING_TOLERANCE, waitWithTolerance } from './global-setup';

test.describe('Last cell flickering', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.track-row, .sample-picker', { timeout: 15000 });
  });

  test('last cell should only be highlighted when playhead is on it', async ({ page }) => {
    // Wait for audio context to be ready
    await waitWithTolerance(page, 500);

    // Check if we have tracks
    const trackRows = page.locator('.track-row');
    const trackCount = await trackRows.count();

    if (trackCount < 1) {
      test.skip(true, 'No tracks available');
      return;
    }

    // Get the last step cell of the first track
    const lastStepCell = trackRows.first().locator('.step-cell').last();

    if (!(await lastStepCell.isVisible())) {
      test.skip(true, 'Last step cell not visible');
      return;
    }

    // Start playback
    const playButton = page.locator('[data-testid="play-button"], .transport button').first();
    await playButton.click();

    // Wait for playback to stabilize
    await waitWithTolerance(page, 200);

    // Track how many times the last cell has the "playing" class
    const playingStates: boolean[] = [];

    // Check the last cell's state every 100ms for 4 seconds
    for (let i = 0; i < 40; i++) {
      const hasPlaying = await lastStepCell.evaluate((el) =>
        el.classList.contains('playing') || el.getAttribute('data-playing') === 'true'
      );
      playingStates.push(hasPlaying);
      await page.waitForTimeout(100);
    }

    // Stop playback
    await playButton.click();

    // Count transitions (true->false or false->true)
    let transitions = 0;
    for (let i = 1; i < playingStates.length; i++) {
      if (playingStates[i] !== playingStates[i - 1]) {
        transitions++;
      }
    }

    // At 120 BPM, 16th notes are 125ms apart
    // In 4 seconds, the playhead goes through about 32 steps (2 full loops)
    // The last cell should only be playing a few times
    // Allow extra tolerance for CI timing variance
    console.log(`Playing states: ${playingStates.filter(Boolean).length} true out of ${playingStates.length}`);
    console.log(`Transitions: ${transitions}`);

    // Allow generous tolerance - flag only if clearly excessive
    // Normal: ~8 transitions, Flicker bug: 20+ transitions
    const maxTransitions = 16 * TIMING_TOLERANCE;
    expect(transitions).toBeLessThan(maxTransitions);
  });
});
