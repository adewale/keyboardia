import {
  DEFAULT_STEP_COUNT,
  MAX_STEPS,
  MAX_TEMPO,
  MAX_TRACKS,
  MIN_TEMPO,
} from '../shared/constants';
import {
  MCP_SAMPLE_IDS,
  TRACK_ID_PATTERN,
  type CompactMcpSession,
  type CompactMcpTrack,
} from './mcp-edits';

export type McpRhythmEvalTrackExpectation = {
  /** A new target must be satisfied by a track absent from the baseline. */
  target: 'new';
  track_id?: never;
  sample_id: string;
  step_count?: number;
  active_steps: number[];
} | {
  /** An existing target names the exact baseline track the prompt edits. */
  target: 'existing';
  track_id: string;
  sample_id: string;
  step_count?: number;
  active_steps: number[];
};

export interface McpRhythmEvalExpectation {
  tempo?: number;
  tracks: McpRhythmEvalTrackExpectation[];
  preserve_track_ids?: string[];
}

export interface McpRhythmEvalCase {
  id: string;
  prompt: string;
  baseline: {
    tempo: number;
    tracks: CompactMcpTrack[];
  };
  expectation: McpRhythmEvalExpectation;
}

export interface McpRhythmEvalScore {
  score: number;
  components: Record<string, number>;
  hard_failures: string[];
}

export const MCP_RHYTHM_EVAL_CASES: McpRhythmEvalCase[] = [
  {
    id: 'four-on-the-floor',
    prompt: 'Add a kick playing four on the floor at 124 BPM.',
    baseline: { tempo: 120, tracks: [] },
    expectation: {
      tempo: 124,
      tracks: [{
        target: 'new',
        sample_id: 'kick',
        step_count: 16,
        active_steps: [0, 4, 8, 12],
      }],
    },
  },
  {
    id: 'add-without-erasing',
    prompt: 'Keep the existing snare exactly as it is and add closed hi-hats on every even step.',
    baseline: {
      tempo: 120,
      tracks: [{
        track_id: 'existing-snare',
        name: 'Snare',
        sample_id: 'snare',
        pan: 0,
        step_count: 16,
        active_steps: [4, 12],
        envelope: { attack: .003, decay: 0, sustain: 1, release: .1 },
        envelope_override: false,
        envelope_time_unit: 'seconds',
        gate: 90,
      }],
    },
    expectation: {
      tracks: [{
        target: 'new',
        sample_id: 'hihat',
        step_count: 16,
        active_steps: [0, 2, 4, 6, 8, 10, 12, 14],
      }],
      preserve_track_ids: ['existing-snare'],
    },
  },
  {
    id: 'edit-existing-track',
    prompt: 'On the existing kick track, add step 12 and leave its other hits and the tempo alone.',
    baseline: {
      tempo: 112,
      tracks: [{
        track_id: 'existing-kick',
        name: 'Kick',
        sample_id: 'kick',
        pan: 0,
        step_count: 16,
        active_steps: [0, 4, 8],
        envelope: { attack: .003, decay: 0, sustain: 1, release: .1 },
        envelope_override: false,
        envelope_time_unit: 'seconds',
        gate: 90,
      }],
    },
    expectation: {
      tracks: [{
        target: 'existing',
        track_id: 'existing-kick',
        sample_id: 'kick',
        step_count: 16,
        active_steps: [0, 4, 8, 12],
      }],
    },
  },
  {
    id: 'clear-one-step',
    prompt: 'Clear step 6 on the existing hi-hat track. Do not change any other step.',
    baseline: {
      tempo: 120,
      tracks: [{
        track_id: 'existing-hats',
        name: 'Hi-Hat',
        sample_id: 'hihat',
        pan: 0,
        step_count: 16,
        active_steps: [0, 2, 4, 6, 8, 10, 12, 14],
        envelope: { attack: .003, decay: 0, sustain: 1, release: .1 },
        envelope_override: false,
        envelope_time_unit: 'seconds',
        gate: 90,
      }],
    },
    expectation: {
      tracks: [{
        target: 'existing',
        track_id: 'existing-hats',
        sample_id: 'hihat',
        step_count: 16,
        active_steps: [0, 2, 4, 8, 10, 12, 14],
      }],
    },
  },
  {
    id: 'clear-to-silence',
    prompt: 'Clear the only active step on the existing clap track and leave it silent.',
    baseline: {
      tempo: 120,
      tracks: [{
        track_id: 'existing-clap',
        name: 'Clap',
        sample_id: 'clap',
        pan: 0,
        step_count: 16,
        active_steps: [7],
        envelope: { attack: .003, decay: 0, sustain: 1, release: .1 },
        envelope_override: false,
        envelope_time_unit: 'seconds',
        gate: 90,
      }],
    },
    expectation: {
      tracks: [{
        target: 'existing',
        track_id: 'existing-clap',
        sample_id: 'clap',
        step_count: 16,
        active_steps: [],
      }],
    },
  },
  {
    id: 'tempo-without-erasing',
    prompt: 'Set the tempo to 98 BPM and leave the existing pattern untouched.',
    baseline: {
      tempo: 120,
      tracks: [{
        track_id: 'existing-rim',
        name: 'Rim',
        sample_id: 'rim',
        pan: 0,
        step_count: 16,
        active_steps: [3, 7, 11, 15],
        envelope: { attack: .003, decay: 0, sustain: 1, release: .1 },
        envelope_override: false,
        envelope_time_unit: 'seconds',
        gate: 90,
      }],
    },
    expectation: { tempo: 98, tracks: [] },
  },
  {
    id: 'two-hi-hat-patterns',
    prompt: 'Add two closed hi-hat tracks: one on steps 0, 4, 8, and 12; the other on steps 2, 6, 10, and 14.',
    baseline: { tempo: 120, tracks: [] },
    expectation: {
      tracks: [
        {
          target: 'new',
          sample_id: 'hihat',
          step_count: 16,
          active_steps: [0, 4, 8, 12],
        },
        {
          target: 'new',
          sample_id: 'hihat',
          step_count: 16,
          active_steps: [2, 6, 10, 14],
        },
      ],
    },
  },
];

