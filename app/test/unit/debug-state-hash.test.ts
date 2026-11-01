import { describe, expect, it } from 'vitest';
import { computeNegotiatedHashCandidates } from '../../scripts/debug-state-hash';
import type { SessionState } from '../../src/shared/state';

const state: SessionState = {
  tracks: [{
    id: 'track-1',
    name: 'Envelope track',
    sampleId: 'tone:fm-bass',
    steps: [true],
    parameterLocks: [{ attackDuration: { value: 2, unit: 'steps' } }],
    volume: 1,
    muted: false,
    transpose: 0,
    stepCount: 1,
    fmParams: { harmonicity: 2, modulationIndex: 8 },
    envelope: { attack: 0.1, decay: 0.2, sustain: 0.5, release: 0.3 },
    envelopeTimeUnit: 'steps',
    envelopeV2: {
      model: 'ahd',
      attack: { value: 1, unit: 'steps' },
      hold: { value: 2, unit: 'steps' },
      decay: { value: 0.25, unit: 'seconds' },
    },
    samplePlaybackMode: 'loop',
    gate: 75,
  }],
  tempo: 120,
  swing: 0,
  version: 1,
};

describe('debug-state-hash negotiated projections', () => {
  it('reports every browser and Worker capability tier', () => {
    const candidates = computeNegotiatedHashCandidates(state);
    expect(candidates).toHaveLength(10);

    const hashesByLabel = new Map(candidates.map(({ label, hash }) => [label, hash]));
    const workerEnvelopeHashes = [
      hashesByLabel.get('Worker calculation: state-hash-v2, envelope v2'),
      hashesByLabel.get('Worker calculation: state-hash-v2, envelope v1'),
      hashesByLabel.get('Worker calculation: state-hash-v2, envelope pre-envelope'),
    ];

    expect(workerEnvelopeHashes.every(Boolean)).toBe(true);
    expect(new Set(workerEnvelopeHashes).size).toBe(3);
    expect(hashesByLabel.get('browser calculation: state-hash-v2, track-envelope-v2'))
      .toBe(hashesByLabel.get('Worker calculation: state-hash-v2, envelope v2'));
  });
});
