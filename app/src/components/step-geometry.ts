/**
 * Step geometry shared by the step rows, the loop ruler and the piano roll.
 *
 * The rows lay their cells out on a step pitch (cell + 3px gap) with a wider
 * gap after every page of 16 steps (StepCell.css `.step-cell.page-end`). That
 * page gap is part of the grid's rhythm (specs/PIANO-ROLL-DOCK.md, Layout
 * Principles: Repetition), so everything that sits on the step columns places
 * itself with these functions rather than with `step * pitch`.
 */
import { STEPS_PER_PAGE } from '../types';

export interface StepGeometry {
  /** One cell plus the gap between cells, in px. */
  stepPitch: number;
  /** Extra space after the last cell of each page, in px. */
  pageGap: number;
  /** Steps per page; the page gap follows every `stepsPerPage` steps. */
  stepsPerPage: number;
}

/** Gap between two cells of the same page, in px (TrackRow.css `.steps`). */
export const CELL_GAP = 3;

/** Desktop: 36px cells, 8px page gap (StepCell.css). */
export const DESKTOP_STEP_GEOMETRY: StepGeometry = {
  stepPitch: 39,
  pageGap: 8,
  stepsPerPage: STEPS_PER_PAGE,
};

/** Under 768px: 44px cells; the page gap stays 8px (StepCell.css). */
export const MOBILE_STEP_GEOMETRY: StepGeometry = {
  stepPitch: 47,
  pageGap: 8,
  stepsPerPage: STEPS_PER_PAGE,
};

/** Width of one cell in px. */
export const cellWidth = (g: StepGeometry): number => g.stepPitch - CELL_GAP;

/** Left edge of step `step`'s cell, in px from the first cell's left edge. */
export function stepToX(step: number, g: StepGeometry): number {
  return step * g.stepPitch + Math.floor(step / g.stepsPerPage) * g.pageGap;
}

/**
 * The step whose column contains `x`. The gap after a cell belongs to that
 * cell, and the page gap belongs to the page boundary: an x inside it maps to
 * the last step of the page before. Callers clamp the result to their range.
 */
export function xToStep(x: number, g: StepGeometry): number {
  const pageWidth = g.stepsPerPage * g.stepPitch + g.pageGap;
  const page = Math.floor(x / pageWidth);
  const within = x - page * pageWidth;
  const inPage = Math.min(g.stepsPerPage - 1, Math.floor(within / g.stepPitch));
  return page * g.stepsPerPage + inPage;
}

/**
 * Width of a run of `len` cells from `start`: from the first cell's left edge
 * to the last cell's right edge, spanning any page gap inside the run.
 */
export function spanWidth(start: number, len: number, g: StepGeometry): number {
  if (len <= 0) return 0;
  return stepToX(start + len - 1, g) + cellWidth(g) - stepToX(start, g);
}

/** Width of `stepCount` steps: the first cell's left edge to the last cell's right edge. */
export function gridWidth(stepCount: number, g: StepGeometry): number {
  return spanWidth(0, stepCount, g);
}
