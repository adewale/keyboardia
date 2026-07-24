import { describe, expect, it } from 'vitest';
import type { CompactMcpSession } from './mcp-domain';
import { scoreMcpRhythmResult } from './mcp-evals';

const baseline: CompactMcpSession = {
  session_id: '00000000-0000-4000-8000-000000000001',
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

describe('MCP rhythm eval scorer', () => {
  it('gives a perfect score to a correct additive edit', () => {
    const result: CompactMcpSession = {
      ...baseline,
      tracks: [
        ...baseline.tracks,
        {
          track_id: 'agent-hats',
          name: 'Hi-Hat',
          sample_id: 'hihat',
          step_count: 16,
          active_steps: [0, 2, 4, 6, 8, 10, 12, 14],
        },
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
        'preserve_existing-snare': 1,
      },
    });
  });

  it('penalizes erasing a collaborator even when the new rhythm is correct', () => {
    const result: CompactMcpSession = {
      ...baseline,
      tracks: [{
        track_id: 'agent-hats',
        name: 'Hi-Hat',
        sample_id: 'hihat',
        step_count: 16,
        active_steps: [0, 2, 4, 6, 8, 10, 12, 14],
      }],
    };

    const scored = scoreMcpRhythmResult(baseline, result, {
      tracks: [{ sample_id: 'hihat', active_steps: [0, 2, 4, 6, 8, 10, 12, 14] }],
      preserve_track_ids: ['existing-snare'],
    });

    expect(scored.components['preserve_existing-snare']).toBe(0);
    expect(scored.score).toBeLessThan(1);
  });
});
