import type { CompactMcpSession, CompactMcpTrack } from './mcp-domain';

export interface McpRhythmEvalExpectation {
  tempo?: number;
  tracks: Array<{
    sample_id: string;
    active_steps: number[];
  }>;
  preserve_track_ids?: string[];
}

export interface McpRhythmEvalCase {
  id: string;
  prompt: string;
  expectation: McpRhythmEvalExpectation;
}

export interface McpRhythmEvalScore {
  score: number;
  components: Record<string, number>;
}

export const MCP_RHYTHM_EVAL_CASES: McpRhythmEvalCase[] = [
  {
    id: 'four-on-the-floor',
    prompt: 'Add a kick playing four on the floor at 124 BPM.',
    expectation: {
      tempo: 124,
      tracks: [{ sample_id: 'kick', active_steps: [0, 4, 8, 12] }],
    },
  },
  {
    id: 'add-without-erasing',
    prompt: 'Keep the existing snare exactly as it is and add closed hi-hats on every even step.',
    expectation: {
      tracks: [{ sample_id: 'hihat', active_steps: [0, 2, 4, 6, 8, 10, 12, 14] }],
      preserve_track_ids: ['existing-snare'],
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

/**
 * Scores the final get_session result from an agent run. Preservation is a
 * first-class component, so replacing another collaborator's work cannot
 * receive a perfect musical score.
 */
export function scoreMcpRhythmResult(
  baseline: CompactMcpSession,
  result: CompactMcpSession,
  expectation: McpRhythmEvalExpectation
): McpRhythmEvalScore {
  const components: Record<string, number> = {};

  if (expectation.tempo !== undefined) {
    components.tempo = result.tempo === expectation.tempo ? 1 : 0;
  }

  expectation.tracks.forEach((expected, index) => {
    const candidates = result.tracks.filter((track) => track.sample_id === expected.sample_id);
    components[`track_${index}_exists`] = candidates.length > 0 ? 1 : 0;
    components[`track_${index}_steps`] = candidates.reduce(
      (best, actual) => Math.max(best, setF1(expected.active_steps, actual.active_steps)),
      0
    );
  });

  for (const trackId of expectation.preserve_track_ids ?? []) {
    const before = baseline.tracks.find((track) => track.track_id === trackId);
    const after = result.tracks.find((track) => track.track_id === trackId);
    components[`preserve_${trackId}`] = sameTrack(before, after) ? 1 : 0;
  }

  const values = Object.values(components);
  return {
    score: values.length === 0
      ? 1
      : values.reduce((total, value) => total + value, 0) / values.length,
    components,
  };
}
