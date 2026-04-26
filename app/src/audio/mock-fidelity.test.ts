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
 * The list of methods is harvested from every `vi.mock` in this PR's
 * test files. When a new mock method is added, add it here too. If the
 * real class drops or renames a method, this test fails specifically.
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
    'setPreset',
    'playNoteSemitone',
    'getDiagnostics',
    'setFilterFrequency',
    'setFilterResonance',
    'setLfoRate',
    'setLfoAmount',
    'setAttack',
    'setRelease',
    'setOscMix',
    'dispose',
  ] as const;

  it('every mocked method exists on the real AdvancedSynthEngine prototype', () => {
    expectMethods(AdvancedSynthEngine.prototype, MOCKED_METHODS);
  });
});

describe('Mock-fidelity contract: AudioEngine', () => {
  // Methods stubbed by `vi.mock('./engine', ...)` in this PR's test files.
  const MOCKED_METHODS = [
    'isInitialized',
    'isToneSynthReady',
    'isSampledInstrumentReady',
    'getCurrentTime',
    'setTrackVolume',
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
