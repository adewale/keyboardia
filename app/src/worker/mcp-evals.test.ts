import { describe, expect, it } from 'vitest';
import { DEFAULT_STEP_COUNT } from '../shared/constants';
import type { CompactMcpSession, CompactMcpTrack } from './mcp-edits';
import {
  MCP_RHYTHM_EVAL_CASES,
  scoreMcpRhythmResult,
  validateMcpRhythmEvalCase,
  type McpRhythmEvalCase,
} from './mcp-evals';

const SESSION_ID = '00000000-0000-4000-8000-000000000001';

const baseline: CompactMcpSession = {
  session_id: SESSION_ID,
  immutable: false,
  tempo: 120,
  tracks: [{
    track_id: 'existing-snare',
    name: 'Snare',
    sample_id: 'snare',
    pan: 0,
    step_count: 16,
    active_steps: [4, 12],
  }],
};

function track(overrides: Partial<CompactMcpTrack> & { track_id: string }): CompactMcpTrack {
  return {
    name: 'Hi-Hat',
    sample_id: 'hihat',
    pan: 0,
    step_count: 16,
    active_steps: [],
    ...overrides,
  };
}

describe('MCP rhythm eval scorer', () => {
  it('gives a perfect score to a correct additive edit', () => {
    const result: CompactMcpSession = {
      ...baseline,
      tracks: [
        ...baseline.tracks,
        track({
          track_id: 'agent-hats',
          active_steps: [0, 2, 4, 6, 8, 10, 12, 14],
        }),
      ],
    };

    const scored = scoreMcpRhythmResult(baseline, result, {
      tracks: [{
        target: 'new',
        sample_id: 'hihat',
        active_steps: [0, 2, 4, 6, 8, 10, 12, 14],
      }],
      preserve_track_ids: ['existing-snare'],
    });

    expect(scored.score).toBe(1);
    expect(scored.hard_failures).toEqual([]);
    expect(scored.components.track_0_exists).toBe(1);
    expect(scored.components.track_0_steps).toBe(1);
  });

  it('hard-fails erasing a collaborator even when the new rhythm is correct', () => {
    const result: CompactMcpSession = {
      ...baseline,
      tracks: [track({
        track_id: 'agent-hats',
        active_steps: [0, 2, 4, 6, 8, 10, 12, 14],
      })],
    };

    const scored = scoreMcpRhythmResult(baseline, result, {
      tracks: [{
        target: 'new',
        sample_id: 'hihat',
        active_steps: [0, 2, 4, 6, 8, 10, 12, 14],
      }],
      preserve_track_ids: ['existing-snare'],
    });

    expect(scored.score).toBe(0);
    expect(scored.hard_failures).toContain(
      'Existing track existing-snare was changed or deleted without being requested.'
    );
  });

  it('hard-fails scattershot duplicate guesses', () => {
    const scattered: CompactMcpSession = {
      ...baseline,
      tracks: [
        ...baseline.tracks,
        track({ track_id: 'try-1', active_steps: [0, 2, 4, 6, 8, 10, 12, 14] }),
        track({ track_id: 'try-2', active_steps: [0, 4, 8, 12] }),
        track({ track_id: 'try-3', active_steps: [1, 3, 5, 7] }),
      ],
    };

    const scored = scoreMcpRhythmResult(baseline, scattered, {
      tracks: [{
        target: 'new',
        sample_id: 'hihat',
        active_steps: [0, 2, 4, 6, 8, 10, 12, 14],
      }],
    });

    expect(scored.components.track_0_steps).toBe(1);
    expect(scored.components.no_extra_tracks).toBe(0);
    expect(scored.score).toBe(0);
    expect(scored.hard_failures).toContain('The result added 2 unrequested track(s).');
  });

  it('does not let a new-track expectation claim an existing baseline track', () => {
    const scored = scoreMcpRhythmResult(baseline, baseline, {
      tracks: [{
        target: 'new',
        sample_id: 'snare',
        active_steps: [4, 12],
      }],
    });

    expect(scored.score).toBe(0);
    expect(scored.components.track_0_exists).toBe(0);
  });

  it('scores a requested edit only against the named existing track', () => {
    const corrected: CompactMcpSession = {
      ...baseline,
      tracks: [{ ...baseline.tracks[0]!, active_steps: [4, 12, 14] }],
    };

    const scored = scoreMcpRhythmResult(baseline, corrected, {
      tracks: [{
        target: 'existing',
        track_id: 'existing-snare',
        sample_id: 'snare',
        active_steps: [4, 12, 14],
      }],
    });

    expect(scored.score).toBe(1);
    expect(scored.hard_failures).toEqual([]);
    expect(scored.components.track_0_requested_steps).toBe(1);
  });

  it('hard-fails collateral edits on a targeted existing track', () => {
    const hatsBaseline: CompactMcpSession = {
      ...baseline,
      tracks: [track({
        track_id: 'existing-hats',
        active_steps: [0, 2, 4, 6, 8, 10, 12, 14],
      })],
    };
    const result: CompactMcpSession = {
      ...hatsBaseline,
      tracks: [{ ...hatsBaseline.tracks[0]!, active_steps: [0, 2, 4, 8, 10, 12] }],
    };

    const scored = scoreMcpRhythmResult(hatsBaseline, result, {
      tracks: [{
        target: 'existing',
        track_id: 'existing-hats',
        sample_id: 'hihat',
        active_steps: [0, 2, 4, 8, 10, 12, 14],
      }],
    });

    expect(scored.components.track_0_requested_steps).toBe(1);
    expect(scored.score).toBe(0);
    expect(scored.hard_failures).toContain(
      'Existing track existing-hats changed an unrequested step.'
    );
  });

  it('gives no objective credit to a no-op one-step edit', () => {
    const scored = scoreMcpRhythmResult(baseline, baseline, {
      tracks: [{
        target: 'existing',
        track_id: 'existing-snare',
        sample_id: 'snare',
        active_steps: [4],
      }],
    });

    expect(scored.components.track_0_requested_steps).toBe(0);
    expect(scored.score).toBe(0);
    expect(scored.hard_failures).toEqual([]);
  });

  it('hard-fails an unrequested baseline change without an explicit preserve list', () => {
    const changed: CompactMcpSession = {
      ...baseline,
      tracks: [{ ...baseline.tracks[0]!, active_steps: [] }],
    };

    const scored = scoreMcpRhythmResult(baseline, changed, {
      tracks: [{ target: 'new', sample_id: 'hihat', active_steps: [0, 4, 8, 12] }],
    });

    expect(scored.score).toBe(0);
    expect(scored.components.preserve_baseline).toBe(0);
    expect(scored.hard_failures).toHaveLength(1);
  });

  it('uses the globally best assignment for two tracks with one instrument', () => {
    const result: CompactMcpSession = {
      ...baseline,
      tracks: [
        ...baseline.tracks,
        track({ track_id: 'best-for-second', active_steps: [0, 1] }),
        track({ track_id: 'only-tied-for-first', active_steps: [0, 2] }),
      ],
    };

    const scored = scoreMcpRhythmResult(baseline, result, {
      tracks: [
        { target: 'new', sample_id: 'hihat', active_steps: [0] },
        { target: 'new', sample_id: 'hihat', active_steps: [0, 1] },
      ],
    });

    expect(scored.components.track_0_steps).toBeCloseTo(2 / 3);
    expect(scored.components.track_1_steps).toBe(1);
    expect(scored.components.no_extra_tracks).toBe(1);
  });

  it('scores the requested step count independently from the rhythm', () => {
    const result: CompactMcpSession = {
      ...baseline,
      tracks: [
        ...baseline.tracks,
        track({ track_id: 'short-hats', step_count: 8, active_steps: [0, 2, 4, 6] }),
      ],
    };

    const scored = scoreMcpRhythmResult(baseline, result, {
      tracks: [{
        target: 'new',
        sample_id: 'hihat',
        step_count: 16,
        active_steps: [0, 2, 4, 6],
      }],
    });

    expect(scored.components.track_0_steps).toBe(1);
    expect(scored.components.track_0_step_count).toBe(0);
    expect(scored.score).toBeLessThan(1);
  });
});

