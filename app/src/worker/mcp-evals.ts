import type { CompactMcpSession, CompactMcpTrack } from './mcp-edits';

export interface McpRhythmEvalExpectation {
  tempo?: number;
  tracks: Array<{
    /** Require a particular existing track when the prompt names one. */
    track_id?: string;
    sample_id: string;
    step_count?: number;
    active_steps: number[];
  }>;
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
      tracks: [{ sample_id: 'kick', step_count: 16, active_steps: [0, 4, 8, 12] }],
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
        step_count: 16,
        active_steps: [4, 12],
      }],
    },
    expectation: {
      tracks: [{
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
        step_count: 16,
        active_steps: [0, 4, 8],
      }],
    },
    expectation: {
      tracks: [{
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
        step_count: 16,
        active_steps: [0, 2, 4, 6, 8, 10, 12, 14],
      }],
    },
    expectation: {
      tracks: [{
        track_id: 'existing-hats',
        sample_id: 'hihat',
        step_count: 16,
        active_steps: [0, 2, 4, 8, 10, 12, 14],
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
        step_count: 16,
        active_steps: [3, 7, 11, 15],
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
        { sample_id: 'hihat', step_count: 16, active_steps: [0, 4, 8, 12] },
        { sample_id: 'hihat', step_count: 16, active_steps: [2, 6, 10, 14] },
      ],
    },
  },
];

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

function sameTrack(a: CompactMcpTrack | undefined, b: CompactMcpTrack | undefined): boolean {
  return a !== undefined && b !== undefined && JSON.stringify(a) === JSON.stringify(b);
}

function sameTrackExceptSteps(
  a: CompactMcpTrack | undefined,
  b: CompactMcpTrack | undefined
): boolean {
  return a !== undefined
    && b !== undefined
    && a.track_id === b.track_id
    && a.name === b.name
    && a.sample_id === b.sample_id
    && a.step_count === b.step_count;
}

/**
 * Scores the final get_session result from an agent run. Preservation is a
 * first-class component, so replacing another collaborator's work cannot
 * receive a perfect musical score.
 *
 * Each expectation is satisfied by at most one track and each track satisfies
 * at most one expectation, so an agent cannot raise its score by scattering
 * near-miss duplicates and letting the best one count. Tracks it added that no
 * expectation claimed are scored as litter.
 */
export function scoreMcpRhythmResult(
  baseline: CompactMcpSession,
  result: CompactMcpSession,
  expectation: McpRhythmEvalExpectation
): McpRhythmEvalScore {
  const components: Record<string, number> = {};
  const hardFailures: string[] = [];

  components.same_session = result.session_id === baseline.session_id ? 1 : 0;
  if (components.same_session === 0) {
    hardFailures.push('The result came from a different session.');
  }

  components.preserve_immutable = result.immutable === baseline.immutable ? 1 : 0;
  if (components.preserve_immutable === 0) {
    hardFailures.push('The session publication state changed.');
  }

  if (expectation.tempo !== undefined) {
    components.tempo = result.tempo === expectation.tempo ? 1 : 0;
  } else {
    components.preserve_tempo = result.tempo === baseline.tempo ? 1 : 0;
    if (components.preserve_tempo === 0) {
      hardFailures.push('The tempo changed even though the prompt did not name it.');
    }
  }

  // Find the globally best one-to-one assignment. A greedy first match can
  // steal the only good candidate for a later expectation when two requested
  // tracks use the same instrument.
  const explicitlyPreserved = new Set(expectation.preserve_track_ids ?? []);
  type Assignment = { total: number; indexes: number[] };
  const memo = new Map<string, Assignment>();
  const assign = (expectationIndex: number, usedMask: number): Assignment => {
    if (expectationIndex === expectation.tracks.length) return { total: 0, indexes: [] };
    const key = `${expectationIndex}:${usedMask}`;
    const cached = memo.get(key);
    if (cached) return cached;

    const skipped = assign(expectationIndex + 1, usedMask);
    let best: Assignment = {
      total: skipped.total,
      indexes: [-1, ...skipped.indexes],
    };
    const expected = expectation.tracks[expectationIndex]!;
    for (let trackIndex = 0; trackIndex < result.tracks.length; trackIndex++) {
      if ((usedMask & (1 << trackIndex)) !== 0) continue;
      const candidate = result.tracks[trackIndex]!;
      if (explicitlyPreserved.has(candidate.track_id)) continue;
      if (candidate.sample_id !== expected.sample_id) continue;
      if (expected.track_id !== undefined && candidate.track_id !== expected.track_id) continue;

      const values = [setF1(expected.active_steps, candidate.active_steps)];
      if (expected.step_count !== undefined) {
        values.push(candidate.step_count === expected.step_count ? 1 : 0);
      }
      const quality = values.reduce((sum, value) => sum + value, 0) / values.length;
      const rest = assign(expectationIndex + 1, usedMask | (1 << trackIndex));
      if (quality + rest.total > best.total) {
        best = {
          total: quality + rest.total,
          indexes: [trackIndex, ...rest.indexes],
        };
      }
    }
    memo.set(key, best);
    return best;
  };

  const assignment = assign(0, 0).indexes;
  const claimed = new Set<string>();
  expectation.tracks.forEach((expected, index) => {
    const trackIndex = assignment[index] ?? -1;
    const matched = trackIndex < 0 ? undefined : result.tracks[trackIndex];
    if (matched) claimed.add(matched.track_id);
    components[`track_${index}_steps`] = matched
      ? setF1(expected.active_steps, matched.active_steps)
      : 0;
    if (expected.step_count !== undefined) {
      components[`track_${index}_step_count`] = matched?.step_count === expected.step_count ? 1 : 0;
    }
  });

  const baselineTrackIds = new Set(baseline.tracks.map((track) => track.track_id));
  const unclaimedNewTracks = result.tracks.filter((track) =>
    !baselineTrackIds.has(track.track_id) && !claimed.has(track.track_id)
  ).length;
  components.no_extra_tracks = unclaimedNewTracks === 0 ? 1 : 0;

  let baselinePreserved = true;
  for (const before of baseline.tracks) {
    const after = result.tracks.find((track) => track.track_id === before.track_id);
    // A requested edit may change the active steps of the baseline track it
    // claims, but not its identity, instrument, name, or step count.
    const preserved = claimed.has(before.track_id)
      ? sameTrackExceptSteps(before, after)
      : sameTrack(before, after);
    if (!preserved) {
      baselinePreserved = false;
      hardFailures.push(
        claimed.has(before.track_id)
          ? `Existing track ${before.track_id} changed outside its requested steps.`
          : `Existing track ${before.track_id} was changed or deleted without being requested.`
      );
    }
  }
  components.preserve_baseline = baselinePreserved ? 1 : 0;

  for (const trackId of expectation.preserve_track_ids ?? []) {
    const before = baseline.tracks.find((track) => track.track_id === trackId);
    const after = result.tracks.find((track) => track.track_id === trackId);
    components[`preserve_${trackId}`] = sameTrack(before, after) ? 1 : 0;
    if (before === undefined) {
      hardFailures.push(`Required preserved track ${trackId} was absent from the baseline.`);
    }
  }

  const values = Object.values(components);
  return {
    score: hardFailures.length > 0
      ? 0
      : values.length === 0
        ? 1
        : values.reduce((total, value) => total + value, 0) / values.length,
    components,
    hard_failures: hardFailures,
  };
}
