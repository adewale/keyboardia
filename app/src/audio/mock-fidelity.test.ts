// @vitest-environment jsdom
/**
 * Mock-fidelity contract tests — verify that the methods our test
 * doubles call on `ToneSynthManager`, `AdvancedSynthEngine`, and
 * `AudioEngine` actually exist on the real classes.
 *
 * Without this, a refactor that renames `playNote` → `playNoteAt` would
 * leave every mocked unit test silently passing while production breaks.
 * This is the "mock-reality drift" antipattern from the
 * testing-best-practices skill.
 *
 * Why this survives the move to production-boundary testing: the typed
 * fakes in `__fakes__/` give a compile-time surface guarantee, but only to
 * call sites that inject them. Dozens of test files still reach for
 * `vi.mock('./toneSynths')` and friends, and an ad-hoc module mock has no
 * such guarantee. This file is the only thing that fails when one of those
 * mocks describes a method the real class no longer has. Delete it once
 * every `vi.mock` of these three modules has migrated to the fakes — not
 * before, or the drift it catches becomes invisible again.
 *
 * The method lists are harvested from those `vi.mock` call sites. When a
 * new mock method is added, add it here too. If the real class drops or
 * renames a method, this test fails specifically.
 */
import { describe, it, expect } from 'vitest';
import { ToneSynthManager } from './toneSynths';
import { AdvancedSynthEngine } from './advancedSynth';
import { AudioEngine } from './engine';

function expectMethods(target: object, methods: readonly string[]): void {
  for (const m of methods) {
    const fn = (target as Record<string, unknown>)[m];
    expect(typeof fn, `${m} must exist as a method on the real class`).toBe('function');
  }
}

describe('Mock-fidelity contract: ToneSynthManager', () => {
  // Methods exercised by mocks in:
  //   - per-track-synths.test.ts
  //   - per-track-synth-controls.test.ts
  //   - per-track-synth-lifecycle.test.ts
  //   - per-track-synth-preload.test.ts
  //   - preview-synth.test.ts
  const MOCKED_METHODS = [
    'initialize',
    'getOutput',
    'playNote',
    'semitoneToNoteName',
    'getPresetNames',
    'setFMParams',
    'resetFMParams',
    'getFMParams',
    'dispose',
  ] as const;

  it('every mocked method exists on the real ToneSynthManager prototype', () => {
    expectMethods(ToneSynthManager.prototype, MOCKED_METHODS);
  });
});

describe('Mock-fidelity contract: AdvancedSynthEngine', () => {
  // Methods exercised by mocks in the per-track-* test files + preview-synth.
  const MOCKED_METHODS = [
    'initialize',
    'isReady',
    'getOutput',
    'setTempo',
    'setPreset',
    'playNoteSemitone',
    'getDiagnostics',
    'setFilterFrequency',
    'setFilterResonance',
    'setLfoRate',
    'setLfoAmount',
    'setOscMix',
    'dispose',
  ] as const;

  it('every mocked method exists on the real AdvancedSynthEngine prototype', () => {
    expectMethods(AdvancedSynthEngine.prototype, MOCKED_METHODS);
  });
});

describe('Mock-fidelity contract: AudioEngine', () => {
  // Methods stubbed by `vi.mock('./engine', ...)` across the audio suites.
  const MOCKED_METHODS = [
    'isInitialized',
    'isToneSynthReady',
    'isSampledInstrumentReady',
    'getCurrentTime',
    'setTrackVolume',
    'setTrackPan',
    'syncGridAudioState',
    'playSampledInstrument',
    'playToneSynth',
    'playAdvancedSynth',
    'playSynthNote',
    'playSample',
    'preloadInstrumentsForTracks',
  ] as const;

  it('every mocked AudioEngine method exists on the real prototype', () => {
    expectMethods(AudioEngine.prototype, MOCKED_METHODS);
  });
});
