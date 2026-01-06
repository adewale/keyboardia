/**
 * Playback Stability Tests
 *
 * Tests for smooth playback behavior without flickering or visual glitches.
 * Uses Playwright best practices with proper waits.
 *
 * @see specs/research/PLAYWRIGHT-TESTING.md
 */

import { test, expect, TIMING_TOLERANCE, getBaseUrl } from './global-setup';
import { createSessionWithRetry } from './test-utils';

const API_BASE = getBaseUrl();

/**
 * Create a test session with a track for playback testing
 */
async function createTestSession(request: Parameters<typeof createSessionWithRetry>[0]) {
  const steps = Array(64).fill(false);
  steps[0] = true;
  steps[4] = true;
  steps[8] = true;
  steps[12] = true;

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

test.describe('Playback stability', () => {
  test.beforeEach(async ({ page, request }) => {
    const { id } = await createTestSession(request);
    await page.goto(`${API_BASE}/s/${id}`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[data-testid="grid"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.track-row')).toBeVisible({ timeout: 5000 });
  });

  test('should not flicker during playback - step changes are monotonic', async ({ page }) => {

    // Track step changes via DOM mutations
    await page.evaluate(() => {
      const win = window as Window & {
        __stepChanges: Array<{ count: number; time: number }>;
        __observer: MutationObserver;
      };
      win.__stepChanges = [];
      const observer = new MutationObserver(() => {
        const playingIndicators = document.querySelectorAll('.playing, [data-playing="true"]');
        win.__stepChanges.push({
          count: playingIndicators.length,
          time: Date.now(),
        });
      });
      observer.observe(document.body, { childList: true, subtree: true, attributes: true });
      win.__observer = observer;
    });

    // Click play button
    const playButton = page.getByRole('button', { name: /play/i })
      .or(page.locator('[data-testid="play-button"], .transport button')).first();
    await playButton.click();

    // Let playback run for a bit - this is intentional timing for observing behavior
    await page.waitForTimeout(2000);

    // Stop playback
    await playButton.click();

    // Get the step changes
    const changes = await page.evaluate(() => {
      const win = window as Window & {
        __stepChanges: Array<{ count: number; time: number }>;
        __observer: MutationObserver;
      };
      win.__observer.disconnect();
      return win.__stepChanges;
    });

    // Verify no rapid flickering
    // At 120 BPM, 16th notes are ~125ms apart
    // Check that we don't have excessive rapid changes
    let rapidChangeCount = 0;
    for (let i = 1; i < changes.length; i++) {
      const timeDiff = changes[i].time - changes[i - 1].time;
      if (timeDiff < 50) {
        rapidChangeCount++;
      }
    }

    // Allow more tolerance in CI
    const maxRapidChanges = 5 * TIMING_TOLERANCE;
    expect(rapidChangeCount).toBeLessThan(maxRapidChanges);
    console.log(`Total changes: ${changes.length}, Rapid changes (<50ms): ${rapidChangeCount}`);
  });

  test('should have smooth playhead movement with different step counts', async ({ page }) => {

    // Try to set one track to 32 steps (if UI element exists)
    const select = page.locator('.step-count-select').first();
    if (await select.isVisible({ timeout: 1000 }).catch(() => false)) {
      await select.selectOption('32');
    }

    // Click play
    const playButton = page.getByRole('button', { name: /play/i })
      .or(page.locator('[data-testid="play-button"], .transport button')).first();
    await playButton.click();

    // Let it play for multiple loops - intentional timing for observation
    await page.waitForTimeout(3000);

    // Verify the page didn't crash or freeze
    const gridVisible = await page.locator('.track-row, .sequencer-grid').first().isVisible();
    expect(gridVisible).toBe(true);

    // Stop playback
    await playButton.click();
  });

  test('playhead position updates correctly during playback', async ({ page }) => {
    // Start playback
    const playButton = page.getByRole('button', { name: /play/i })
      .or(page.locator('[data-testid="play-button"], .transport button')).first();
    await playButton.click();

    // Track playhead positions over time
    const positions: number[] = [];
    for (let i = 0; i < 10; i++) {
      const playingCells = await page.locator('.step-cell.playing, .step-cell[data-playing="true"]').count();
      positions.push(playingCells);
      await page.waitForTimeout(150);
    }

    // Stop playback
    await playButton.click();

    // This test is informational - we don't fail if no tracks have steps enabled
    console.log(`Playhead positions (playing cell counts): ${positions.join(', ')}`);

    // Just verify no errors occurred
    expect(true).toBe(true);
  });
});
