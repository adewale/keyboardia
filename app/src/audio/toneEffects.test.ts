import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ToneEffectsChain,
  type EffectsState,
  DEFAULT_EFFECTS_STATE,
  musicalTimeToSeconds,
} from './toneEffects';
import { MIN_TEMPO } from '../shared/constants';
import {
  MASTER_COMPRESSOR_SETTINGS,
  MASTER_LIMITER_THRESHOLD_DB,
  MASTER_MAKEUP_GAIN,
  MASTER_OUTPUT_TRIM,
  REVERB_PREDELAY_SECONDS,
  REVERB_SEND_HIGHPASS_HZ,
} from './constants';

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
  const automatable = (initial: number) => {
    const param = {
      value: initial,
      cancelScheduledValues: vi.fn(),
      setTargetAtTime: vi.fn((value: number) => { param.value = value; }),
    };
    return param;
  };

  // Use class syntax to satisfy Vitest's constructor check
  class MockGain {
    gain: ReturnType<typeof automatable>;
    connect = vi.fn().mockReturnThis();
    toDestination = vi.fn().mockReturnThis();
    dispose = vi.fn();
    constructor(value = 1) {
      this.gain = automatable(value);
    }
  }

  class MockCompressor {
    options: typeof MASTER_COMPRESSOR_SETTINGS;
    connect = vi.fn().mockReturnThis();
    dispose = vi.fn();
    constructor(options: typeof MASTER_COMPRESSOR_SETTINGS) {
      this.options = options;
    }
  }

  class MockFilter {
    frequency: number;
    type: string;
    connect = vi.fn().mockReturnThis();
    disconnect = vi.fn().mockReturnThis();
    dispose = vi.fn();
    constructor(frequency: number, type: string) {
      this.frequency = frequency;
      this.type = type;
    }
  }

  class MockFreeverb {
    roomSize: ReturnType<typeof automatable>;
    dampening: number;
    wet = automatable(0);
    connect = vi.fn().mockReturnThis();
    disconnect = vi.fn().mockReturnThis();
    toDestination = vi.fn().mockReturnThis();
    dispose = vi.fn();
    constructor(options: { roomSize: number; dampening: number }) {
      this.roomSize = automatable(options.roomSize);
      this.dampening = options.dampening;
    }
  }

  class MockFeedbackDelay {
    delayTime = automatable(0);
    feedback = automatable(0);
    wet = automatable(0);
    maxDelay: number;
    connect = vi.fn().mockReturnThis();
    toDestination = vi.fn().mockReturnThis();
    dispose = vi.fn();
    constructor(options: { delayTime: number; feedback: number; maxDelay: number }) {
      this.delayTime.value = options.delayTime;
      this.feedback.value = options.feedback;
      this.maxDelay = options.maxDelay;
    }
  }

  class MockChorus {
    frequency = automatable(1.5);
    depth = 0.5;
    wet = automatable(0);
    connect = vi.fn().mockReturnThis();
    toDestination = vi.fn().mockReturnThis();
    dispose = vi.fn();
    start = vi.fn().mockReturnThis();
  }

  class MockReverb {
    decay: number;
    preDelay: number;
    wet = automatable(0);
    ready = Promise.resolve();
    connect = vi.fn().mockReturnThis();
    disconnect = vi.fn().mockReturnThis();
    toDestination = vi.fn().mockReturnThis();
    dispose = vi.fn();
    constructor(options: { decay: number; preDelay: number; wet: number }) {
      this.decay = options.decay;
      this.preDelay = options.preDelay;
      this.wet.value = options.wet;
    }
  }

  class MockDistortion {
    distortion = 0;
    wet = automatable(0);
    connect = vi.fn().mockReturnThis();
    toDestination = vi.fn().mockReturnThis();
    dispose = vi.fn();
  }

  class MockLimiter {
    threshold: { value: number };
    connect = vi.fn().mockReturnThis();
    toDestination = vi.fn().mockReturnThis();
    dispose = vi.fn();
    constructor(threshold = -1) {
      this.threshold = { value: threshold };
    }
  }

  return {
    start: vi.fn().mockResolvedValue(undefined),
    getContext: vi.fn().mockReturnValue({
      state: 'running',
      rawContext: {},
    }),
    now: vi.fn().mockReturnValue(0),
    Gain: MockGain,
    Compressor: MockCompressor,
    Filter: MockFilter,
    Freeverb: MockFreeverb,
    FeedbackDelay: MockFeedbackDelay,
    Chorus: MockChorus,
    Reverb: MockReverb,
    Distortion: MockDistortion,
    Limiter: MockLimiter,
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

    it('hot-swaps the instant room for a fully-wet convolution reverb', async () => {
      await vi.waitFor(() => {
        expect(chain['reverb']).toBe(chain['convolutionReverb']);
      });
      const room = chain['convolutionReverb'];
      expect(room?.decay).toBe(DEFAULT_EFFECTS_STATE.reverb.decay);
      expect(room?.preDelay).toBe(REVERB_PREDELAY_SECONDS);
      expect(room?.wet.value).toBe(1);
    });

    it('initializes with default state', () => {
      const state = chain.getState();
      expect(state).toEqual(DEFAULT_EFFECTS_STATE);
    });

    it('creates all effect nodes', () => {
      // Verify effects are created
      expect(chain.isReady()).toBe(true);
    });

    it('keeps dynamics in the active Tone path and uses a parallel high-passed reverb', () => {
      const input = chain['input'];
      const compressor = chain['compressor'];
      const makeupTrim = chain['makeupTrim'];
      const distortion = chain['distortion'];
      const chorus = chain['chorus'];
      const delay = chain['delay'];
      const highpass = chain['reverbHighpass'];
      const reverb = chain['reverb'];
      const wetGain = chain['reverbWetGain'];
      const limiter = chain['limiter'];
      const outputTrim = chain['outputTrim'];

      expect((compressor as unknown as { options: typeof MASTER_COMPRESSOR_SETTINGS } | null)?.options)
        .toEqual(MASTER_COMPRESSOR_SETTINGS);
      expect(makeupTrim?.gain.value).toBe(MASTER_MAKEUP_GAIN);
      expect(highpass?.['frequency']).toBe(REVERB_SEND_HIGHPASS_HZ);
      expect(highpass?.['type']).toBe('highpass');
      expect(limiter?.threshold.value).toBe(MASTER_LIMITER_THRESHOLD_DB);
      expect(outputTrim?.gain.value).toBe(MASTER_OUTPUT_TRIM);
      expect(input?.connect).toHaveBeenCalledWith(compressor);
      expect(compressor?.connect).toHaveBeenCalledWith(makeupTrim);
      expect(makeupTrim?.connect).toHaveBeenCalledWith(distortion);
      expect(distortion?.connect).toHaveBeenCalledWith(chorus);
      expect(chorus?.connect).toHaveBeenCalledWith(delay);
      expect(delay?.connect).toHaveBeenCalledWith(limiter);
      expect(delay?.connect).toHaveBeenCalledWith(highpass);
      expect(highpass?.connect).toHaveBeenCalledWith(reverb);
      expect(reverb?.connect).toHaveBeenCalledWith(wetGain);
      expect(wetGain?.connect).toHaveBeenCalledWith(limiter);
      expect(limiter?.connect).toHaveBeenCalledWith(outputTrim);
      expect(outputTrim?.toDestination).toHaveBeenCalled();
    });

    it('terminates at an explicit mobile media node instead of Tone destination', async () => {
      chain.dispose();
      const destination = {} as AudioNode;
      await chain.initialize(destination);

      expect(chain['outputTrim']?.connect).toHaveBeenCalledWith(destination);
      expect(chain['outputTrim']?.toDestination).not.toHaveBeenCalled();
    });
  });

  describe('reverb controls', () => {
    it('sets reverb wet correctly', () => {
      chain.setReverbWet(0.5);
      expect(chain.getState().reverb.wet).toBe(0.5);
      expect(chain['reverbWetGain']?.gain.setTargetAtTime).toHaveBeenLastCalledWith(0.5, 0, 0.04);
    });

    it('sets convolution reverb decay correctly', async () => {
      await vi.waitFor(() => expect(chain['convolutionReverb']).toBe(chain['reverb']));
      chain.setReverbDecay(3.0);
      expect(chain.getState().reverb.decay).toBe(3.0);
      expect(chain['convolutionReverb']?.decay).toBe(3);
    });

    it('initializes a fully-wet parallel room with the persisted wet return gain', async () => {
      await vi.waitFor(() => expect(chain['convolutionReverb']).toBe(chain['reverb']));
      expect(chain['reverb']?.wet.value).toBe(1);
      expect(chain['reverbWetGain']?.gain.value).toBe(DEFAULT_EFFECTS_STATE.reverb.wet);
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
    it.each([
      ['4n', 120, 0.5],
      ['8n', 120, 0.25],
      ['8n', 60, 0.5],
      ['8n', 180, 1 / 6],
      ['8t', 120, 1 / 6],
      ['1m', 120, 2],
    ] as const)('converts %s at %i BPM to %f seconds', (notation, bpm, expected) => {
      expect(musicalTimeToSeconds(notation, bpm)).toBeCloseTo(expected, 10);
    });

    it('initializes notation using Keyboardia tempo with headroom for slow measures', () => {
      const delay = chain['delay'] as (NonNullable<typeof chain['delay']> & { maxDelay: number });
      expect(delay.delayTime.value).toBeCloseTo(0.25, 10);
      expect(delay.maxDelay).toBeGreaterThanOrEqual(musicalTimeToSeconds('4m', MIN_TEMPO));
    });

    it('recomputes the active musical delay when tempo changes', () => {
      chain.setDelayTime('8n');
      chain.setTempo(60);

      const delay = chain['delay'];
      expect(delay?.delayTime.value).toBeCloseTo(0.5, 10);

      chain.setTempo(180);
      expect(delay?.delayTime.value).toBeCloseTo(1 / 6, 10);
      expect(chain.getState().delay.time).toBe('8n');
    });

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
        bypass: false,  // Include bypass in test state
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
  it('opens a restrained room by default while creative effects remain dry', () => {
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
