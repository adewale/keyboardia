/**
 * Audio Module Exports
 *
 * This file re-exports all audio-related modules for convenient importing.
 */

// Core audio engine
export { audioEngine, AudioEngine } from './engine';

// Basic synth engine (backward compatible)
export {
  synthEngine,
  SynthEngine,
  SYNTH_PRESETS,
  midiToFrequency,
  semitoneToFrequency,
  type SynthParams,
  type WaveformType,
} from './synth';

// Advanced synth engine (Phase 19)
export {
  advancedSynthEngine,
  AdvancedSynthEngine,
  ADVANCED_SYNTH_PRESETS,
  getAdvancedSynthPreset,
  getAdvancedSynthPresetNames,
  createDefaultAdvancedParams,
  type AdvancedSynthParams,
  type OscillatorConfig,
  type ADSREnvelope,
  type LFOConfig,
  type FilterConfig,
} from './advanced-synth';

// Effects system (Phase 19)
export {
  Reverb,
  Delay,
  Chorus,
  EffectsChain,
  EFFECT_PRESETS,
  type ReverbParams,
  type DelayParams,
  type ChorusParams,
  type CompressorParams,
} from './effects';

// Scheduler
export { scheduler, Scheduler } from './scheduler';

// Sample generation
export { createSynthesizedSamples } from './samples';

// Recording
export { Recorder } from './recorder';

// Sample slicing
export { sliceSample } from './slicer';
