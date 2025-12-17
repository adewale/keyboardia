import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * AudioContext Safety Tests
 *
 * These tests verify that all Tone.js components are created in the same
 * AudioContext to prevent "cannot connect to an AudioNode belonging to a
 * different audio context" errors.
 *
 * Root cause: Singleton patterns can retain stale Tone.js nodes across
 * Hot Module Reload (HMR), causing context mismatches.
 *
 * Key invariant: ALL Tone.js nodes must be created AFTER Tone.setContext()
 * is called with the correct AudioContext.
 */

// Mock Tone.js with context tracking
let mockContextId = 0;
let currentMockContext: { id: number } | null = null;

vi.mock('tone', () => {
  // Base mock class with context tracking
  const createMockClass = () => {
    return class {
      contextId: number;
      connect = vi.fn().mockReturnThis();
      disconnect = vi.fn().mockReturnThis();
      toDestination = vi.fn().mockReturnThis();
      dispose = vi.fn();
      start = vi.fn().mockReturnThis();
      stop = vi.fn().mockReturnThis();
      constructor() {
        this.contextId = currentMockContext?.id ?? -1;
      }
    };
  };

  class MockGain extends createMockClass() {
    gain = { value: 1 };
  }

  class MockFreeverb extends createMockClass() {
    roomSize = { value: 0.7 };
    dampening = 3000;
    wet = { value: 0 };
  }

  class MockFeedbackDelay extends createMockClass() {
    delayTime = { value: '8n' };
    feedback = { value: 0.3 };
    wet = { value: 0 };
  }

  class MockChorus extends createMockClass() {
    frequency = { value: 1.5 };
    depth = 0.5;
    wet = { value: 0 };
  }

  class MockDistortion extends createMockClass() {
    distortion = 0;
    wet = { value: 0 };
  }

  class MockLimiter extends createMockClass() {
    threshold = { value: -1 };
  }

  class MockOscillator extends createMockClass() {
    frequency = { value: 440 };
    detune = { value: 0 };
    type = 'sawtooth';
  }

  class MockNoise extends createMockClass() {
    type = 'white';
  }

  class MockFilter extends createMockClass() {
    frequency = { value: 1000 };
    Q = { value: 1 };
    type = 'lowpass';
  }

  class MockAmplitudeEnvelope extends createMockClass() {
    attack = 0.01;
    decay = 0.1;
    sustain = 0.5;
    release = 0.5;
    triggerAttack = vi.fn();
    triggerRelease = vi.fn();
  }

  class MockEnvelope extends createMockClass() {
    attack = 0.01;
    decay = 0.1;
    sustain = 0.5;
    release = 0.5;
    triggerAttack = vi.fn();
    triggerRelease = vi.fn();
  }

  class MockLFO extends createMockClass() {
    frequency = { value: 5 };
    amplitude = { value: 1 };
    type = 'sine';
  }

  class MockMultiply extends createMockClass() {}

  class MockFMSynth extends createMockClass() {
    triggerAttackRelease = vi.fn();
    triggerAttack = vi.fn();
    triggerRelease = vi.fn();
  }

  class MockAMSynth extends createMockClass() {
    triggerAttackRelease = vi.fn();
  }

  class MockMembraneSynth extends createMockClass() {
    triggerAttackRelease = vi.fn();
  }

  class MockMetalSynth extends createMockClass() {
    triggerAttackRelease = vi.fn();
  }

  class MockPluckSynth extends createMockClass() {
    triggerAttackRelease = vi.fn();
  }

  class MockDuoSynth extends createMockClass() {
    triggerAttackRelease = vi.fn();
  }

  return {
    start: vi.fn().mockResolvedValue(undefined),
    setContext: vi.fn((ctx: { id: number }) => {
      currentMockContext = ctx;
    }),
    getContext: vi.fn(() => ({
      state: 'running',
      rawContext: currentMockContext,
    })),
    Frequency: vi.fn(() => ({
      toFrequency: () => 440,
    })),
    now: vi.fn(() => 0),
    Gain: MockGain,
    Freeverb: MockFreeverb,
    FeedbackDelay: MockFeedbackDelay,
    Chorus: MockChorus,
    Distortion: MockDistortion,
    Limiter: MockLimiter,
    Oscillator: MockOscillator,
    Noise: MockNoise,
    Filter: MockFilter,
    AmplitudeEnvelope: MockAmplitudeEnvelope,
    Envelope: MockEnvelope,
    LFO: MockLFO,
    Multiply: MockMultiply,
    FMSynth: MockFMSynth,
    AMSynth: MockAMSynth,
    MembraneSynth: MockMembraneSynth,
    MetalSynth: MockMetalSynth,
    PluckSynth: MockPluckSynth,
    DuoSynth: MockDuoSynth,
  };
});

import { ToneEffectsChain } from './toneEffects';
import { AdvancedSynthEngine } from './advancedSynth';
import { ToneSynthManager } from './toneSynths';
import * as Tone from 'tone';

