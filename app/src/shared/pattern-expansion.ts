import { DEFAULT_STEP_COUNT } from './constants';

/** A deliberately generous ceiling: 1,024 bars of sixteenth notes. */
export const MAX_PATTERN_STEPS = 16_384;

/** Keeps MIDI creation bounded even when many dense tracks realign slowly. */
export const MAX_MIDI_NOTE_EVENTS = 100_000;

export interface PatternTrack {
  steps: readonly boolean[];
  stepCount?: number;
}

export class PatternExpansionError extends Error {
  readonly code = 'PATTERN_EXPANSION_TOO_LARGE';
  readonly limit: number;

  constructor(
    message: string,
    limit: number
  ) {
    super(message);
    this.name = 'PatternExpansionError';
    this.limit = limit;
  }
}

export function stepCountOf(track: PatternTrack): number {
  return track.stepCount ?? DEFAULT_STEP_COUNT;
}

/** Hidden cells beyond a shortened loop are state history, not sounding steps. */
export function activeStepCount(track: PatternTrack): number {
  return track.steps.slice(0, stepCountOf(track)).filter(Boolean).length;
}

export function hasActiveSteps(track: PatternTrack): boolean {
  return activeStepCount(track) > 0;
}

function gcd(a: number, b: number): number {
  while (b !== 0) {
    [a, b] = [b, a % b];
  }
  return a;
}

/**
 * Compute an LCM while it is still safe to do so. The division happens before
 * multiplication, and the multiplication is rejected before a huge pattern is
 * ever represented or iterated.
 */
export function boundedPatternLength(
  stepCounts: readonly number[],
  { empty = 0, limit = MAX_PATTERN_STEPS }: { empty?: number; limit?: number } = {}
): number {
  if (stepCounts.length === 0) return empty;

  let pattern = 1;
  for (const count of stepCounts) {
    const factor = count / gcd(pattern, count);
    if (factor > Math.floor(limit / pattern)) {
      throw new PatternExpansionError(
        `The combined loop is longer than the ${limit}-step safety limit. Shorten or align the track loop lengths before continuing.`,
        limit
      );
    }
    pattern *= factor;
  }
  return pattern;
}

export interface PatternExpansionPlan {
  patternSteps: number;
  noteEvents: number;
}

/**
 * Plan the complete expansion before an exporter allocates a single event.
 * Since the pattern length is an LCM, every division below is integral.
 */
export function planPatternExpansion(
  tracks: readonly PatternTrack[],
  {
    empty = DEFAULT_STEP_COUNT,
    maxPatternSteps = MAX_PATTERN_STEPS,
    maxNoteEvents = MAX_MIDI_NOTE_EVENTS,
  }: {
    empty?: number;
    maxPatternSteps?: number;
    maxNoteEvents?: number;
  } = {}
): PatternExpansionPlan {
  const patternSteps = boundedPatternLength(
    tracks.map(stepCountOf),
    { empty, limit: maxPatternSteps }
  );

  let noteEvents = 0;
  for (const track of tracks) {
    noteEvents += activeStepCount(track) * (patternSteps / stepCountOf(track));
    if (noteEvents > maxNoteEvents) {
      throw new PatternExpansionError(
        `The MIDI export would create more than ${maxNoteEvents} note events. Reduce pattern density or align the track loop lengths before exporting.`,
        maxNoteEvents
      );
    }
  }

  return { patternSteps, noteEvents };
}
