import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveEnvelopeV2 } from '../shared/envelope-contract-v2';
import { serializeEnvelopeNotationStateV24 } from '../shared/session-notation-v24';
import type { SessionState } from '../shared/state';

const authoredState: SessionState = {
  tempo: 120,
  swing: 0,
  version: 1,
  tracks: [{
    id: 'headless-pad',
    name: 'Headless Pad',
    sampleId: 'advanced:warm-pad',
    steps: [true, false, false, false],
    parameterLocks: [
      { releaseDuration: { value: 0.3, unit: 'seconds' } },
      null,
      null,
      null,
    ],
    volume: 0.8,
    muted: false,
    soloed: false,
    transpose: 0,
    stepCount: 4,
    gate: 75,
    envelopeV2: {
      model: 'adsr',
      attack: { value: 0.01, unit: 'seconds' },
      decay: { value: 2, unit: 'steps' },
      sustain: 0.7,
      release: { value: 0.3, unit: 'seconds' },
    },
  }],
};

describe('headless envelope feature boundary', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('disables editor exposure without disabling runtime or notation semantics', async () => {
    vi.stubEnv('VITE_FEATURE_ENVELOPE_V2', 'false');
    vi.resetModules();
    const { features } = await import('./features');

    expect(features.envelopeV2).toBe(false);
    expect(resolveEnvelopeV2(authoredState.tracks[0]!.envelopeV2!, authoredState.tempo))
      .toEqual({
        model: 'adsr',
        attackSeconds: 0.01,
        decaySeconds: 0.25,
        sustain: 0.7,
        releaseSeconds: 0.3,
      });
    expect(serializeEnvelopeNotationStateV24(authoredState)).toContain(
      '[amp:adsr,10ms,2st,0.7,300ms] [gate:75%] [lock:1,release,300ms]',
    );
  });
});
