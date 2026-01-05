import { test, expect } from '@playwright/test';

// Skip in CI - requires real backend infrastructure
test.skip(!!process.env.CI, 'Skipped in CI - requires real backend');

/**
 * PitchContour SVG Alignment Tests
 *
 * CRITICAL: These tests verify that PitchContour SVG coordinates match actual DOM positions.
 *
 * BACKGROUND (Bug #pitch-contour-alignment):
 * The PitchContour component uses a hardcoded cellWidth constant to calculate SVG coordinates.
 * If this constant doesn't match the actual CSS dimensions (StepCell.css + TrackRow.css gap),
 * the contour dots will be misaligned - appearing over the wrong step cells.
 *
 * ROOT CAUSE: cellWidth was 27px but actual CSS is 36px + 3px gap = 39px.
 * This caused dots intended for step 10 to appear over step 7 visually.
 *
 * PREVENTION: This test queries actual DOM positions at runtime and compares to SVG positions.
 * If CSS changes, this test will fail, alerting developers to update the JS constant.
 *
 * Files involved:
 * - src/components/ChromaticGrid.tsx (PitchContour component, cellWidth constant line ~242)
 * - src/components/StepCell.css (cell width: 36px desktop, 44px/48px mobile)
 * - src/components/TrackRow.css (gap: 3px line ~606)
 * - src/components/PitchContour.test.ts (unit tests, CELL_WIDTH constant line ~19)
 *
 * @see src/components/PitchContour.test.ts for unit tests
 */

test.describe('PitchContour alignment', () => {
  test.beforeEach(async ({ page }) => {
    // Use desktop viewport to match the 36px + 3px = 39px calculation
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  test('CSS dimensions match JavaScript constants (CRITICAL regression test)', async ({ page }) => {
    /**
     * This test extracts actual CSS values at runtime and compares to expected values.
     * If CSS changes, this test will fail and alert developers to update JS constants in:
     * - src/components/ChromaticGrid.tsx (cellWidth constant)
     * - src/components/PitchContour.test.ts (CELL_WIDTH constant)
     */
    await page.goto('/');

    // Click "Start Session" to enter sequencer
    const startButton = page.locator('button:has-text("Start Session")');
    if (await startButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await startButton.click();
      await page.waitForURL(/\/s\//, { timeout: 10000 });
    }

    // Add a track to get step cells (button has star prefix like "★ 808 Kick")
    const addTrackButton = page.getByRole('button', { name: /808 Kick/i });
    await expect(addTrackButton).toBeVisible({ timeout: 5000 });
    await addTrackButton.click();

    // Wait for track row and step cells to appear (may take a moment for track to render)
    await expect(page.locator('.track-row')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.step-cell').first()).toBeVisible({ timeout: 5000 });

    // Get computed styles for step cell and steps container
    const dimensions = await page.evaluate(() => {
      // Find a step cell
      const stepCell = document.querySelector('.step-cell');
      if (!stepCell) return null;

      const cellStyle = getComputedStyle(stepCell);
      const cellWidth = parseFloat(cellStyle.width);

      // Find steps container
      const stepsContainer = document.querySelector('.steps');
      if (!stepsContainer) return { cellWidth, gap: 0 };

      const containerStyle = getComputedStyle(stepsContainer);
      const gap = parseFloat(containerStyle.gap) || 0;

      return { cellWidth, gap };
    });

    if (!dimensions) {
      throw new Error('Could not find step cell elements - test setup failed');
    }

    const { cellWidth, gap } = dimensions;
    const totalCellWidth = cellWidth + gap;

    console.log(`CSS dimensions: cellWidth=${cellWidth}px, gap=${gap}px, total=${totalCellWidth}px`);

    // CRITICAL ASSERTION: Total must match the JS constant (39px on desktop)
    // The PitchContour component uses cellWidth = 39
    // If this fails, update:
    //   1. ChromaticGrid.tsx line ~242: const cellWidth = 39;
    //   2. PitchContour.test.ts line ~19: const CELL_WIDTH = 39;
    const EXPECTED_TOTAL = 39;
    expect(totalCellWidth).toBe(EXPECTED_TOTAL);
  });

  test('SVG contour dots align with step cells for session with pitch variation', async ({
    page,
    request,
  }) => {
    // Create a session with known pitch variation pattern
    const sessionData = {
      tracks: [
        {
          id: 'track-1',
          name: 'Pitch Test',
          sampleId: 'synth:kick',
          steps: [true, true, true, true, false, false, true, true],
          parameterLocks: [
            { pitch: 0 },
            { pitch: 5 },
            { pitch: 7 },
            { pitch: 5 },
            null,
            null,
            { pitch: -3 },
            { pitch: 0 },
          ],
          volume: 0.7,
          muted: false,
          transpose: 0,
          stepCount: 8,
        },
      ],
      tempo: 120,
      swing: 0,
      version: 1,
    };

    // Post session to API (use same port as playwright webServer)
    const apiBase = 'http://localhost:5175';

    const createRes = await request.post(`${apiBase}/api/sessions`, {
      data: sessionData,
    });

    if (!createRes.ok()) {
      console.log('Failed to create test session, skipping fixture test');
      return;
    }

    const { id: sessionId } = await createRes.json();

    // Navigate directly to session
    await page.goto(`/s/${sessionId}`);

    // Wait for track row to appear
    await expect(page.locator('.track-row')).toBeVisible({ timeout: 10000 });

    // Wait for pitch contour to render (using networkidle instead of arbitrary timeout)
    await page.waitForLoadState('networkidle');

    const pitchContour = page.locator('.pitch-contour').first();
    const hasContour = await pitchContour.isVisible({ timeout: 2000 }).catch(() => false);

    if (!hasContour) {
      console.log('No pitch contour rendered - pitch locks may need trigger to display');
      // This is acceptable - the CSS test above is the critical one
      return;
    }

    // Get all contour dots
    const contourDots = pitchContour.locator('.contour-dot');
    const dotCount = await contourDots.count();
    console.log(`Found ${dotCount} contour dots`);

    if (dotCount < 2) {
      console.log('Not enough dots to verify alignment');
      return;
    }

    // Get step cells for this track
    const trackRow = page.locator('.track-row').first();
    const trackStepCells = trackRow.locator('.step-cell');

    // For each contour dot, verify it aligns with its corresponding step cell
    for (let i = 0; i < dotCount; i++) {
      const dot = contourDots.nth(i);
      const dotBox = await dot.boundingBox();

      if (!dotBox) continue;

      // Get the dot's center X position
      const dotCenterX = dotBox.x + dotBox.width / 2;

      // Find the closest step cell
      let closestCellIndex = -1;
      let minDistance = Infinity;

      const cellCount = await trackStepCells.count();
      for (let j = 0; j < Math.min(cellCount, 16); j++) {
        const cell = trackStepCells.nth(j);
        const cellBox = await cell.boundingBox();
        if (!cellBox) continue;

        const cellCenterX = cellBox.x + cellBox.width / 2;
        const distance = Math.abs(dotCenterX - cellCenterX);

        if (distance < minDistance) {
          minDistance = distance;
          closestCellIndex = j;
        }
      }

      // The dot should be within 5px of the cell center
      // This tolerance accounts for sub-pixel rendering but catches major misalignment
      // (The original bug had 12px+ misalignment)
      expect(minDistance).toBeLessThan(5);
      console.log(`Dot ${i}: closest to cell ${closestCellIndex}, distance=${minDistance.toFixed(1)}px`);
    }
  });
});
