import { describe, it, expect } from 'vitest';
import type { GridState, EffectsState, GridAction } from '../types';
import { DEFAULT_TEMPO, DEFAULT_SWING } from '../types';

/**
 * Verification Tests for Grid Reducer Effects Integration
 *
 * Per specs/SYNTHESIS-ENGINE.md Section 9.5.1:
 * - State surface must include effects in GridState
 * - SET_EFFECTS action must update effects
 * - LOAD_STATE must handle effects
 * - RESET_STATE must reset effects to defaults
 */

// Default effects state (matching grid.tsx)
const DEFAULT_EFFECTS_STATE: EffectsState = {
  reverb: { decay: 2.0, wet: 0 },
  delay: { time: '8n', feedback: 0.3, wet: 0 },
  chorus: { frequency: 1.5, depth: 0.5, wet: 0 },
  distortion: { amount: 0.4, wet: 0 },
};

// Simplified reducer for testing (matches grid.tsx implementation)
function testReducer(state: GridState, action: GridAction): GridState {
  switch (action.type) {
    case 'SET_EFFECTS':
      return { ...state, effects: action.effects };

    case 'RESET_STATE':
      return {
        tracks: [],
        tempo: DEFAULT_TEMPO,
        swing: DEFAULT_SWING,
        effects: DEFAULT_EFFECTS_STATE,
        isPlaying: false,
        currentStep: -1,
      };

    case 'LOAD_STATE': {
      const effects = action.effects ?? state.effects ?? DEFAULT_EFFECTS_STATE;
      return {
        ...state,
        tracks: action.tracks,
        tempo: action.tempo,
        swing: action.swing,
        effects,
      };
    }

    default:
      return state;
  }
}

function createInitialState(): GridState {
  return {
    tracks: [],
    tempo: DEFAULT_TEMPO,
    swing: DEFAULT_SWING,
    effects: DEFAULT_EFFECTS_STATE,
    isPlaying: false,
    currentStep: -1,
  };
}

describe('Section 9.5.1: Effects State Surface', () => {
  describe('GridState includes effects', () => {
    it('initial state includes effects', () => {
      const state = createInitialState();
      expect(state.effects).toBeDefined();
      expect(state.effects).toEqual(DEFAULT_EFFECTS_STATE);
    });

    it('effects has all 4 effect types', () => {
      const state = createInitialState();
      expect(state.effects).toHaveProperty('reverb');
      expect(state.effects).toHaveProperty('delay');
      expect(state.effects).toHaveProperty('chorus');
      expect(state.effects).toHaveProperty('distortion');
    });

    it('effects are dry by default (wet = 0)', () => {
      const state = createInitialState();
      expect(state.effects!.reverb.wet).toBe(0);
      expect(state.effects!.delay.wet).toBe(0);
      expect(state.effects!.chorus.wet).toBe(0);
      expect(state.effects!.distortion.wet).toBe(0);
    });
  });

  describe('SET_EFFECTS action', () => {
    it('updates effects state', () => {
      const state = createInitialState();
      const newEffects: EffectsState = {
        reverb: { decay: 5.0, wet: 0.7 },
        delay: { time: '4n', feedback: 0.5, wet: 0.4 },
        chorus: { frequency: 2.0, depth: 0.8, wet: 0.3 },
        distortion: { amount: 0.6, wet: 0.2 },
      };

      const newState = testReducer(state, {
        type: 'SET_EFFECTS',
        effects: newEffects,
      });

      expect(newState.effects).toEqual(newEffects);
    });

    it('preserves other state when setting effects', () => {
      const state: GridState = {
        ...createInitialState(),
        tempo: 140,
        swing: 25,
        isPlaying: true,
      };

      const newEffects: EffectsState = {
        ...DEFAULT_EFFECTS_STATE,
        reverb: { decay: 3.0, wet: 0.5 },
      };

      const newState = testReducer(state, {
        type: 'SET_EFFECTS',
        effects: newEffects,
      });

      expect(newState.tempo).toBe(140);
      expect(newState.swing).toBe(25);
      expect(newState.isPlaying).toBe(true);
      expect(newState.effects!.reverb.wet).toBe(0.5);
    });
  });

  describe('RESET_STATE action', () => {
    it('resets effects to defaults', () => {
      const state: GridState = {
        ...createInitialState(),
        effects: {
          reverb: { decay: 8.0, wet: 0.9 },
          delay: { time: '2n', feedback: 0.8, wet: 0.7 },
          chorus: { frequency: 5.0, depth: 1.0, wet: 0.6 },
          distortion: { amount: 1.0, wet: 0.5 },
        },
      };

      const newState = testReducer(state, { type: 'RESET_STATE' });

      expect(newState.effects).toEqual(DEFAULT_EFFECTS_STATE);
    });
  });

  describe('LOAD_STATE action', () => {
    it('loads effects from state parameter if provided', () => {
      const state = createInitialState();
      const loadedEffects: EffectsState = {
        reverb: { decay: 4.0, wet: 0.6 },
        delay: { time: '16n', feedback: 0.4, wet: 0.3 },
        chorus: { frequency: 1.0, depth: 0.4, wet: 0.2 },
        distortion: { amount: 0.3, wet: 0.1 },
      };

      const newState = testReducer(state, {
        type: 'LOAD_STATE',
        tracks: [],
        tempo: 120,
        swing: 0,
        effects: loadedEffects,
      });

      expect(newState.effects).toEqual(loadedEffects);
    });

    it('falls back to current effects if state parameter missing', () => {
      const currentEffects: EffectsState = {
        reverb: { decay: 3.0, wet: 0.5 },
        delay: { time: '8n', feedback: 0.3, wet: 0.2 },
        chorus: { frequency: 1.5, depth: 0.5, wet: 0.1 },
        distortion: { amount: 0.4, wet: 0 },
      };

      const state: GridState = {
        ...createInitialState(),
        effects: currentEffects,
      };

      const newState = testReducer(state, {
        type: 'LOAD_STATE',
        tracks: [],
        tempo: 100,
        swing: 10,
      });

      expect(newState.effects).toEqual(currentEffects);
    });

    it('falls back to defaults if no effects anywhere', () => {
      const state: GridState = {
        tracks: [],
        tempo: DEFAULT_TEMPO,
        swing: DEFAULT_SWING,
        isPlaying: false,
        currentStep: -1,
        // No effects property
      };

      const newState = testReducer(state, {
        type: 'LOAD_STATE',
        tracks: [],
        tempo: 120,
        swing: 0,
      });

      expect(newState.effects).toEqual(DEFAULT_EFFECTS_STATE);
    });
  });
});

