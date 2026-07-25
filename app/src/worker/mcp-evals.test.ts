import { describe, expect, it } from 'vitest';
import { VALID_SAMPLE_IDS } from '../components/sample-constants';
import { DEFAULT_STEP_COUNT, MAX_TEMPO, MIN_TEMPO } from '../shared/constants';
import type { CompactMcpSession, CompactMcpTrack } from './mcp-edits';
import {
  MCP_RHYTHM_EVAL_CASES,
  scoreMcpRhythmResult,
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
    step_count: 16,
    active_steps: [4, 12],
  }],
};

function track(overrides: Partial<CompactMcpTrack> & { track_id: string }): CompactMcpTrack {
  return {
    name: 'Hi-Hat',
    sample_id: 'hihat',
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

    expect(scoreMcpRhythmResult(baseline, result, {
      tracks: [{ sample_id: 'hihat', active_steps: [0, 2, 4, 6, 8, 10, 12, 14] }],
      preserve_track_ids: ['existing-snare'],
    })).toEqual({
      score: 1,
      components: {
        track_0_exists: 1,
        track_0_steps: 1,
        no_extra_tracks: 1,
        'preserve_existing-snare': 1,
      },
    });
  });

  it('penalizes erasing a collaborator even when the new rhythm is correct', () => {
    const result: CompactMcpSession = {
      ...baseline,
      tracks: [track({
        track_id: 'agent-hats',
        active_steps: [0, 2, 4, 6, 8, 10, 12, 14],
      })],
    };

    const scored = scoreMcpRhythmResult(baseline, result, {
      tracks: [{ sample_id: 'hihat', active_steps: [0, 2, 4, 6, 8, 10, 12, 14] }],
      preserve_track_ids: ['existing-snare'],
    });

    expect(scored.components['preserve_existing-snare']).toBe(0);
    expect(scored.score).toBeLessThan(1);
  });

  it('does not reward scattering near-miss duplicates so one of them lands', () => {
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
      tracks: [{ sample_id: 'hihat', active_steps: [0, 2, 4, 6, 8, 10, 12, 14] }],
      preserve_track_ids: ['existing-snare'],
    });

    // The exactly-correct attempt still claims its expectation...
    expect(scored.components.track_0_steps).toBe(1);
    // ...but the two abandoned attempts are litter, so the run is not perfect.
    expect(scored.components.no_extra_tracks).toBeCloseTo(1 / 3);
    expect(scored.score).toBeLessThan(1);
  });

  it('lets an expectation be met by correcting a track that already existed', () => {
    const corrected: CompactMcpSession = {
      ...baseline,
      tracks: [{ ...baseline.tracks[0]!, active_steps: [4, 12, 14] }],
    };

    const scored = scoreMcpRhythmResult(baseline, corrected, {
      tracks: [{ sample_id: 'snare', active_steps: [4, 12, 14] }],
    });

    expect(scored).toEqual({
      score: 1,
      components: { track_0_exists: 1, track_0_steps: 1, no_extra_tracks: 1 },
    });
  });
});

/**
 * The shipped fixtures are data, so nothing else would notice a typo'd
 * sample_id, an out-of-loop step, or an out-of-range tempo. Running each case
 * against an ideal result keeps them honest.
 */
describe('MCP rhythm eval cases', () => {
  function baselineFor(evalCase: McpRhythmEvalCase): CompactMcpSession {
    return {
      session_id: SESSION_ID,
      immutable: false,
      tempo: 120,
      tracks: (evalCase.expectation.preserve_track_ids ?? []).map((trackId) => track({
        track_id: trackId,
        name: 'Existing',
        sample_id: 'snare',
        active_steps: [4, 12],
      })),
    };
  }

  function idealResultFor(evalCase: McpRhythmEvalCase): CompactMcpSession {
    const start = baselineFor(evalCase);
    return {
      ...start,
      tempo: evalCase.expectation.tempo ?? start.tempo,
      tracks: [
        ...start.tracks,
        ...evalCase.expectation.tracks.map((expected, index) => track({
          track_id: `ideal-${index}`,
          name: 'Ideal',
          sample_id: expected.sample_id,
          active_steps: expected.active_steps,
        })),
      ],
    };
  }

  it('ships at least one case', () => {
    expect(MCP_RHYTHM_EVAL_CASES.length).toBeGreaterThan(0);
  });

  it('gives every case a unique id and a prompt', () => {
    const ids = MCP_RHYTHM_EVAL_CASES.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const { prompt } of MCP_RHYTHM_EVAL_CASES) {
      expect(prompt.trim().length).toBeGreaterThan(0);
    }
  });

  it.each(MCP_RHYTHM_EVAL_CASES)('states $id against the real contract', (evalCase) => {
    const { tempo, tracks } = evalCase.expectation;

    if (tempo !== undefined) {
      expect(tempo).toBeGreaterThanOrEqual(MIN_TEMPO);
      expect(tempo).toBeLessThanOrEqual(MAX_TEMPO);
    }

    expect(tracks.length).toBeGreaterThan(0);
    for (const expected of tracks) {
      expect(VALID_SAMPLE_IDS.has(expected.sample_id)).toBe(true);
      expect(expected.active_steps.length).toBeGreaterThan(0);
      expect(new Set(expected.active_steps).size).toBe(expected.active_steps.length);
      for (const step of expected.active_steps) {
        expect(Number.isInteger(step)).toBe(true);
        expect(step).toBeGreaterThanOrEqual(0);
        // set_steps cannot expand a loop, so a case demanding a step beyond the
        // default track length would be unachievable through the v1 surface.
        expect(step).toBeLessThan(DEFAULT_STEP_COUNT);
      }
    }
  });

  it.each(MCP_RHYTHM_EVAL_CASES)('scores an ideal run of $id at 1', (evalCase) => {
    expect(scoreMcpRhythmResult(
      baselineFor(evalCase),
      idealResultFor(evalCase),
      evalCase.expectation
    ).score).toBe(1);
  });

  it.each(MCP_RHYTHM_EVAL_CASES)('scores an untouched session for $id below 1', (evalCase) => {
    expect(scoreMcpRhythmResult(
      baselineFor(evalCase),
      baselineFor(evalCase),
      evalCase.expectation
    ).score).toBeLessThan(1);
  });
});
