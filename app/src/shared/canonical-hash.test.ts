import { describe, expect, it } from 'vitest';
import { canonicalizeForHash } from './canonical-hash';

describe('canonicalizeForHash track normalization', () => {
  it('turns a legacy track into one explicit canonical shape', () => {
    const canonical = canonicalizeForHash({
      tracks: [{
        id: 'track-1',
        name: 'Kick',
        sampleId: 'kick',
        steps: [true, false],
        parameterLocks: [null],
        volume: 1,
        muted: true,
        soloed: true,
        playbackMode: 'deprecated',
        transpose: 0,
      }],
      tempo: 120,
      swing: 0,
    });

    expect(canonical.tracks[0]).toEqual({
      id: 'track-1',
      name: 'Kick',
      sampleId: 'kick',
      steps: [true, false, ...Array<boolean>(14).fill(false)],
      parameterLocks: Array<null>(16).fill(null),
      volume: 1,
      pan: 0,
      transpose: 0,
      stepCount: 16,
      swing: 0,
      fmParams: null,
      envelope: null,
      envelopeTimeUnit: 'seconds',
      envelopeV2: null,
      samplePlaybackMode: null,
      gate: 90,
    });
  });

  it('preserves authored sound fields and truncates storage beyond stepCount', () => {
    const canonical = canonicalizeForHash({
      tracks: [{
        id: 'track-1',
        name: 'Lead',
        sampleId: 'synth:lead',
        steps: [true, false, true, false, true, true],
        parameterLocks: [null, { pitch: 2 }, null, null, { pitch: 9 }, null],
        volume: 0.7,
        pan: -0.25,
        muted: false,
        transpose: 3,
        stepCount: 4,
        swing: 20,
        fmParams: { harmonicity: 2, modulationIndex: 3 },
        envelope: { attack: 0.1, decay: 0.2, sustain: 0.8, release: 0.5 },
        envelopeTimeUnit: 'steps',
        envelopeV2: {
          model: 'ar',
          attack: { value: 1, unit: 'steps' },
          release: { value: 0.5, unit: 'seconds' },
        },
        samplePlaybackMode: 'loop',
        gate: 65,
      }],
      tempo: 120,
      swing: 0,
    });

    expect(canonical.tracks[0]).toEqual({
      id: 'track-1',
      name: 'Lead',
      sampleId: 'synth:lead',
      steps: [true, false, true, false],
      parameterLocks: [null, { pitch: 2 }, null, null],
      volume: 0.7,
      pan: -0.25,
      transpose: 3,
      stepCount: 4,
      swing: 20,
      fmParams: { harmonicity: 2, modulationIndex: 3 },
      envelope: { attack: 0.1, decay: 0.2, sustain: 0.8, release: 0.5 },
      envelopeTimeUnit: 'steps',
      envelopeV2: {
        model: 'ar',
        attack: { value: 1, unit: 'steps' },
        release: { value: 0.5, unit: 'seconds' },
      },
      samplePlaybackMode: 'loop',
      gate: 65,
    });
  });
});
