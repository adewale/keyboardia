/**
 * Track-local step resolution — the core polyrhythm maths.
 *
 * Extracted from Scheduler.scheduleStep so it can be tested directly.
 * scheduler.test.ts previously kept its own copy of these two functions, and
 * that copy had drifted: it omitted the `?? DEFAULT_STEP_COUNT` fallback and the
 * upper-bound check below, so 28 tests were exercising simpler logic than the
 * scheduler actually runs.
 */
import type { Track } from '../types';
import { DEFAULT_STEP_COUNT } from '../shared/constants';

/**
 * Which of a track's own steps plays at this global step.
 *
 * Tracks with different step counts loop at different rates against the same
 * global clock — that is the polyrhythm.
 */
export function getTrackStep(globalStep: number, stepCount?: number): number {
  return globalStep % (stepCount ?? DEFAULT_STEP_COUNT);
}

/** Should this track play at all right now? Solo, when any track is soloed, otherwise mute. */
export function shouldTrackPlay(track: Pick<Track, 'muted' | 'soloed'>, anySoloed: boolean): boolean {
  return anySoloed ? track.soloed : !track.muted;
}

/**
 * Is the track's step at this global position active?
 *
 * The `>= stepCount` guard matters for legacy sessions whose `steps` array is
 * shorter than `stepCount`.
 */
export function isTrackStepActive(
  track: Pick<Track, 'steps' | 'stepCount'>,
  globalStep: number
): boolean {
  const stepCount = track.stepCount ?? DEFAULT_STEP_COUNT;
  const trackStep = getTrackStep(globalStep, stepCount);
  if (trackStep >= stepCount) return false;
  return track.steps[trackStep] === true;
}

/** Full trigger decision: the track plays, and its current step is active. */
export function shouldTrackTrigger(
  track: Pick<Track, 'muted' | 'soloed' | 'steps' | 'stepCount'>,
  globalStep: number,
  anySoloed = false
): boolean {
  if (!shouldTrackPlay(track, anySoloed)) return false;
  return isTrackStepActive(track, globalStep);
}
