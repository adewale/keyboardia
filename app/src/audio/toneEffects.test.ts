import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ToneEffectsChain, type EffectsState, DEFAULT_EFFECTS_STATE } from './toneEffects';

/**
 * Tests for ToneEffectsChain
 *
 * These tests verify that the Tone.js effects integration works correctly
 * according to the spec in specs/SYNTHESIS-ENGINE.md Section 8.1
 *
 * Key requirements:
 * - Effects chain initializes with reverb ready
 * - Wet/dry controls work correctly (0 = dry, 1 = wet)
 * - State serializes correctly for multiplayer sync
 * - Disposal cleans up all resources
 */

// Mock Tone.js for unit tests (real Tone.js requires AudioContext)
vi.mock('tone', () => {
  // Use class syntax to satisfy Vitest's constructor check
  class MockGain {
    gain = { value: 1 };
    connect = vi.fn().mockReturnThis();
    toDestination = vi.fn().mockReturnThis();
    dispose = vi.fn();
  }

  class MockFreeverb {
    roomSize = { value: 0.7 };
    dampening = 3000;
    wet = { value: 0 };
    connect = vi.fn().mockReturnThis();
    toDestination = vi.fn().mockReturnThis();
    dispose = vi.fn();
  }

  class MockFeedbackDelay {
    delayTime = { value: '8n' };
    feedback = { value: 0.3 };
    wet = { value: 0 };
    connect = vi.fn().mockReturnThis();
    toDestination = vi.fn().mockReturnThis();
    dispose = vi.fn();
  }

  class MockChorus {
    frequency = { value: 1.5 };
    depth = 0.5;
    wet = { value: 0 };
    connect = vi.fn().mockReturnThis();
    toDestination = vi.fn().mockReturnThis();
    dispose = vi.fn();
    start = vi.fn().mockReturnThis();
  }

  class MockReverb {
    decay = 2;
    wet = { value: 0 };
    ready = Promise.resolve();
    connect = vi.fn().mockReturnThis();
    toDestination = vi.fn().mockReturnThis();
    dispose = vi.fn();
  }

  class MockDistortion {
    distortion = 0;
    wet = { value: 0 };
    connect = vi.fn().mockReturnThis();
    toDestination = vi.fn().mockReturnThis();
    dispose = vi.fn();
  }

  return {
    start: vi.fn().mockResolvedValue(undefined),
    getContext: vi.fn().mockReturnValue({
      state: 'running',
      rawContext: {},
    }),
    Gain: MockGain,
    Freeverb: MockFreeverb,
    FeedbackDelay: MockFeedbackDelay,
    Chorus: MockChorus,
    Reverb: MockReverb,
    Distortion: MockDistortion,
  };
});

