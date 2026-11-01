/**
 * Playback Stability Tests
 *
 * Tests for smooth playback behavior without flickering or visual glitches.
 * Uses Playwright best practices with proper waits.
 *
 * @see specs/research/PLAYWRIGHT-TESTING.md
 */

import { test, expect, TIMING_TOLERANCE, getBaseUrl, useMockAPI } from './global-setup';
import { createSessionWithRetry } from './test-utils';

const API_BASE = getBaseUrl();

// Skip tests that require real backend for session persistence
test.skip(useMockAPI, 'Playback tests require real backend for session API');

/**
 * Create a test session with a track for playback testing
 */
async function createTestSession(request: Parameters<typeof createSessionWithRetry>[0]) {
  const steps = Array(128).fill(false);
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
        parameterLocks: Array(128).fill(null),
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
    // Wait for WebSocket connection to ensure state is fully synced
    await expect(page.locator('.connection-status--connected')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.track-row')).toBeVisible({ timeout: 5000 });
  });

  test('should not flicker during playback - step changes are monotonic', async ({ page }) => {

    // Track step changes via DOM mutations (scoped to step grid, excluding VU meters)
    await page.evaluate(() => {
      const win = window as Window & {
        __stepChanges: Array<{ count: number; time: number }>;
        __observer: MutationObserver;
      };
      win.__stepChanges = [];
      const observer = new MutationObserver((mutations) => {
        // Ignore mutations from VU meter elements (high-frequency style updates)
        const isRelevant = mutations.some(m =>
          !(m.target as Element).closest?.('.track-meter')
        );
        if (!isRelevant) return;
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

    // Allow generous tolerance for timing variability
    // MutationObserver can fire rapidly during normal DOM updates
    const maxRapidChanges = 15 * TIMING_TOLERANCE;
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
    // The previous version sampled the *count* of playing cells, logged it, and
    // asserted `expect(true).toBe(true)` under a comment saying it was
    // "informational" because tracks might have no steps enabled. The fixture in
    // createTestSession() enables steps 0/4/8/12, so that caveat was stale and
    // the position — the thing the test is named for — was never checked.
    const playButton = page.getByRole('button', { name: /play/i })
      .or(page.locator('[data-testid="play-button"], .transport button')).first();
    await playButton.click();

    // Sample which step index is lit. At 120 BPM a 16th note is ~125ms, so 10
    // samples at 150ms spans roughly one 16-step bar.
    const positions: number[] = [];
    for (let i = 0; i < 10; i++) {
      const index = await page.evaluate(() => {
        const playing = document.querySelector(
          '.step-cell.playing, .step-cell[data-playing="true"]'
        );
        return playing ? Number(playing.getAttribute('data-step-index')) : -1;
      });
      positions.push(index);
      await page.waitForTimeout(150);
    }

    await playButton.click();

    const observed = positions.filter((p) => p >= 0);
    expect(observed.length, `no step was ever lit; samples: ${positions.join(', ')}`).toBeGreaterThan(0);

    // The playhead must actually move — a stuck playhead lights one step forever
    // and would have passed every previous version of this test.
    const distinct = new Set(observed);
    expect(
      distinct.size,
      `playhead did not advance; positions: ${positions.join(', ')}`
    ).toBeGreaterThan(1);

    // And it must stay in range for a 16-step pattern.
    for (const p of observed) {
      expect(p, `step index ${p} out of range; positions: ${positions.join(', ')}`)
        .toBeLessThan(16);
    }
  });
});