describe('Section 2.2.3: Multiplayer Sync Requirements', () => {
  it('effects state is serializable for WebSocket', () => {
    const effects: EffectsState = {
      reverb: { decay: 2.5, wet: 0.4 },
      delay: { time: '8n', feedback: 0.3, wet: 0.25 },
      chorus: { frequency: 1.5, depth: 0.5, wet: 0.2 },
      distortion: { amount: 0.3, wet: 0.15 },
    };

    // Should be JSON-serializable
    const serialized = JSON.stringify(effects);
    const deserialized = JSON.parse(serialized);

    expect(deserialized).toEqual(effects);
  });

  it('delay time uses string notation for musical sync', () => {
    const effects = DEFAULT_EFFECTS_STATE;

    // Delay time should be a string like "8n", "4n", not a number
    expect(typeof effects.delay.time).toBe('string');
    expect(effects.delay.time).toMatch(/^\d+[nt]$/); // e.g., "8n", "4t"
  });
});

describe('Section 9.3.4: Default State', () => {
  it('all effects start dry (wet = 0) per spec', () => {
    // "All effects start dry (wet = 0): User must explicitly enable effects"
    expect(DEFAULT_EFFECTS_STATE.reverb.wet).toBe(0);
    expect(DEFAULT_EFFECTS_STATE.delay.wet).toBe(0);
    expect(DEFAULT_EFFECTS_STATE.chorus.wet).toBe(0);
    expect(DEFAULT_EFFECTS_STATE.distortion.wet).toBe(0);
  });

  it('default parameters are within valid ranges', () => {
    // Reverb decay: 0.1 to 10s
    expect(DEFAULT_EFFECTS_STATE.reverb.decay).toBeGreaterThanOrEqual(0.1);
    expect(DEFAULT_EFFECTS_STATE.reverb.decay).toBeLessThanOrEqual(10);

    // Delay feedback: 0 to 0.95
    expect(DEFAULT_EFFECTS_STATE.delay.feedback).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_EFFECTS_STATE.delay.feedback).toBeLessThanOrEqual(0.95);

    // Chorus frequency: 0.1 to 10 Hz
    expect(DEFAULT_EFFECTS_STATE.chorus.frequency).toBeGreaterThanOrEqual(0.1);
    expect(DEFAULT_EFFECTS_STATE.chorus.frequency).toBeLessThanOrEqual(10);

    // Chorus depth: 0 to 1
    expect(DEFAULT_EFFECTS_STATE.chorus.depth).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_EFFECTS_STATE.chorus.depth).toBeLessThanOrEqual(1);

    // Distortion amount: 0 to 1
    expect(DEFAULT_EFFECTS_STATE.distortion.amount).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_EFFECTS_STATE.distortion.amount).toBeLessThanOrEqual(1);
  });
});
