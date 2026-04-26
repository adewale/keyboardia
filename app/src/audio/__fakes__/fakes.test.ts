/**
 * Sanity tests for the purpose-built fakes. The compile-time surface
 * check at the bottom of each fake is the load-bearing fidelity guard
 * (TypeScript fails the build if a fake's signature drifts from the
 * real class). These runtime tests just confirm the recorders work as
 * advertised so test authors can rely on them.
 *
 * If you renamed a method on the real class, the fake's `_surfaceCheck`
 * line at the end of the source file would have already failed
 * type-check. This file is intentionally small.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { FakeToneSynthManager } from './FakeToneSynthManager';
import { FakeAdvancedSynthEngine } from './FakeAdvancedSynthEngine';

describe('FakeToneSynthManager', () => {
  let fake: FakeToneSynthManager;
  beforeEach(() => { fake = new FakeToneSynthManager(); });

  it('records playNote calls', async () => {
    await fake.initialize();
    fake.playNote('fm-bass', 'C4', '8n', 1.5, 0.7);
    expect(fake.playNoteCalls).toHaveLength(1);
    expect(fake.playNoteCalls[0]).toEqual({
      presetName: 'fm-bass',
      note: 'C4',
      duration: '8n',
      time: 1.5,
      volume: 0.7,
    });
  });

  it('records and reads back FM params', () => {
    expect(fake.getFMParams()).toBeNull();
    fake.setFMParams(2.5, 8);
    expect(fake.getFMParams()).toEqual({ harmonicity: 2.5, modulationIndex: 8 });
    expect(fake.setFMParamsCalls).toEqual([{ harmonicity: 2.5, modulationIndex: 8 }]);
  });

  it('isReady() flips after initialize, back to false after dispose', async () => {
    expect(fake.isReady()).toBe(false);
    await fake.initialize();
    expect(fake.isReady()).toBe(true);
    fake.dispose();
    expect(fake.isReady()).toBe(false);
    expect(fake.disposed).toBe(true);
  });
});

describe('FakeAdvancedSynthEngine', () => {
  let fake: FakeAdvancedSynthEngine;
  beforeEach(() => { fake = new FakeAdvancedSynthEngine(); });

  it('records playNoteSemitone calls with the real signature shape', async () => {
    await fake.initialize();
    fake.playNoteSemitone(7, 0.5, 1.25, 0.8);
    expect(fake.playNoteSemitoneCalls).toEqual([
      { semitone: 7, duration: 0.5, time: 1.25, volume: 0.8 },
    ]);
  });

  it('records every XY-pad / FM setter independently', () => {
    fake.setFilterFrequency(1500);
    fake.setFilterResonance(2.4);
    fake.setLfoRate(6);
    fake.setLfoAmount(0.4);
    fake.setAttack(0.05);
    fake.setRelease(1.2);
    fake.setOscMix(0.6);

    expect(fake.setFilterFrequencyCalls).toEqual([1500]);
    expect(fake.setFilterResonanceCalls).toEqual([2.4]);
    expect(fake.setLfoRateCalls).toEqual([6]);
    expect(fake.setLfoAmountCalls).toEqual([0.4]);
    expect(fake.setAttackCalls).toEqual([0.05]);
    expect(fake.setReleaseCalls).toEqual([1.2]);
    expect(fake.setOscMixCalls).toEqual([0.6]);
  });

  it('getDiagnostics returns the AdvancedSynthDiagnostics shape', () => {
    const d = fake.getDiagnostics();
    expect(d.ready).toBe(false);
    expect(d.activeVoices).toBe(0);
    expect(typeof d.toneContextSampleRate).toBe('number');
  });

  it('reset() clears all recorders', async () => {
    await fake.initialize();
    fake.setPreset('supersaw');
    fake.playNoteSemitone(5, 0.3);
    fake.setFilterFrequency(2000);

    fake.reset();
    expect(fake.playNoteSemitoneCalls).toHaveLength(0);
    expect(fake.setPresetCalls).toHaveLength(0);
    expect(fake.setFilterFrequencyCalls).toHaveLength(0);
    expect(fake.isReady()).toBe(false);
  });
});
