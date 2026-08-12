import { createInitialSessionState } from '../shared/session-defaults';
import type { ParameterLock } from '../shared/sync-types';
import type { SessionState, SessionTrack } from '../shared/state';

const STEPS = 16;

function track(
  id: string,
  name: string,
  sampleId: string,
  activeSteps: readonly number[],
  volume: number,
  locks: Readonly<Record<number, ParameterLock>> = {},
): SessionTrack {
  return {
    id,
    name,
    sampleId,
    steps: Array.from({ length: STEPS }, (_, index) => activeSteps.includes(index)),
    parameterLocks: Array.from({ length: STEPS }, (_, index) => locks[index] ? { ...locks[index] } : null),
    volume,
    pan: 0,
    muted: false,
    soloed: false,
    transpose: 0,
    stepCount: STEPS,
  };
}

/**
 * An explicit musical starting point, offered separately from the empty grid.
 * Every accent, pitch, level and timing choice is stored in session state.
 */
export function createStarterSessionState(): SessionState {
  return createInitialSessionState({
    tempo: 96,
    swing: 16,
    scale: { root: 'A', scaleId: 'minor-pentatonic', locked: true },
    tracks: [
      track('starter-kick', 'Acoustic Kick', 'sampled:acoustic-kick', [0, 4, 8, 11, 12], 0.85, {
        11: { volume: 0.72 },
      }),
      track('starter-snare', 'Acoustic Snare', 'sampled:acoustic-snare', [4, 12], 0.55),
      track('starter-hat', 'Acoustic Hat', 'sampled:acoustic-hihat-closed', [0, 2, 4, 6, 8, 10, 12, 14], 0.32, {
        2: { volume: 0.78 }, 6: { volume: 0.78 }, 10: { volume: 0.78 }, 14: { volume: 0.78 },
      }),
      track('starter-bass', 'Finger Bass', 'sampled:finger-bass', [0, 3, 6, 8, 11, 14], 0.52, {
        0: { pitch: -15 }, 3: { pitch: -10 }, 6: { pitch: -8 },
        8: { pitch: -15 }, 11: { pitch: -12 }, 14: { pitch: -10 },
      }),
      track('starter-pluck', 'Synth Pluck', 'synth:pluck', [2, 5, 7, 10, 13, 15], 0.36, {
        2: { pitch: -3 }, 5: { pitch: 0 }, 7: { pitch: 4 },
        10: { pitch: 7 }, 13: { pitch: 4 }, 15: { pitch: 0 },
      }),
    ],
  });
}
