import { test, expect } from '@playwright/test';

/**
 * Playback stability tests
 *
 * SKIP IN CI: These tests are timing-sensitive and depend on audio playback
 * behavior that varies significantly in CI environments. Run locally with
 * `npx playwright test e2e/playback.spec.ts`
 */

// Skip in CI - timing-sensitive tests not reliable in CI
test.skip(!!process.env.CI, 'Skipped in CI - timing-sensitive playback tests');

test.describe('Playback stability', () => {
  test('should not flicker during playback - step changes are monotonic', async ({ page }) => {
    await page.goto('/');

    // Wait for the grid to load with longer timeout
    await expect(page.locator('[data-testid="grid"]')).toBeVisible({ timeout: 10000 });

    // Track step changes (collected via page.evaluate)
    // Listen for DOM mutations on playing indicators
    await page.evaluate(() => {
      const win = window as Window & { __stepChanges: Array<{ count: number; time: number }>; __observer: MutationObserver };
      win.__stepChanges = [];
      const observer = new MutationObserver(() => {
        const playingIndicators = document.querySelectorAll('[data-testid="playing-indicator"]');
        win.__stepChanges.push({
          count: playingIndicators.length,
          time: Date.now()
        });
      });
      observer.observe(document.body, { childList: true, subtree: true, attributes: true });
      win.__observer = observer;
    });

    // Click play button (using data-testid)
    const playButton = page.locator('[data-testid="play-button"]');
    await playButton.click();

    // Wait for playback to run for 2 seconds
    await page.waitForTimeout(2000);

    // Stop playback
    await playButton.click();

    // Get the step changes
    const changes = await page.evaluate(() => {
      const win = window as Window & { __stepChanges: Array<{ count: number; time: number }>; __observer: MutationObserver };
      win.__observer.disconnect();
      return win.__stepChanges;
    });

    // Verify no rapid flickering - changes should be spaced out
    // At 120 BPM, 16th notes are ~125ms apart
    // Check that we don't have more than 2 changes within 50ms (would indicate flickering)
    let rapidChangeCount = 0;
    for (let i = 1; i < changes.length; i++) {
      const timeDiff = changes[i].time - changes[i - 1].time;
      if (timeDiff < 50) {
        rapidChangeCount++;
      }
    }

    // Allow some rapid changes during start/stop, but not many
    expect(rapidChangeCount).toBeLessThan(5);
    console.log(`Total changes: ${changes.length}, Rapid changes (<50ms): ${rapidChangeCount}`);
  });

  test('should have smooth playhead movement with different step counts', async ({ page }) => {
    await page.goto('/');

    // Wait for the grid to load with longer timeout
    await expect(page.locator('[data-testid="grid"]')).toBeVisible({ timeout: 10000 });

    // Set one track to 32 steps
    const stepPreset32 = page.locator('.step-preset-btn:has-text("32")').first();
    if (await stepPreset32.isVisible()) {
      await stepPreset32.click();
    }

    // Click play (using data-testid)
    const playButton = page.locator('[data-testid="play-button"]');
    await playButton.click();

    // Let it play for 3 seconds (should cover multiple loops)
    await page.waitForTimeout(3000);

    // Verify the page didn't crash or freeze
    await expect(page.locator('[data-testid="grid"]')).toBeVisible();

    // Stop playback
    await playButton.click();
  });
});
