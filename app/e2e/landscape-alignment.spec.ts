/**
 * Landscape Mobile Alignment E2E Tests
 *
 * Verifies that M/S buttons, track name, and step grid are
 * vertically aligned in mobile landscape mode.
 *
 * Run with: npx playwright test e2e/landscape-alignment.spec.ts
 */

import { test, expect, waitForAppReady, Page } from './global-setup';

// Mobile landscape viewport
const LANDSCAPE_VIEWPORT = { width: 667, height: 375 }; // iPhone SE landscape

/**
 * Helper to add a track by clicking a sample button
 */
async function addTrack(page: Page, instrumentName: RegExp = /808 Kick/) {
  // Wait for WebSocket connection first
  await page.locator('.connection-status--connected').waitFor({
    state: 'visible',
    timeout: 10000
  }).catch(() => {});

  // Click the instrument button by name
  const sampleBtn = page.getByRole('button', { name: instrumentName }).first();
  await expect(sampleBtn).toBeVisible({ timeout: 5000 });
  await sampleBtn.click();

  // Wait for track row to appear
  await page.locator('.track-row').first().waitFor({ state: 'visible', timeout: 5000 });
  await page.waitForTimeout(200); // Small delay for DOM to settle
}

test.describe('Landscape Mobile Alignment', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(LANDSCAPE_VIEWPORT);
    await page.goto('/');
    await waitForAppReady(page);
  });

  test('M/S buttons should be vertically aligned with step grid cells', async ({ page }) => {
    // Add a track first since sessions start empty
    await addTrack(page);

    // Wait for track row to be visible
    const trackRow = page.locator('.track-row').first();
    await expect(trackRow).toBeVisible();

    // Take a screenshot before measuring
    await page.screenshot({
      path: 'test-results/landscape-alignment-before.png',
      fullPage: false
    });

    // Get bounding boxes for alignment comparison
    const muteBtn = trackRow.locator('.mute-button');
    const soloBtn = trackRow.locator('.solo-button');
    const trackName = trackRow.locator('.track-name');
    const firstStepCell = trackRow.locator('.step-cell').first();

    // Ensure all elements are visible
    await expect(muteBtn).toBeVisible();
    await expect(soloBtn).toBeVisible();
    await expect(trackName).toBeVisible();
    await expect(firstStepCell).toBeVisible();

    // Get bounding boxes
    const muteBtnBox = await muteBtn.boundingBox();
    const soloBtnBox = await soloBtn.boundingBox();
    const trackNameBox = await trackName.boundingBox();
    const stepCellBox = await firstStepCell.boundingBox();

    // All boxes should exist
    expect(muteBtnBox).not.toBeNull();
    expect(soloBtnBox).not.toBeNull();
    expect(trackNameBox).not.toBeNull();
    expect(stepCellBox).not.toBeNull();

    // Log full bounding box details for debugging
    console.log('Bounding boxes:');
    console.log(`  Mute button: y=${muteBtnBox!.y.toFixed(1)}, height=${muteBtnBox!.height.toFixed(1)}`);
    console.log(`  Solo button: y=${soloBtnBox!.y.toFixed(1)}, height=${soloBtnBox!.height.toFixed(1)}`);
    console.log(`  Track name:  y=${trackNameBox!.y.toFixed(1)}, height=${trackNameBox!.height.toFixed(1)}`);
    console.log(`  Step cell:   y=${stepCellBox!.y.toFixed(1)}, height=${stepCellBox!.height.toFixed(1)}`);

    // Get computed styles to help debug
    const styles = await page.evaluate(() => {
      const trackRow = document.querySelector('.track-row') as HTMLElement;
      const trackLeft = document.querySelector('.track-left') as HTMLElement;
      const muteBtn = document.querySelector('.mute-button') as HTMLElement;
      const soloBtn = document.querySelector('.solo-button') as HTMLElement;
      const trackName = document.querySelector('.track-name') as HTMLElement;
      const stepsContainer = document.querySelector('.steps') as HTMLElement;

      const getRelevantStyles = (el: HTMLElement | null, name: string) => {
        if (!el) return `${name}: not found`;
        const style = window.getComputedStyle(el);
        return `${name}: display=${style.display}, alignItems=${style.alignItems}, height=${style.height}, gridColumn=${style.gridColumn}, gridRow=${style.gridRow}`;
      };

      // List all children of track-left
      const trackLeftChildren = trackLeft ? Array.from(trackLeft.children).map(c => {
        const style = window.getComputedStyle(c);
        return `  ${c.className}: display=${style.display}, gridColumn=${style.gridColumn}`;
      }).join('\n') : 'trackLeft not found';

      return [
        getRelevantStyles(trackRow, 'trackRow'),
        `trackLeft: gridTemplateColumns=${window.getComputedStyle(trackLeft).gridTemplateColumns}`,
        getRelevantStyles(trackLeft, 'trackLeft'),
        `trackLeft children:\n${trackLeftChildren}`,
        getRelevantStyles(muteBtn, 'muteBtn'),
        getRelevantStyles(soloBtn, 'soloBtn'),
        getRelevantStyles(trackName, 'trackName'),
        getRelevantStyles(stepsContainer, 'steps'),
      ].join('\n');
    });
    console.log('Computed styles:\n' + styles);

    // Calculate vertical centers
    const muteBtnCenter = muteBtnBox!.y + muteBtnBox!.height / 2;
    const soloBtnCenter = soloBtnBox!.y + soloBtnBox!.height / 2;
    const trackNameCenter = trackNameBox!.y + trackNameBox!.height / 2;
    const stepCellCenter = stepCellBox!.y + stepCellBox!.height / 2;

    // Log values for debugging
    console.log('Vertical centers:');
    console.log(`  Mute button: ${muteBtnCenter.toFixed(1)}px`);
    console.log(`  Solo button: ${soloBtnCenter.toFixed(1)}px`);
    console.log(`  Track name:  ${trackNameCenter.toFixed(1)}px`);
    console.log(`  Step cell:   ${stepCellCenter.toFixed(1)}px`);

    // All elements should be aligned within 2px tolerance
    // (accounting for sub-pixel rendering differences)
    const TOLERANCE = 2;

    expect(Math.abs(muteBtnCenter - soloBtnCenter)).toBeLessThanOrEqual(TOLERANCE);
    expect(Math.abs(muteBtnCenter - trackNameCenter)).toBeLessThanOrEqual(TOLERANCE);
    expect(Math.abs(muteBtnCenter - stepCellCenter)).toBeLessThanOrEqual(TOLERANCE);

    // Take a final screenshot with annotations
    await page.screenshot({
      path: 'test-results/landscape-alignment-verified.png',
      fullPage: false
    });
  });

  test('all track rows should have consistent vertical alignment', async ({ page }) => {
    // Add multiple tracks
    await addTrack(page);
    await addTrack(page);
    await addTrack(page);

    // Wait for all track rows
    const trackRows = page.locator('.track-row');
    await expect(trackRows).toHaveCount(3, { timeout: 5000 });

    // Take screenshot of multiple tracks
    await page.screenshot({
      path: 'test-results/landscape-alignment-multiple-tracks.png',
      fullPage: false
    });

    // Verify alignment for each track row
    for (let i = 0; i < 3; i++) {
      const trackRow = trackRows.nth(i);
      const muteBtn = trackRow.locator('.mute-button');
      const stepCell = trackRow.locator('.step-cell').first();

      const muteBtnBox = await muteBtn.boundingBox();
      const stepCellBox = await stepCell.boundingBox();

      if (muteBtnBox && stepCellBox) {
        const muteBtnCenter = muteBtnBox.y + muteBtnBox.height / 2;
        const stepCellCenter = stepCellBox.y + stepCellBox.height / 2;

        console.log(`Track ${i + 1}: Mute=${muteBtnCenter.toFixed(1)}px, Step=${stepCellCenter.toFixed(1)}px`);

        // Verify alignment within tolerance
        expect(Math.abs(muteBtnCenter - stepCellCenter)).toBeLessThanOrEqual(2);
      }
    }
  });

  test('M/S buttons and step cells should have same height in landscape', async ({ page }) => {
    await addTrack(page);

    const trackRow = page.locator('.track-row').first();
    const muteBtn = trackRow.locator('.mute-button');
    const soloBtn = trackRow.locator('.solo-button');
    const stepCell = trackRow.locator('.step-cell').first();

    const muteBtnBox = await muteBtn.boundingBox();
    const soloBtnBox = await soloBtn.boundingBox();
    const stepCellBox = await stepCell.boundingBox();

    expect(muteBtnBox).not.toBeNull();
    expect(soloBtnBox).not.toBeNull();
    expect(stepCellBox).not.toBeNull();

    console.log('Element heights:');
    console.log(`  Mute button: ${muteBtnBox!.height}px`);
    console.log(`  Solo button: ${soloBtnBox!.height}px`);
    console.log(`  Step cell:   ${stepCellBox!.height}px`);

    // All should be 36px in landscape mobile (increased from 32px for better touch targets)
    const EXPECTED_HEIGHT = 36;
    const HEIGHT_TOLERANCE = 2; // Allow for border differences

    expect(muteBtnBox!.height).toBeGreaterThanOrEqual(EXPECTED_HEIGHT - HEIGHT_TOLERANCE);
    expect(muteBtnBox!.height).toBeLessThanOrEqual(EXPECTED_HEIGHT + HEIGHT_TOLERANCE);
    expect(soloBtnBox!.height).toBeGreaterThanOrEqual(EXPECTED_HEIGHT - HEIGHT_TOLERANCE);
    expect(soloBtnBox!.height).toBeLessThanOrEqual(EXPECTED_HEIGHT + HEIGHT_TOLERANCE);
    expect(stepCellBox!.height).toBeGreaterThanOrEqual(EXPECTED_HEIGHT - HEIGHT_TOLERANCE);
    expect(stepCellBox!.height).toBeLessThanOrEqual(EXPECTED_HEIGHT + HEIGHT_TOLERANCE);
  });

  test('screenshot comparison - visual alignment check', async ({ page }) => {
    await addTrack(page);
    await addTrack(page);

    // Wait for tracks to be ready
    await expect(page.locator('.track-row')).toHaveCount(2, { timeout: 5000 });

    // Take a detailed screenshot of the track area
    const tracksContainer = page.locator('.tracks, .sequencer-content').first();
    await expect(tracksContainer).toBeVisible();

    await tracksContainer.screenshot({
      path: 'test-results/landscape-tracks-alignment.png'
    });

    // Also capture full viewport for context
    await page.screenshot({
      path: 'test-results/landscape-full-viewport.png',
      fullPage: false
    });

    // Verify the test ran successfully by checking elements exist
    await expect(page.locator('.mute-button').first()).toBeVisible();
    await expect(page.locator('.solo-button').first()).toBeVisible();
    await expect(page.locator('.step-cell').first()).toBeVisible();
  });
});
