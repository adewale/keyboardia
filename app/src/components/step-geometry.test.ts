import { describe, expect, it } from 'vitest';
import {
  CELL_GAP,
  DESKTOP_STEP_GEOMETRY as D,
  MOBILE_STEP_GEOMETRY as M,
  cellWidth,
  gridWidth,
  spanWidth,
  stepToX,
  xToStep,
} from './step-geometry';

describe('step geometry', () => {
  it('uses the cells of StepCell.css: 36px and 44px cells, 3px gaps, an 8px page gap', () => {
    expect(cellWidth(D)).toBe(36);
    expect(cellWidth(M)).toBe(44);
    expect(CELL_GAP).toBe(3);
    expect(D.pageGap).toBe(8);
    expect(M.pageGap).toBe(8);
    expect(D.stepsPerPage).toBe(16);
  });

  it('adds one page gap per completed page', () => {
    expect(stepToX(0, D)).toBe(0);
    expect(stepToX(15, D)).toBe(15 * 39);
    expect(stepToX(16, D)).toBe(16 * 39 + 8);
    expect(stepToX(32, D)).toBe(32 * 39 + 16);
    expect(stepToX(17, M)).toBe(17 * 47 + 8);
  });

  it('round-trips every step through its whole column', () => {
    for (const g of [D, M]) {
      for (let step = 0; step < 128; step++) {
        const left = stepToX(step, g);
        expect(xToStep(left, g)).toBe(step);
        expect(xToStep(left + cellWidth(g) - 1, g)).toBe(step);
        // The 3px gap after a cell belongs to that cell.
        expect(xToStep(left + g.stepPitch - 1, g)).toBe(step);
      }
    }
  });

  it('gives the page gap to the step before the boundary', () => {
    const lastCellRight = stepToX(15, D) + cellWidth(D);
    for (let x = lastCellRight; x < stepToX(16, D); x++) {
      expect(xToStep(x, D)).toBe(15);
    }
    expect(xToStep(stepToX(16, D), D)).toBe(16);
    expect(xToStep(stepToX(32, D) - 1, D)).toBe(31);
    expect(xToStep(-1, D)).toBeLessThan(0);
  });

  it('measures runs and grids from the first left edge to the last right edge', () => {
    expect(spanWidth(0, 1, D)).toBe(36);
    expect(spanWidth(0, 3, D)).toBe(3 * 39 - 3);
    // A run that ends on a page's last cell stops at that cell, not after the gap.
    expect(spanWidth(12, 4, D)).toBe(4 * 39 - 3);
    // A run that crosses a page boundary spans the gap.
    expect(spanWidth(14, 4, D)).toBe(4 * 39 - 3 + 8);
    expect(spanWidth(3, 0, D)).toBe(0);

    expect(gridWidth(16, D)).toBe(16 * 39 - 3);
    expect(gridWidth(32, D)).toBe(32 * 39 - 3 + 8);
    expect(gridWidth(64, D)).toBe(64 * 39 - 3 + 3 * 8);
    expect(gridWidth(32, M)).toBe(32 * 47 - 3 + 8);
    expect(gridWidth(0, D)).toBe(0);
  });
});