describe('MCP rhythm eval cases', () => {
  function baselineFor(evalCase: McpRhythmEvalCase): CompactMcpSession {
    return {
      session_id: SESSION_ID,
      immutable: false,
      tempo: evalCase.baseline.tempo,
      tracks: structuredClone(evalCase.baseline.tracks),
    };
  }

  function idealResultFor(evalCase: McpRhythmEvalCase): CompactMcpSession {
    expect(validateMcpRhythmEvalCase(evalCase)).toEqual([]);
    const start = baselineFor(evalCase);
    const tracks = structuredClone(start.tracks);
    for (const [index, expected] of evalCase.expectation.tracks.entries()) {
      if (expected.target === 'existing') {
        const existingIndex = tracks.findIndex(
          ({ track_id }) => track_id === expected.track_id
        );
        tracks[existingIndex] = {
          ...tracks[existingIndex]!,
          active_steps: expected.active_steps,
        };
      } else {
        tracks.push(track({
          track_id: `ideal-${index}`,
          name: 'Ideal',
          sample_id: expected.sample_id,
          step_count: expected.step_count ?? DEFAULT_STEP_COUNT,
          active_steps: expected.active_steps,
        }));
      }
    }
    return {
      ...start,
      tempo: evalCase.expectation.tempo ?? start.tempo,
      tracks,
    };
  }

  it('ships unique cases with valid, reachable objectives', () => {
    const ids = MCP_RHYTHM_EVAL_CASES.map(({ id }) => id);
    expect(MCP_RHYTHM_EVAL_CASES.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    for (const evalCase of MCP_RHYTHM_EVAL_CASES) {
      expect(validateMcpRhythmEvalCase(evalCase)).toEqual([]);
    }
  });

  it.each(MCP_RHYTHM_EVAL_CASES)('scores an ideal run of $id at 1', (evalCase) => {
    expect(scoreMcpRhythmResult(
      baselineFor(evalCase),
      idealResultFor(evalCase),
      evalCase.expectation
    ).score).toBe(1);
  });

  it.each(MCP_RHYTHM_EVAL_CASES)('scores an untouched session for $id at 0', (evalCase) => {
    expect(scoreMcpRhythmResult(
      baselineFor(evalCase),
      baselineFor(evalCase),
      evalCase.expectation
    ).score).toBe(0);
  });

  it('rejects an impossible existing-track step instead of certifying it', () => {
    const impossible: McpRhythmEvalCase = {
      id: 'impossible-step',
      prompt: 'Add step 12 to this eight-step track.',
      baseline: {
        tempo: 120,
        tracks: [track({
          track_id: 'short-track',
          step_count: 8,
          active_steps: [0, 4],
        })],
      },
      expectation: {
        tracks: [{
          target: 'existing',
          track_id: 'short-track',
          sample_id: 'hihat',
          active_steps: [0, 4, 12],
        }],
      },
    };

    expect(validateMcpRhythmEvalCase(impossible)).toContain(
      'Expectation 0 in impossible-step step 12 is outside its 8-step loop.'
    );
  });
});
