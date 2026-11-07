import { test, expect, useMockAPI, waitForCollaborationReady } from './global-setup';
import { createSessionWithRetry } from './test-utils';
import { CELL_GAP, DESKTOP_STEP_GEOMETRY, cellWidth as geometryCellWidth } from '../src/components/step-geometry';

/**
 * Pitch contour alignment (specs/PIANO-ROLL-DOCK.md, phases 5 and 8).
 *
 * The contour used to be an SVG overlay drawn under each melodic row, placed
 * with a hardcoded 39px step constant; when the constant drifted from the CSS,
 * dots landed over the wrong cells (Bug #pitch-contour-alignment). That
 * overlay is gone. Each active melodic step now carries its own contour mark
 * inside its cell (StepCell.tsx, step-contour.ts), so a mark cannot leave its
 * column. What a browser still has to show:
 *
 * - the rows' rendered step pitch matches the shared step geometry
 *   (step-geometry.ts) that the loop ruler and the dock's roll are placed on;
 * - every active melodic step shows a mark inside its own cell, inactive
 *   steps show none, and nothing else is drawn in or under the row.
 */

test.describe('Pitch contour alignment', () => {
  test.beforeEach(async ({ page }) => {
    // Use desktop viewport to match the 36px + 3px = 39px calculation
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  test('CSS dimensions match JavaScript constants (CRITICAL regression test)', async ({
    page,
    request,
  }) => {
    // The rows, the loop ruler and the roll all place themselves with
    // step-geometry.ts; this checks the CSS still renders that geometry.
    //
    // Seed the state this assertion needs directly. Going through the landing
    // page and instrument picker made an unrelated session-creation click part
    // of this CSS contract and occasionally left WebKit on the landing page.
    const { id: sessionId } = await createSessionWithRetry(request, {
      tracks: [
        {
          id: 'css-dimensions-track',
          name: 'CSS Dimensions',
          sampleId: 'sampled:808-kick',
          steps: Array(128).fill(false),
          parameterLocks: Array(128).fill(null),
          volume: 0.7,
          pan: 0,
          muted: false,
          transpose: 0,
          stepCount: 16,
        },
      ],
      tempo: 120,
      swing: 0,
      version: 1,
    });
    await page.goto(`/s/${sessionId}`);

    // Wait for the seeded track to finish loading and synchronizing.
    await waitForCollaborationReady(page);

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

    // CRITICAL ASSERTION: the rendered pitch is the shared step geometry's.
    expect(cellWidth).toBe(geometryCellWidth(DESKTOP_STEP_GEOMETRY));
    expect(gap).toBe(CELL_GAP);
    expect(totalCellWidth).toBe(DESKTOP_STEP_GEOMETRY.stepPitch);
  });

  test('contour marks sit inside active melodic cells and nothing is drawn under the row', async ({
    page,
    request,
  }) => {
    test.skip(useMockAPI, 'Rendered contour fixture requires the Worker-backed session path');
    const active = [true, true, true, true, false, false, true, true];
    const { id: sessionId } = await createSessionWithRetry(request, {
      tracks: [
        {
          id: 'track-1',
          name: 'Pitch Test',
          // Contour marks are limited to melodic instruments.
          sampleId: 'synth:lead',
          steps: [...active, ...Array(120).fill(false)],
          parameterLocks: [
            { pitch: 0 },
            { pitch: 5 },
            { pitch: 7 },
            { pitch: 5 },
            null,
            null,
            { pitch: -3 },
            { pitch: 0 },
            ...Array(120).fill(null),
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
    });
    await page.goto(`/s/${sessionId}`);
    await waitForCollaborationReady(page);

    const row = page.locator('.track-row').first();
    await expect(row).toBeVisible({ timeout: 10000 });
    const cells = row.locator('.step-cell');
    await expect(cells).toHaveCount(active.length);

    for (let step = 0; step < active.length; step++) {
      const mark = cells.nth(step).locator('[data-testid="step-contour"]');
      if (!active[step]) {
        await expect(mark, `step ${step + 1} is silent and has no mark`).toHaveCount(0);
        continue;
      }
      await expect(mark, `step ${step + 1} has its mark`).toHaveCount(1);
      const [markBox, cellBox] = await Promise.all([mark.boundingBox(), cells.nth(step).boundingBox()]);
      if (!markBox || !cellBox) throw new Error(`step ${step + 1} must be measurable`);
      // The mark is inside its own cell: it cannot drift onto a neighbour.
      expect(markBox.x).toBeGreaterThanOrEqual(cellBox.x - 0.5);
      expect(markBox.x + markBox.width).toBeLessThanOrEqual(cellBox.x + cellBox.width + 0.5);
      expect(markBox.y).toBeGreaterThanOrEqual(cellBox.y - 0.5);
      expect(markBox.y + markBox.height).toBeLessThanOrEqual(cellBox.y + cellBox.height + 0.5);
    }

    // Nothing else is drawn in or under the row: no overlay, only cells.
    await expect(page.locator('.pitch-contour, .contour-dot, .contour-line')).toHaveCount(0);
    await expect(row.locator('.steps > :not(.step-cell)')).toHaveCount(0);
  });
});
