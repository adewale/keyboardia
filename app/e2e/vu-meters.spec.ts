/**
 * VU Meter E2E Tests
 *
 * Verifies that VU meters in the Mixer panel display correctly and
 * animate during playback. Uses Vite mock API (USE_MOCK_API=1) for
 * self-contained session creation — no wrangler backend needed.
 */

import { test as base, expect, type Page } from '@playwright/test';

const test = base;

/**
 * Navigate to the app, create a session, and add tracks with active steps.
 */
async function setupSessionWithTracks(page: Page) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  // Click Start Session on the landing page
  const startButton = page.locator(
    '.landing-btn.primary, button:has-text("Start Session"), button:has-text("Start"), button:has-text("Create")'
  ).first();
  const isLanding = await startButton.isVisible({ timeout: 3000 }).catch(() => false);

  if (isLanding) {
    await startButton.click();
    await page.waitForURL(/\/s\//, { timeout: 15000 });
  }

  // Wait for app to be ready
  await page.locator('.sample-picker, .track-row, .app').first().waitFor({
    state: 'visible',
    timeout: 15000,
  });

  // Wait for WebSocket connection (best-effort)
  await page.locator('.connection-status--connected').waitFor({
    state: 'visible',
    timeout: 10000,
  }).catch(() => { /* mock mode may not have WS */ });

  // Add first track via sample picker
  const kickBtn = page.locator('button:has-text("808 Kick"), button:has-text("Kick")').first();
  if (await kickBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await kickBtn.click();
    await page.locator('.track-row').first().waitFor({ state: 'visible', timeout: 5000 });
  }

  // Add second track
  const snareBtn = page.locator('button:has-text("808 Snare"), button:has-text("Snare")').first();
  if (await snareBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await snareBtn.click();
    await expect(page.locator('.track-row')).toHaveCount(2, { timeout: 5000 });
  }

  // Toggle steps on (four-on-the-floor pattern)
  const trackRows = page.locator('.track-row');
  const trackCount = await trackRows.count();

  for (let t = 0; t < Math.min(trackCount, 2); t++) {
    const cells = trackRows.nth(t).locator('.step-cell');
    const cellCount = await cells.count();
    for (const step of [0, 4, 8, 12]) {
      if (step < cellCount) {
        await cells.nth(step).click();
      }
    }
  }
}

test.describe('VU Meters', () => {
  test('mixer panel shows VU meters for each track', async ({ page }) => {
    await setupSessionWithTracks(page);

    // Open the mixer panel
    const mixerBtn = page.locator('.mixer-btn, button:has-text("Mixer")').first();
    await expect(mixerBtn).toBeVisible({ timeout: 5000 });
    await mixerBtn.click();

    // Wait for mixer panel to expand
    await expect(page.locator('.mixer-panel-container.expanded')).toBeVisible({ timeout: 5000 });

    // Should have one TrackMeter per track (2 tracks)
    // When not playing, meters render as .track-meter--inactive (no bar/peak children)
    const meters = page.locator('.track-meter');
    const meterCount = await meters.count();
    expect(meterCount).toBeGreaterThanOrEqual(2);

    // All meters should be visible
    for (const meter of await meters.all()) {
      await expect(meter).toBeVisible();
    }
  });

  test('VU meter bars animate during playback', async ({ page }) => {
    await setupSessionWithTracks(page);

    // Open the mixer panel
    await page.locator('.mixer-btn, button:has-text("Mixer")').first().click();
    await expect(page.locator('.mixer-panel-container.expanded')).toBeVisible({ timeout: 5000 });

    // Start playback
    const playButton = page.getByRole('button', { name: /play/i })
      .or(page.locator('.transport-play-btn, [data-testid="play-button"]')).first();
    await playButton.click();

    // Sample meter bar heights over ~2.5 seconds of playback.
    // At 120 BPM, one 16-step loop takes 2 seconds.
    const meterBarHeights: number[] = [];

    for (let i = 0; i < 16; i++) {
      const bars = page.locator('.track-meter__bar');
      const count = await bars.count();

      for (let b = 0; b < count; b++) {
        const style = await bars.nth(b).getAttribute('style');
        const match = style?.match(/height:\s*([\d.]+)%/);
        if (match) {
          meterBarHeights.push(parseFloat(match[1]));
        }
      }
      await page.waitForTimeout(160);
    }

    // Stop playback
    await playButton.click();

    console.log(`Meter height samples (${meterBarHeights.length} total): ${meterBarHeights.map(h => h.toFixed(0)).join(', ')}`);

    // Verify that meters had non-zero readings during playback
    const nonZero = meterBarHeights.filter(h => h > 0);
    expect(
      nonZero.length,
      `Meters should have non-zero readings during playback (got ${nonZero.length}/${meterBarHeights.length})`
    ).toBeGreaterThan(0);

    // Verify varying heights (not stuck at one value)
    const unique = new Set(meterBarHeights.map(h => Math.round(h)));
    expect(
      unique.size,
      `Meters should show varying levels (got ${unique.size} unique values)`
    ).toBeGreaterThan(1);
  });

  test('VU meters are inactive when not playing', async ({ page }) => {
    await setupSessionWithTracks(page);

    // Open mixer without starting playback
    await page.locator('.mixer-btn, button:has-text("Mixer")').first().click();
    await expect(page.locator('.mixer-panel-container.expanded')).toBeVisible({ timeout: 5000 });

    // Give a moment for meters to settle
    await page.waitForTimeout(500);

    // When not playing, meters should be in inactive state (no audio data)
    // The TrackMeter component renders .track-meter--inactive when level is null
    const inactiveMeters = page.locator('.track-meter--inactive');
    const inactiveCount = await inactiveMeters.count();
    expect(inactiveCount, 'All meters should be inactive when not playing').toBeGreaterThanOrEqual(1);

    // There should be no active bar elements when silent
    const bars = page.locator('.track-meter__bar');
    const barCount = await bars.count();
    expect(barCount, 'No meter bars should exist when not playing').toBe(0);
  });
});
