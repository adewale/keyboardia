import { describe, expect, it } from 'vitest';
import { DEFAULT_STEP_MIDI_VELOCITY } from '../shared/constants';
import {
  classifyInstrumentForHumanization,
  humanizeNoteGainDb,
  noteHumanizationSeed,
  randomFromSeed,
  resolveHumanizedNoteDynamics,
  resolveNoteDynamics,
} from './note-dynamics';

describe('resolveNoteDynamics', () => {
  it('pins an unlocked step to MIDI 90 at unity note gain', () => {
    expect(resolveNoteDynamics(undefined)).toEqual({
      midiVelocity: DEFAULT_STEP_MIDI_VELOCITY,
      noteGain: 1,
      hasExplicitLock: false,
    });
  });

  it('uses the exact 40 dB lock taper and preserves silence', () => {
    expect(resolveNoteDynamics(1)).toEqual({ midiVelocity: 127, noteGain: 1, hasExplicitLock: true });
    expect(resolveNoteDynamics(0.5)).toEqual({ midiVelocity: 64, noteGain: 0.1, hasExplicitLock: true });
    expect(resolveNoteDynamics(0)).toEqual({ midiVelocity: 0, noteGain: 0, hasExplicitLock: true });
  });

  it('clamps finite out-of-range values defensively', () => {
    expect(resolveNoteDynamics(-2).midiVelocity).toBe(0);
    expect(resolveNoteDynamics(4).midiVelocity).toBe(127);
  });
});

describe('gain humanization', () => {
  it('is deterministic per track/step/iteration and varies across iterations', () => {
    const a = resolveHumanizedNoteDynamics(undefined, 'sampled:piano', 'track-a', 3, 0);
    const b = resolveHumanizedNoteDynamics(undefined, 'sampled:piano', 'track-a', 3, 0);
    const c = resolveHumanizedNoteDynamics(undefined, 'sampled:piano', 'track-a', 3, 1);
    expect(a).toEqual(b);
    expect(c.noteGain).not.toBe(a.noteGain);
    expect(a.midiVelocity).toBe(90);
    expect(c.midiVelocity).toBe(90);
  });

  it('keeps explicit locks bit-exact', () => {
    const resolved = resolveNoteDynamics(0.42);
    expect(humanizeNoteGainDb(resolved.noteGain, true, 'tonal', () => 1)).toBe(resolved.noteGain);
  });

  it.each([
    ['tonal', 2.5],
    ['percussion', 1.25],
    ['low-end', 0.75],
  ] as const)('bounds %s variation to ±%s dB', (instrumentClass, limit) => {
    const low = humanizeNoteGainDb(1, false, instrumentClass, () => 0);
    const high = humanizeNoteGainDb(1, false, instrumentClass, () => 1);
    expect(20 * Math.log10(low)).toBeCloseTo(-limit, 8);
    expect(20 * Math.log10(high)).toBeCloseTo(limit, 8);
  });

  it.each([
    ['sampled:piano', 2.5],
    ['sampled:808-hihat-closed', 1.25],
    ['sampled:808-kick', 0.75],
  ] as const)('keeps 256 seeded %s triggers reproducible, varying, and within ±%s dB', (sampleId, limit) => {
    const first = Array.from({ length: 256 }, (_, loopIteration) =>
      resolveHumanizedNoteDynamics(undefined, sampleId, 'track-a', 3, loopIteration).noteGain,
    );
    const replay = Array.from({ length: 256 }, (_, loopIteration) =>
      resolveHumanizedNoteDynamics(undefined, sampleId, 'track-a', 3, loopIteration).noteGain,
    );
    const db = first.map(gain => 20 * Math.log10(gain));

    expect(replay).toEqual(first);
    expect(new Set(first).size).toBeGreaterThan(1);
    expect(Math.min(...db)).toBeGreaterThanOrEqual(-limit);
    expect(Math.max(...db)).toBeLessThanOrEqual(limit);
  });

  it('classifies low-end separately and other drums as percussion', () => {
    expect(classifyInstrumentForHumanization('sampled:808-kick')).toBe('low-end');
    expect(classifyInstrumentForHumanization('synth:sub')).toBe('low-end');
    expect(classifyInstrumentForHumanization('sampled:808-hihat-closed')).toBe('percussion');
    expect(classifyInstrumentForHumanization('sampled:piano')).toBe('tonal');
  });

  it('exposes deterministic seed and RNG primitives', () => {
    const seed = noteHumanizationSeed('track', 2, 4);
    expect(seed).toBe(noteHumanizationSeed('track', 2, 4));
    expect(randomFromSeed(seed)).toBe(randomFromSeed(seed));
    expect(randomFromSeed(seed)).toBeGreaterThanOrEqual(0);
    expect(randomFromSeed(seed)).toBeLessThan(1);
  });
});