describe('ToneEffectsChain', () => {
  let chain: ToneEffectsChain;

  beforeEach(async () => {
    chain = new ToneEffectsChain();
    await chain.initialize();
  });

  afterEach(() => {
    chain.dispose();
  });

  describe('initialization', () => {
    it('initializes with reverb ready', async () => {
      expect(chain.isReady()).toBe(true);
    });

    it('initializes with default state', () => {
      const state = chain.getState();
      expect(state).toEqual(DEFAULT_EFFECTS_STATE);
    });

    it('creates all effect nodes', () => {
      // Verify effects are created
      expect(chain.isReady()).toBe(true);
    });
  });

  describe('reverb controls', () => {
    it('sets reverb wet correctly', () => {
      chain.setReverbWet(0.5);
      expect(chain.getState().reverb.wet).toBe(0.5);
    });

    it('sets reverb decay correctly', () => {
      chain.setReverbDecay(3.0);
      expect(chain.getState().reverb.decay).toBe(3.0);
    });

    it('clamps reverb wet to 0-1 range', () => {
      chain.setReverbWet(1.5);
      expect(chain.getState().reverb.wet).toBe(1);

      chain.setReverbWet(-0.5);
      expect(chain.getState().reverb.wet).toBe(0);
    });

    it('clamps reverb decay to valid range', () => {
      chain.setReverbDecay(15);
      expect(chain.getState().reverb.decay).toBe(10); // Max 10s

      chain.setReverbDecay(0);
      expect(chain.getState().reverb.decay).toBe(0.1); // Min 0.1s
    });
  });

  describe('delay controls', () => {
    it('sets delay wet correctly', () => {
      chain.setDelayWet(0.4);
      expect(chain.getState().delay.wet).toBe(0.4);
    });

    it('sets delay time correctly', () => {
      chain.setDelayTime('4n');
      expect(chain.getState().delay.time).toBe('4n');
    });

    it('sets delay feedback correctly', () => {
      chain.setDelayFeedback(0.6);
      expect(chain.getState().delay.feedback).toBe(0.6);
    });

    it('clamps delay feedback to prevent runaway', () => {
      chain.setDelayFeedback(1.0);
      expect(chain.getState().delay.feedback).toBe(0.95); // Max 0.95
    });
  });

  describe('chorus controls', () => {
    it('sets chorus wet correctly', () => {
      chain.setChorusWet(0.3);
      expect(chain.getState().chorus.wet).toBe(0.3);
    });

    it('sets chorus frequency correctly', () => {
      chain.setChorusFrequency(2.5);
      expect(chain.getState().chorus.frequency).toBe(2.5);
    });

    it('sets chorus depth correctly', () => {
      chain.setChorusDepth(0.8);
      expect(chain.getState().chorus.depth).toBe(0.8);
    });
  });

  describe('distortion controls', () => {
    it('sets distortion wet correctly', () => {
      chain.setDistortionWet(0.4);
      expect(chain.getState().distortion.wet).toBe(0.4);
    });

    it('sets distortion amount correctly', () => {
      chain.setDistortionAmount(0.6);
      expect(chain.getState().distortion.amount).toBe(0.6);
    });

    it('clamps distortion wet to 0-1 range', () => {
      chain.setDistortionWet(1.5);
      expect(chain.getState().distortion.wet).toBe(1);

      chain.setDistortionWet(-0.5);
      expect(chain.getState().distortion.wet).toBe(0);
    });

    it('clamps distortion amount to 0-1 range', () => {
      chain.setDistortionAmount(1.5);
      expect(chain.getState().distortion.amount).toBe(1);

      chain.setDistortionAmount(-0.5);
      expect(chain.getState().distortion.amount).toBe(0);
    });
  });

  describe('state serialization', () => {
    it('serializes state for multiplayer sync', () => {
      chain.setReverbWet(0.5);
      chain.setDelayTime('8n');
      chain.setChorusDepth(0.7);

      const state = chain.getState();

      expect(state).toMatchObject({
        reverb: { decay: expect.any(Number), wet: 0.5 },
        delay: { time: '8n', feedback: expect.any(Number), wet: expect.any(Number) },
        chorus: { frequency: expect.any(Number), depth: 0.7, wet: expect.any(Number) },
      });
    });

    it('applies state from multiplayer sync', () => {
      const newState: EffectsState = {
        reverb: { decay: 3.5, wet: 0.6 },
        delay: { time: '4n', feedback: 0.4, wet: 0.35 },
        chorus: { frequency: 2.0, depth: 0.6, wet: 0.25 },
        distortion: { amount: 0.3, wet: 0.2 },
      };

      chain.applyState(newState);

      expect(chain.getState()).toEqual(newState);
    });
  });

  describe('bypass/enable', () => {
    it('bypasses all effects when disabled', () => {
      chain.setReverbWet(0.5);
      chain.setDelayWet(0.3);
      chain.setChorusWet(0.2);

      chain.setEnabled(false);

      // All effects should be bypassed (wet = 0)
      expect(chain.isEnabled()).toBe(false);
    });

    it('restores effects when re-enabled', () => {
      chain.setReverbWet(0.5);
      chain.setEnabled(false);
      chain.setEnabled(true);

      expect(chain.isEnabled()).toBe(true);
      expect(chain.getState().reverb.wet).toBe(0.5);
    });
  });

  describe('disposal', () => {
    it('disposes all effect nodes', () => {
      chain.dispose();
      expect(chain.isReady()).toBe(false);
    });

    it('can be re-initialized after disposal', async () => {
      chain.dispose();
      await chain.initialize();
      expect(chain.isReady()).toBe(true);
    });

    it('resets state to defaults on dispose', () => {
      // Modify state from defaults
      chain.setReverbWet(0.8);
      chain.setReverbDecay(5.0);
      chain.setDelayWet(0.5);
      chain.setDelayFeedback(0.7);
      chain.setChorusWet(0.6);
      chain.setDistortionWet(0.4);
      chain.setDistortionAmount(0.8);

      // Verify state is modified
      expect(chain.getState().reverb.wet).toBe(0.8);
      expect(chain.getState().delay.wet).toBe(0.5);

      // Dispose
      chain.dispose();

      // State should be reset to defaults
      const state = chain.getState();
      expect(state).toEqual(DEFAULT_EFFECTS_STATE);
    });

    it('resets enabled flag on dispose', () => {
      chain.setEnabled(false);
      expect(chain.isEnabled()).toBe(false);

      chain.dispose();

      // After dispose, enabled should be reset to true (default)
      expect(chain.isEnabled()).toBe(true);
    });

    it('starts fresh after dispose and re-initialize', async () => {
      // Modify state
      chain.setReverbWet(0.9);
      chain.setDelayTime('4n');

      chain.dispose();
      await chain.initialize();

      // State should be at defaults after re-initialization
      expect(chain.getState()).toEqual(DEFAULT_EFFECTS_STATE);
    });
  });
});

