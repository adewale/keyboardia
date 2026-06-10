/**
 * Ground-truth E2E for per-track tone/advanced metering.
 *
 * Verifies the promise the in-engine refactor is supposed to deliver:
 * when two tracks each use a different `advanced:*` preset and both
 * play simultaneously, each track's VU meter animates independently.
 *
 * Before the refactor: a shared advanced-synth output was rerouted per
 * note, so only the most-recently-played track's meter would move. The
 * quick fix stopped the reroute and set both meters to zero (correct
 * audio, no per-track visibility). The per-track-synth refactor now
 * wires each track to its own AdvancedSynthEngine instance statically
 * connected to that track's bus, so both meters must animate and show
 * distinguishable signals.
 */

import { test, expect, type Page } from '@playwright/test';

async function setupTwoAdvancedTracks(page: Page) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  // Landing-page start (mock API creates the session).
  const startButton = page.locator(
    '.landing-btn.primary, button:has-text("Start Session"), button:has-text("Start")'
  ).first();
  if (await startButton.isVisible({ timeout: 3000 }).catch(() => false)) {
    await startButton.click();
    await page.waitForURL(/\/s\//, { timeout: 15000 });
  }

  await page.locator('.sample-picker, .track-row').first().waitFor({
    state: 'visible', timeout: 15000,
  });
  await page.locator('.connection-status--connected').waitFor({
    state: 'visible', timeout: 10000,
  }).catch(() => {});

  // Add Track 1 — Fat Saw (advanced:supersaw).
  const supersawBtn = page.locator('button:has-text("Fat Saw")').first();
  await expect(supersawBtn).toBeVisible({ timeout: 5000 });
  await supersawBtn.click();
  await page.locator('.track-row').first().waitFor({ state: 'visible', timeout: 5000 });

  // Add Track 2 — Wobble Bass (advanced:wobble-bass).
  const wobbleBtn = page.locator('button:has-text("Wobble Bass")').first();
  await expect(wobbleBtn).toBeVisible({ timeout: 5000 });
  await wobbleBtn.click();
  await expect(page.locator('.track-row')).toHaveCount(2, { timeout: 5000 });

  // Activate steps — Track 1 on beats 1/5/9/13, Track 2 offset on 3/7/11/15.
  // Distinct step patterns give the two tracks uncorrelated envelopes so
  // the meter-level series are statistically different.
  const trackRows = page.locator('.track-row');
  const track1Cells = trackRows.nth(0).locator('.step-cell');
  const track2Cells = trackRows.nth(1).locator('.step-cell');
  for (const s of [0, 4, 8, 12]) await track1Cells.nth(s).click();
  for (const s of [2, 6, 10, 14]) await track2Cells.nth(s).click();
}

/**
 * Sample both tracks' meter bars over a playback window. Returns one
 * height-series per track (arrays are the same length; index 0 is
 * Track 1, index 1 is Track 2).
 */
async function sampleTrackMeters(page: Page, sampleCount: number, intervalMs: number): Promise<number[][]> {
  const series: number[][] = [[], []];
  const meters = page.locator('.mixer-panel-container .track-meter');
  for (let i = 0; i < sampleCount; i++) {
    for (let t = 0; t < 2; t++) {
      const bar = meters.nth(t).locator('.track-meter__bar');
      const style = await bar.getAttribute('style').catch(() => null);
      const match = style?.match(/height:\s*([\d.]+)%/);
      series[t].push(match ? parseFloat(match[1]) : 0);
    }
    await page.waitForTimeout(intervalMs);
  }
  return series;
}

function pearsonCorrelation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  const meanA = a.reduce((s, x) => s + x, 0) / n;
  const meanB = b.reduce((s, x) => s + x, 0) / n;
  let num = 0, dA = 0, dB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    dA += da * da;
    dB += db * db;
  }
  const denom = Math.sqrt(dA * dB);
  return denom === 0 ? 0 : num / denom;
}

test.describe('Per-track advanced-synth metering', () => {
  // Sampling + setup takes longer than the default 30s test timeout.
  test.setTimeout(60000);

  test('two advanced tracks produce independent, animating VU meters', async ({ page }) => {
    await setupTwoAdvancedTracks(page);

    // Open the mixer panel.
    await page.locator('.mixer-btn, button:has-text("Mixer")').first().click();
    await expect(page.locator('.mixer-panel-container.expanded')).toBeVisible({ timeout: 5000 });

    // Start playback.
    const playButton = page.getByRole('button', { name: /play/i })
      .or(page.locator('.transport-play-btn, [data-testid="play-button"]')).first();
    await playButton.click();

    // Sample meters for ~2s — long enough to cover one full 16-step loop
    // at 120 BPM while keeping the test under Playwright's total budget.
    const [track1Series, track2Series] = await sampleTrackMeters(page, 20, 100);
    await playButton.click();

    // Log for debugging flakes.
    console.log(`Track 1 heights (${track1Series.length}): ${track1Series.map(h => h.toFixed(0)).join(', ')}`);
    console.log(`Track 2 heights (${track2Series.length}): ${track2Series.map(h => h.toFixed(0)).join(', ')}`);

    // --- Assertions ---

    // 1. Both tracks must show some activity. Historically Track 2's meter
    //    was empty because its audio was hijacked to Track 1's bus.
    const track1Active = track1Series.filter(h => h > 0).length;
    const track2Active = track2Series.filter(h => h > 0).length;
    expect(track1Active, 'Track 1 meter should animate during playback').toBeGreaterThan(0);
    expect(track2Active, 'Track 2 meter should animate during playback').toBeGreaterThan(0);

    // 2. The two series must differ — they come from different step
    //    patterns on different synths, so an identical animation would
    //    mean they are really fed by the same source.
    const track1Unique = new Set(track1Series.map(h => Math.round(h)));
    const track2Unique = new Set(track2Series.map(h => Math.round(h)));
    expect(track1Unique.size, 'Track 1 should have varying levels').toBeGreaterThan(1);
    expect(track2Unique.size, 'Track 2 should have varying levels').toBeGreaterThan(1);

    // 3. The two series are uncorrelated enough to prove they come from
    //    different signal sources. Perfect correlation (+1 or -1) would
    //    indicate a single-source signal split across two meters.
    const r = pearsonCorrelation(track1Series, track2Series);
    console.log(`Pearson correlation between tracks: ${r.toFixed(3)}`);
    expect(
      Math.abs(r),
      'Per-track meters should not be perfectly correlated — they should reflect independent synths',
    ).toBeLessThan(0.9);
  });
});