const VALID_MCP_SAMPLE_IDS = new Set<string>(MCP_SAMPLE_IDS);

function sameNumberSet(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const aSet = new Set(a);
  return aSet.size === a.length && b.every((value) => aSet.has(value));
}

function setF1(expected: number[], actual: number[]): number {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  if (expectedSet.size === 0 && actualSet.size === 0) return 1;

  let truePositives = 0;
  for (const step of actualSet) {
    if (expectedSet.has(step)) truePositives++;
  }
  const precision = actualSet.size === 0 ? 0 : truePositives / actualSet.size;
  const recall = expectedSet.size === 0 ? 0 : truePositives / expectedSet.size;
  return precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
}

function sameTrackMetadata(
  a: CompactMcpTrack | undefined,
  b: CompactMcpTrack | undefined
): boolean {
  return a !== undefined
    && b !== undefined
    && a.track_id === b.track_id
    && a.name === b.name
    && a.sample_id === b.sample_id
    && a.step_count === b.step_count
    && a.pan === b.pan;
}

function sameTrack(a: CompactMcpTrack | undefined, b: CompactMcpTrack | undefined): boolean {
  return sameTrackMetadata(a, b)
    && sameNumberSet(a!.active_steps, b!.active_steps);
}

function requestedStepCompletion(
  baselineSteps: number[],
  expectedSteps: number[],
  actualSteps: number[]
): number {
  const before = new Set(baselineSteps);
  const expected = new Set(expectedSteps);
  const actual = new Set(actualSteps);
  const requested = new Set<number>();
  for (const step of before) {
    if (!expected.has(step)) requested.add(step);
  }
  for (const step of expected) {
    if (!before.has(step)) requested.add(step);
  }
  if (requested.size === 0) return sameNumberSet(expectedSteps, actualSteps) ? 1 : 0;

  let completed = 0;
  for (const step of requested) {
    if (actual.has(step) === expected.has(step)) completed++;
  }
  return completed / requested.size;
}

function preservesUnrequestedSteps(
  before: CompactMcpTrack,
  expected: McpRhythmEvalTrackExpectation & { target: 'existing' },
  after: CompactMcpTrack | undefined
): boolean {
  if (!after || !sameTrackMetadata(before, after)) return false;
  const baselineSteps = new Set(before.active_steps);
  const expectedSteps = new Set(expected.active_steps);
  const actualSteps = new Set(after.active_steps);
  if (actualSteps.size !== after.active_steps.length) return false;
  if (after.active_steps.some((step) =>
    !Number.isInteger(step) || step < 0 || step >= after.step_count
  )) return false;

  for (let step = 0; step < before.step_count; step++) {
    const requested = baselineSteps.has(step) !== expectedSteps.has(step);
    if (!requested && actualSteps.has(step) !== baselineSteps.has(step)) return false;
  }
  return true;
}