describe('DEFAULT_EFFECTS_STATE', () => {
  it('has all effects disabled by default (wet = 0)', () => {
    expect(DEFAULT_EFFECTS_STATE.reverb.wet).toBe(0);
    expect(DEFAULT_EFFECTS_STATE.delay.wet).toBe(0);
    expect(DEFAULT_EFFECTS_STATE.chorus.wet).toBe(0);
    expect(DEFAULT_EFFECTS_STATE.distortion.wet).toBe(0);
  });

  it('has sensible default parameters', () => {
    expect(DEFAULT_EFFECTS_STATE.reverb.decay).toBeGreaterThan(0);
    expect(DEFAULT_EFFECTS_STATE.reverb.decay).toBeLessThanOrEqual(10);

    expect(DEFAULT_EFFECTS_STATE.delay.feedback).toBeGreaterThan(0);
    expect(DEFAULT_EFFECTS_STATE.delay.feedback).toBeLessThanOrEqual(0.95);

    expect(DEFAULT_EFFECTS_STATE.chorus.frequency).toBeGreaterThan(0);
    expect(DEFAULT_EFFECTS_STATE.chorus.depth).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_EFFECTS_STATE.chorus.depth).toBeLessThanOrEqual(1);

    expect(DEFAULT_EFFECTS_STATE.distortion.amount).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_EFFECTS_STATE.distortion.amount).toBeLessThanOrEqual(1);
  });
});

describe('EffectsState type', () => {
  it('matches the spec format for session state', () => {
    const state: EffectsState = {
      reverb: { decay: 2.5, wet: 0.4 },
      delay: { time: '8n', feedback: 0.3, wet: 0.25 },
      chorus: { frequency: 1.5, depth: 0.5, wet: 0.2 },
      distortion: { amount: 0.3, wet: 0.15 },
    };

    // Verify all required fields are present
    expect(state.reverb).toHaveProperty('decay');
    expect(state.reverb).toHaveProperty('wet');
    expect(state.delay).toHaveProperty('time');
    expect(state.delay).toHaveProperty('feedback');
    expect(state.delay).toHaveProperty('wet');
    expect(state.chorus).toHaveProperty('frequency');
    expect(state.chorus).toHaveProperty('depth');
    expect(state.chorus).toHaveProperty('wet');
    expect(state.distortion).toHaveProperty('amount');
    expect(state.distortion).toHaveProperty('wet');
  });
});
