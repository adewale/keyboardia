/**
 * Pitch contour marks for melodic step cells.
 *
 * Each active step on a melodic track carries a short horizontal mark whose
 * height maps the step's sounding pitch into the track's own range: the
 * lowest active pitch sits at the bottom, the highest at the top. A step that
 * continues a held note takes the note's pitch and is flagged `tied`, so its
 * mark joins the one before it and the note reads as one line across cells.
 *
 * @see specs/PIANO-ROLL-DOCK.md (Proposal: pitch contour mark)
 * @see specs/mocks/piano-roll-dock.html (syncRow)
 */
import { computeBars, trackLength, type BarSource } from './piano-roll-bars';

export interface StepContour {
  /** Pitch position in the track's active range: 0 = lowest, 1 = highest. */
  fraction: number;
  /** True when the step continues the held note started by an earlier step. */
  tied: boolean;
}

/**
 * Contour mark for every step up to `length`, or null for inactive steps.
 * A track whose active steps all share one pitch places them at 0.5.
 */
export function computeStepContours(
  track: BarSource,
  length: number = trackLength(track),
): (StepContour | null)[] {
  const contours: (StepContour | null)[] = new Array(length).fill(null);
  const bars = computeBars(track, length);
  if (bars.length === 0) return contours;

  let lo = Infinity;
  let hi = -Infinity;
  for (const bar of bars) {
    if (bar.midi < lo) lo = bar.midi;
    if (bar.midi > hi) hi = bar.midi;
  }
  const span = hi - lo;

  for (const bar of bars) {
    const fraction = span === 0 ? 0.5 : (bar.midi - lo) / span;
    for (let i = bar.start; i < bar.start + bar.len; i++) {
      contours[i] = { fraction, tied: i > bar.start };
    }
  }
  return contours;
}