function validateActiveSteps(
  steps: number[],
  stepCount: number,
  label: string,
  errors: string[]
): void {
  if (new Set(steps).size !== steps.length) {
    errors.push(`${label} repeats an active step.`);
  }
  for (const step of steps) {
    if (!Number.isInteger(step) || step < 0 || step >= stepCount) {
      errors.push(`${label} step ${step} is outside its ${stepCount}-step loop.`);
    }
  }
}

/** Validate that an eval fixture is reachable through the public MCP edit contract. */
export function validateMcpRhythmEvalCase(evalCase: McpRhythmEvalCase): string[] {
  const errors: string[] = [];
  if (!evalCase.id.trim()) errors.push('The eval case id is empty.');
  if (!evalCase.prompt.trim()) errors.push(`Eval ${evalCase.id} has an empty prompt.`);
  if (
    !Number.isFinite(evalCase.baseline.tempo)
    || evalCase.baseline.tempo < MIN_TEMPO
    || evalCase.baseline.tempo > MAX_TEMPO
  ) {
    errors.push(`Eval ${evalCase.id} has an invalid baseline tempo.`);
  }
  if (evalCase.baseline.tracks.length > MAX_TRACKS) {
    errors.push(`Eval ${evalCase.id} baseline exceeds the ${MAX_TRACKS}-track limit.`);
  }

  const baselineById = new Map<string, CompactMcpTrack>();
  for (const track of evalCase.baseline.tracks) {
    if (!TRACK_ID_PATTERN.test(track.track_id)) {
      errors.push(`Baseline track ${track.track_id} has an invalid track id.`);
    }
    if (baselineById.has(track.track_id)) {
      errors.push(`Baseline track id ${track.track_id} appears more than once.`);
    }
    baselineById.set(track.track_id, track);
    if (!VALID_MCP_SAMPLE_IDS.has(track.sample_id)) {
      errors.push(`Baseline track ${track.track_id} has an invalid sample id.`);
    }
    if (!Number.isInteger(track.step_count) || track.step_count < 1 || track.step_count > MAX_STEPS) {
      errors.push(`Baseline track ${track.track_id} has an invalid step count.`);
    } else {
      validateActiveSteps(
        track.active_steps,
        track.step_count,
        `Baseline track ${track.track_id}`,
        errors
      );
    }
  }

  const { tempo, tracks } = evalCase.expectation;
  if (tempo === undefined && tracks.length === 0) {
    errors.push(`Eval ${evalCase.id} has no task objective.`);
  }
  if (tempo !== undefined) {
    if (!Number.isFinite(tempo) || tempo < MIN_TEMPO || tempo > MAX_TEMPO) {
      errors.push(`Eval ${evalCase.id} has an invalid expected tempo.`);
    } else if (tempo === evalCase.baseline.tempo) {
      errors.push(`Eval ${evalCase.id} asks for the tempo it already has.`);
    }
  }

  const targetedExistingIds = new Set<string>();
  let newTrackCount = 0;
  tracks.forEach((expected, index) => {
    const label = `Expectation ${index} in ${evalCase.id}`;
    if (!VALID_MCP_SAMPLE_IDS.has(expected.sample_id)) {
      errors.push(`${label} has an invalid sample id.`);
    }

    if (expected.target === 'new') {
      newTrackCount++;
      const stepCount = expected.step_count ?? DEFAULT_STEP_COUNT;
      if (stepCount !== DEFAULT_STEP_COUNT) {
        errors.push(`${label} requests a new track with unreachable step count ${stepCount}.`);
      }
      validateActiveSteps(expected.active_steps, stepCount, label, errors);
      return;
    }

    if (!TRACK_ID_PATTERN.test(expected.track_id)) {
      errors.push(`${label} has an invalid existing track id.`);
    }
    if (targetedExistingIds.has(expected.track_id)) {
      errors.push(`${label} targets existing track ${expected.track_id} more than once.`);
    }
    targetedExistingIds.add(expected.track_id);
    const before = baselineById.get(expected.track_id);
    if (!before) {
      errors.push(`${label} targets a track absent from the baseline.`);
      return;
    }
    if (expected.sample_id !== before.sample_id) {
      errors.push(`${label} changes an instrument outside the rhythm eval contract.`);
    }
    if (expected.step_count !== undefined && expected.step_count !== before.step_count) {
      errors.push(`${label} changes a loop length the MCP edit surface cannot change.`);
    }
    validateActiveSteps(expected.active_steps, before.step_count, label, errors);
    if (sameNumberSet(expected.active_steps, before.active_steps)) {
      errors.push(`${label} makes no step change.`);
    }
  });

  if (evalCase.baseline.tracks.length + newTrackCount > MAX_TRACKS) {
    errors.push(`Eval ${evalCase.id} cannot add its requested tracks within the track limit.`);
  }

  const preservedIds = new Set<string>();
  for (const trackId of evalCase.expectation.preserve_track_ids ?? []) {
    if (preservedIds.has(trackId)) {
      errors.push(`Eval ${evalCase.id} preserves track ${trackId} more than once.`);
    }
    preservedIds.add(trackId);
    if (!baselineById.has(trackId)) {
      errors.push(`Eval ${evalCase.id} preserves a track absent from the baseline.`);
    }
    if (targetedExistingIds.has(trackId)) {
      errors.push(`Eval ${evalCase.id} both edits and explicitly preserves track ${trackId}.`);
    }
  }

  return errors;
}