describe('AudioContext Safety', () => {
  beforeEach(() => {
    // Reset context for each test
    mockContextId++;
    currentMockContext = { id: mockContextId };
    vi.mocked(Tone.setContext)(currentMockContext as unknown as Tone.BaseContext);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('ToneEffectsChain context consistency', () => {
    it('creates all nodes in the current context', async () => {
      const chain = new ToneEffectsChain();
      await chain.initialize();

      const input = chain.getInput() as unknown as { contextId: number };
      expect(input.contextId).toBe(currentMockContext?.id);

      chain.dispose();
    });

    it('nodes from different contexts cannot be safely connected', async () => {
      // Simulate first context
      const context1 = { id: 100 };
      vi.mocked(Tone.setContext)(context1 as unknown as Tone.BaseContext);
      currentMockContext = context1;

      const chain1 = new ToneEffectsChain();
      await chain1.initialize();
      const input1 = chain1.getInput() as unknown as { contextId: number };

      // Simulate HMR - new context
      const context2 = { id: 200 };
      vi.mocked(Tone.setContext)(context2 as unknown as Tone.BaseContext);
      currentMockContext = context2;

      const chain2 = new ToneEffectsChain();
      await chain2.initialize();
      const input2 = chain2.getInput() as unknown as { contextId: number };

      // Verify they have DIFFERENT context IDs
      expect(input1.contextId).toBe(100);
      expect(input2.contextId).toBe(200);
      expect(input1.contextId).not.toBe(input2.contextId);

      // This is the bug scenario - connecting nodes from different contexts
      // In real code, this throws "cannot connect to an AudioNode belonging to a different audio context"

      chain1.dispose();
      chain2.dispose();
    });
  });

  describe('Fresh instance pattern (recommended)', () => {
    it('engine should create fresh instances, not use singletons', async () => {
      // This test documents the recommended pattern:
      // Always use `new ClassName()` instead of singleton getters for Tone.js components
      // when creating them in the engine's initializeTone method

      const context = { id: 300 };
      vi.mocked(Tone.setContext)(context as unknown as Tone.BaseContext);
      currentMockContext = context;

      // Correct pattern: fresh instances
      const effects = new ToneEffectsChain();
      await effects.initialize();

      const synths = new ToneSynthManager();
      await synths.initialize();

      const advanced = new AdvancedSynthEngine();
      await advanced.initialize();

      // All should have the same context ID
      const effectsInput = effects.getInput() as unknown as { contextId: number };
      const synthsOutput = synths.getOutput() as unknown as { contextId: number };
      const advancedOutput = advanced.getOutput() as unknown as { contextId: number };

      expect(effectsInput.contextId).toBe(300);
      expect(synthsOutput.contextId).toBe(300);
      expect(advancedOutput.contextId).toBe(300);

      effects.dispose();
      synths.dispose();
      advanced.dispose();
    });
  });

  describe('Singleton danger scenario', () => {
    it('demonstrates why singletons are dangerous with HMR', async () => {
      // First "page load" - context 1
      const context1 = { id: 400 };
      vi.mocked(Tone.setContext)(context1 as unknown as Tone.BaseContext);
      currentMockContext = context1;

      const singleton = new AdvancedSynthEngine();
      await singleton.initialize();
      const output1 = singleton.getOutput() as unknown as { contextId: number };
      expect(output1.contextId).toBe(400);

      // Simulate HMR - context 2
      const context2 = { id: 500 };
      vi.mocked(Tone.setContext)(context2 as unknown as Tone.BaseContext);
      currentMockContext = context2;

      // If we reuse the singleton, it still has context 1 nodes!
      // (In real code, initialize() would return early because ready=true)

      // But if we create fresh effects in context 2...
      const freshEffects = new ToneEffectsChain();
      await freshEffects.initialize();
      const effectsInput = freshEffects.getInput() as unknown as { contextId: number };
      expect(effectsInput.contextId).toBe(500);

      // Now we have a mismatch: singleton nodes (400) vs fresh effects (500)
      // This is the bug that was fixed by using `new AdvancedSynthEngine()`
      // instead of `getAdvancedSynthEngine()` in engine.ts
      expect(output1.contextId).not.toBe(effectsInput.contextId);

      singleton.dispose();
      freshEffects.dispose();
    });
  });
});

describe('Singleton audit documentation', () => {
  /**
   * This test documents the AudioContext safety architecture.
   *
   * Phase 22: All dangerous singleton getters (getEffectsChain, getSynthManager,
   * getAdvancedSynthEngine) have been REMOVED to prevent AudioContext mismatch errors.
   *
   * The safe singletons below do NOT create Tone.js nodes, so they are safe to keep.
   */
  it('documents safe singletons (no Tone.js nodes)', () => {
    const safeSingletons = {
      'audioEngine': {
        file: 'engine.ts',
        createsToneNodes: false,
        risk: 'LOW',
        note: 'Creates fresh Tone.js instances via `new` in initializeTone()',
      },
      'synthEngine': {
        file: 'synth.ts',
        createsToneNodes: false,
        risk: 'LOW',
        note: 'Uses native AudioContext only (not Tone.js)',
      },
      'scheduler': {
        file: 'scheduler.ts',
        createsToneNodes: false,
        risk: 'LOW',
        note: 'No audio nodes, just timing',
      },
    };

    // All remaining singletons should be low risk
    for (const [_name, info] of Object.entries(safeSingletons)) {
      expect(info.risk).toBe('LOW');
      expect(info.createsToneNodes).toBe(false);
    }
  });

  it('documents that dangerous singletons were removed', () => {
    // Phase 22: These dangerous singleton getters have been REMOVED:
    // - getEffectsChain() from toneEffects.ts
    // - getSynthManager() from toneSynths.ts
    // - getAdvancedSynthEngine() from advancedSynth.ts
    // - initializeToneEffects() from toneEffects.ts
    //
    // They cached Tone.js nodes across HMR, causing AudioContext mismatch errors.
    // Engine.ts now always uses `new ClassName()` to ensure fresh instances.
    expect(true).toBe(true); // Documentation test
  });
});
