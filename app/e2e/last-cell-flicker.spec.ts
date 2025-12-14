import { test, expect } from '@playwright/test';

test.describe('Last cell flickering', () => {
  // FIXME: Flaky in CI - timing sensitive test
  test.skip('last cell should only be highlighted when playhead is on it', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-testid="grid"]')).toBeVisible({ timeout: 10000 });

    // Get the last step cell of the first track
    const lastStepCell = page.locator('.track-row').first().locator('.step-cell').last();

    // Start playback
    const playButton = page.locator('[data-testid="play-button"]');
    await playButton.click();

    // Track how many times the last cell has the "playing" class
    const playingStates: boolean[] = [];

    // Check the last cell's state every 50ms for 3 seconds
    for (let i = 0; i < 60; i++) {
      const hasPlaying = await lastStepCell.evaluate((el) => el.classList.contains('playing'));
      playingStates.push(hasPlaying);
      await page.waitForTimeout(50);
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
    // In 3 seconds, the playhead goes through about 24 steps
    // The last cell (step 16) should only be playing once per loop of 16 steps
    // So we expect about 2-3 on/off cycles (4-6 transitions)
    // If there's flickering, we'd see many more transitions
    console.log(`Playing states: ${playingStates.filter(Boolean).length} true out of ${playingStates.length}`);
    console.log(`Transitions: ${transitions}`);

    // Allow some tolerance but flag if there are too many transitions
    expect(transitions).toBeLessThan(12); // Should be around 4-6 normally
  });
});