/**
 * Score task completion from the final get_session result. Preservation and
 * session integrity are hard gates, not positive credit: an untouched session
 * therefore earns zero for a requested one-step edit, while collateral damage
 * cannot be traded for a high musical average.
 */
export function scoreMcpRhythmResult(
  baseline: CompactMcpSession,
  result: CompactMcpSession,
  expectation: McpRhythmEvalExpectation
): McpRhythmEvalScore {
  const components: Record<string, number> = {};
  const objectiveValues: number[] = [];
  const hardFailures: string[] = [];
  const fail = (message: string): void => {
    if (!hardFailures.includes(message)) hardFailures.push(message);
  };
  const component = (name: string, value: number, objective = false): void => {
    components[name] = value;
    if (objective) objectiveValues.push(value);
  };

  component('same_session', result.session_id === baseline.session_id ? 1 : 0);
  if (components.same_session === 0) fail('The result came from a different session.');

  component('preserve_immutable', result.immutable === baseline.immutable ? 1 : 0);
  if (components.preserve_immutable === 0) fail('The session publication state changed.');

  if (expectation.tempo !== undefined) {
    component('tempo', result.tempo === expectation.tempo ? 1 : 0, true);
  } else {
    component('preserve_tempo', result.tempo === baseline.tempo ? 1 : 0);
    if (components.preserve_tempo === 0) {
      fail('The tempo changed even though the prompt did not name it.');
    }
  }

  const baselineById = new Map(baseline.tracks.map((track) => [track.track_id, track]));
  const baselineTrackIds = new Set(baselineById.keys());
  const explicitlyPreserved = new Set(expectation.preserve_track_ids ?? []);

  const qualityValues = (
    expected: McpRhythmEvalTrackExpectation,
    candidate: CompactMcpTrack
  ): number[] | null => {
    if (candidate.sample_id !== expected.sample_id) return null;
    if (explicitlyPreserved.has(candidate.track_id)) return null;
    if (expected.target === 'new') {
      if (baselineTrackIds.has(candidate.track_id)) return null;
      const values = [1, setF1(expected.active_steps, candidate.active_steps)];
      if (expected.step_count !== undefined) {
        values.push(candidate.step_count === expected.step_count ? 1 : 0);
      }
      return values;
    }
    if (candidate.track_id !== expected.track_id) return null;
    const before = baselineById.get(expected.track_id);
    if (!before) return null;
    return [requestedStepCompletion(
      before.active_steps,
      expected.active_steps,
      candidate.active_steps
    )];
  };

  // Maximize the exact sum of task components, not an average per expectation.
  // This remains correct when some new-track expectations include step_count
  // and others do not.
  type Assignment = { total: number; indexes: number[] };
  const memo = new Map<string, Assignment>();
  const assign = (expectationIndex: number, usedMask: bigint): Assignment => {
    if (expectationIndex === expectation.tracks.length) return { total: 0, indexes: [] };
    const key = `${expectationIndex}:${usedMask}`;
    const cached = memo.get(key);
    if (cached) return cached;

    const skipped = assign(expectationIndex + 1, usedMask);
    let best: Assignment = { total: skipped.total, indexes: [-1, ...skipped.indexes] };
    const expected = expectation.tracks[expectationIndex]!;
    for (let trackIndex = 0; trackIndex < result.tracks.length; trackIndex++) {
      const bit = 1n << BigInt(trackIndex);
      if ((usedMask & bit) !== 0n) continue;
      const values = qualityValues(expected, result.tracks[trackIndex]!);
      if (!values) continue;
      const quality = values.reduce((sum, value) => sum + value, 0);
      const rest = assign(expectationIndex + 1, usedMask | bit);
      if (quality + rest.total > best.total) {
        best = { total: quality + rest.total, indexes: [trackIndex, ...rest.indexes] };
      }
    }
    memo.set(key, best);
    return best;
  };

  const assignment = assign(0, 0n).indexes;
  const claimedIndexes = new Set<number>();
  const expectedExistingById = new Map<string, McpRhythmEvalTrackExpectation & { target: 'existing' }>();
  expectation.tracks.forEach((expected, index) => {
    const trackIndex = assignment[index] ?? -1;
    const matched = trackIndex < 0 ? undefined : result.tracks[trackIndex];
    if (matched) claimedIndexes.add(trackIndex);

    if (expected.target === 'new') {
      component(`track_${index}_exists`, matched ? 1 : 0, true);
      component(
        `track_${index}_steps`,
        matched ? setF1(expected.active_steps, matched.active_steps) : 0,
        true
      );
      if (expected.step_count !== undefined) {
        component(
          `track_${index}_step_count`,
          matched?.step_count === expected.step_count ? 1 : 0,
          true
        );
      }
      return;
    }

    expectedExistingById.set(expected.track_id, expected);
    const before = baselineById.get(expected.track_id);
    component(
      `track_${index}_requested_steps`,
      before && matched
        ? requestedStepCompletion(before.active_steps, expected.active_steps, matched.active_steps)
        : 0,
      true
    );
    if (!before) fail(`Expected track ${expected.track_id} was absent from the baseline.`);
  });

  const resultIds = result.tracks.map((track) => track.track_id);
  component('unique_track_ids', new Set(resultIds).size === resultIds.length ? 1 : 0);
  if (components.unique_track_ids === 0) fail('The result contains duplicate track ids.');

  const unclaimedNewTracks = result.tracks.filter((track, index) =>
    !baselineTrackIds.has(track.track_id) && !claimedIndexes.has(index)
  );
  component('no_extra_tracks', unclaimedNewTracks.length === 0 ? 1 : 0);
  if (unclaimedNewTracks.length > 0) {
    fail(`The result added ${unclaimedNewTracks.length} unrequested track(s).`);
  }

  let baselinePreserved = true;
  for (const before of baseline.tracks) {
    const after = result.tracks.find((track) => track.track_id === before.track_id);
    const expected = expectedExistingById.get(before.track_id);
    if (!expected) {
      if (!sameTrack(before, after)) {
        baselinePreserved = false;
        fail(`Existing track ${before.track_id} was changed or deleted without being requested.`);
      }
      continue;
    }

    if (!sameTrackMetadata(before, after)) {
      baselinePreserved = false;
      fail(`Existing track ${before.track_id} changed outside its requested steps.`);
      continue;
    }
    if (!preservesUnrequestedSteps(before, expected, after)) {
      baselinePreserved = false;
      fail(`Existing track ${before.track_id} changed an unrequested step.`);
    }
  }
  component('preserve_baseline', baselinePreserved ? 1 : 0);

  const resultBaselineOrder = result.tracks
    .filter((track) => baselineTrackIds.has(track.track_id))
    .map((track) => track.track_id);
  const baselineOrder = baseline.tracks.map((track) => track.track_id);
  component('preserve_track_order', sameStringArray(baselineOrder, resultBaselineOrder) ? 1 : 0);
  if (components.preserve_track_order === 0) {
    fail('Existing tracks were deleted, duplicated, or reordered.');
  }

  for (const trackId of expectation.preserve_track_ids ?? []) {
    const before = baselineById.get(trackId);
    const after = result.tracks.find((track) => track.track_id === trackId);
    component(`preserve_${trackId}`, sameTrack(before, after) ? 1 : 0);
    if (!before) fail(`Required preserved track ${trackId} was absent from the baseline.`);
    if (before && components[`preserve_${trackId}`] === 0) {
      fail(`Required preserved track ${trackId} changed.`);
    }
  }

  if (objectiveValues.length === 0) fail('The expectation defines no task objective.');
  return {
    score: hardFailures.length > 0
      ? 0
      : objectiveValues.reduce((total, value) => total + value, 0) / objectiveValues.length,
    components,
    hard_failures: hardFailures,
  };
}

function sameStringArray(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
