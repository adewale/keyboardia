// @vitest-environment jsdom
/**
 * Memory Leak and Stale Timer Tests
 *
 * These tests verify proper cleanup of audio resources to prevent:
 * 1. Memory leaks from Tone.js nodes not being disposed
 * 2. Stale timers firing after playback stops
 * 3. Voice allocation issues from orphaned state
 *
 * Cleanup is verified through observable voice/timer state rather than
 * asserting that methods merely exist.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Timer cleanup behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('SynthEngine.stopAll should clear pending cleanup timers', async () => {
    const { SynthEngine } = await import('./synth');
    const engine = new SynthEngine();

    // Create a mock audio context with all required methods
    const mockContext = {
      currentTime: 0,
      state: 'running',
      createOscillator: () => ({
        type: 'sine',
        frequency: { value: 440, setValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() },
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        disconnect: vi.fn(),
      }),
      createGain: () => ({
        gain: {
          value: 1,
          setValueAtTime: vi.fn(),
          setTargetAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
          cancelScheduledValues: vi.fn(),
        },
        connect: vi.fn(),
        disconnect: vi.fn(),
      }),
      createBiquadFilter: () => ({
        type: 'lowpass',
        frequency: {
          value: 1000,
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
          cancelScheduledValues: vi.fn(),
        },
        Q: { value: 1 },
        connect: vi.fn(),
        disconnect: vi.fn(),
      }),
    } as unknown as AudioContext;

    const mockMasterGain = {
      gain: { value: 1 },
      connect: vi.fn(),
    } as unknown as GainNode;

    engine.initialize(mockContext, mockMasterGain);

    // Play a note with duration (this schedules cleanup)
    engine.playNote('test-1', 440, {
      waveform: 'sine',
      attack: 0.01,
      decay: 0.1,
      sustain: 0.5,
      release: 0.3,
      filterCutoff: 2000,
      filterResonance: 1,
    }, 0, 0.5);

    // stopAll should clear pending timers
    engine.stopAll();

    // Fast forward - verify no errors from stale timers
    vi.advanceTimersByTime(2000);

    // Verify stopAll cleared voices - activeVoices should be empty
    expect(engine.getVoiceCount()).toBe(0);
  });
});
