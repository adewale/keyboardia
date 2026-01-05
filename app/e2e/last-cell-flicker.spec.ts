import { test, expect } from '@playwright/test';
import { API_BASE, createSessionWithRetry } from './test-utils';

/**
 * Last cell flickering test
 *
 * SKIP IN CI: This test requires real backend infrastructure and has timing-sensitive
 * audio playback checks that aren't reliable in CI. Run locally with
 * `npx playwright test e2e/last-cell-flicker.spec.ts`
 */

// Skip in CI - requires real backend infrastructure
test.skip(!!process.env.CI, 'Skipped in CI - requires real backend');

/**
 * Create a test session with a track for flicker testing
 */
async function createTestSession(request: Parameters<typeof createSessionWithRetry>[0]) {
  const steps = Array(64).fill(false);
  steps[0] = true;
  steps[4] = true;
  steps[8] = true;
  steps[15] = true; // Last step in 16-step sequence

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
        stepCount: 16,
      },
    ],
    tempo: 120,
    swing: 0,
    version: 1,
  });
}

test.describe('Last cell flickering', () => {
  test.beforeEach(async ({ page, request }) => {
    const { id } = await createTestSession(request);
    await page.goto(`${API_BASE}/s/${id}`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[data-testid="grid"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.track-row')).toBeVisible({ timeout: 5000 });
  });

  test('last cell should only be highlighted when playhead is on it', async ({ page }) => {
    // Get the last step cell of the first track
    const lastStepCell = page.locator('.track-row').first().locator('.step-cell').last();

    // Start playback
    const playButton = page.locator('[data-testid="play-button"]');
    await playButton.click();

    // Wait for playback to stabilize
    await page.waitForTimeout(200);

    // Track how many times the last cell has the "playing" class
    const playingStates: boolean[] = [];

    // Check the last cell's state every 100ms for 4 seconds (more forgiving timing)
    // Using 100ms interval to reduce timing sensitivity in CI
    for (let i = 0; i < 40; i++) {
      const hasPlaying = await lastStepCell.evaluate((el) => el.classList.contains('playing'));
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
    // The last cell (step 16) should only be playing twice
    // So we expect about 4 on/off cycles (8 transitions max)
    // Allow extra tolerance for CI timing variance
    console.log(`Playing states: ${playingStates.filter(Boolean).length} true out of ${playingStates.length}`);
    console.log(`Transitions: ${transitions}`);

    // Allow generous tolerance for CI - flag only if clearly excessive
    // Normal: ~8 transitions, Flicker bug: 20+ transitions
    expect(transitions).toBeLessThan(16);
  });
});
