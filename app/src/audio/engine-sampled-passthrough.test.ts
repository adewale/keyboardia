// @vitest-environment jsdom
/**
 * Seam test for AudioEngine.playSampledInstrument → SampledInstrument.playNote.
 *
 * Bugs P1/P2 (SAMPLE-AUDIT-2026-06) both lived at exactly this seam:
 * the engine received a scheduled time and discarded it (passed 0), and
 * never received/forwarded a velocity (hardcoded 100). These tests pin
 * the full argument pass-through so the seam can't silently regress.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const playNote = vi.fn();
const playVoice = vi.fn();
const fakeInstrument = {
  isReady: () => true,
  playNote: (...args: unknown[]) => playNote(...args),
};
const managedInstrument = {
  isReady: () => true,
  playNote: vi.fn(),
  playVoice: (...args: unknown[]) => playVoice(...args),
};

vi.mock('./sampled-instrument', async (importOriginal) => {
  const original = await importOriginal<typeof import('./sampled-instrument')>();
  return {
    ...original,
    sampledInstrumentRegistry: {
      get: (id: string) => id === 'piano'
        ? fakeInstrument
        : id === 'managed'
          ? managedInstrument
          : undefined,
      register: vi.fn(),
      initialize: vi.fn(),
      load: vi.fn(),
      getState: () => 'ready',
      onStateChange: vi.fn(),
      acquireInstrumentSamples: vi.fn(),
      releaseInstrumentSamples: vi.fn(),
      getInstrumentIds: () => ['piano', 'managed'],
      has: (id: string) => id === 'piano' || id === 'managed',
      dispose: vi.fn(),
    },
  };
});

import { audioEngine } from './engine';

beforeEach(() => {
  playNote.mockClear();
  playVoice.mockClear();
});

describe('playSampledInstrument pass-through', () => {
  it('forwards the scheduled time (P1: was hardcoded to 0)', () => {
    audioEngine.playSampledInstrument('piano', 'n1', 60, 3.25, 0.5, 0.8, undefined, 90);
    expect(playNote).toHaveBeenCalledTimes(1);
    const [, midiNote, time] = playNote.mock.calls[0];
    expect(midiNote).toBe(60);
    expect(time).toBe(3.25);
  });

  it('forwards the velocity (P2: was hardcoded to 100)', () => {
    audioEngine.playSampledInstrument('piano', 'n1', 60, 0, 0.5, 0.8, undefined, 37);
    const velocity = playNote.mock.calls[0][5];
    expect(velocity).toBe(37);
  });

  it('retains the full-velocity fallback when the caller does not specify one', () => {
    audioEngine.playSampledInstrument('piano', 'n1', 60, 0, 0.5, 0.8);
    const velocity = playNote.mock.calls[0][5];
    expect(velocity).toBe(127);
  });

  it('forwards explicit playback semantics to the production managed-voice API', () => {
    audioEngine.playSampledInstrument(
      'managed',
      'voice-1',
      60,
      3.25,
      0.5,
      0.8,
      undefined,
      90,
      undefined,
      'loop',
    );
    expect(playVoice).toHaveBeenCalledWith(expect.objectContaining({
      id: 'voice-1',
      midiNote: 60,
      time: 3.25,
      duration: 0.5,
      volume: 0.8,
      velocity: 90,
      mode: 'loop',
    }));
    expect(managedInstrument.playNote).not.toHaveBeenCalled();
  });
});
