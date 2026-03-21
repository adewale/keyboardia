/**
 * XY Effects Bridge
 *
 * Bridges XY pad parameter changes to both the effects state and synth engine.
 * Solves two problems:
 *
 * 1. **Batched updates** — collects all parameter changes from a single XY drag
 *    into one state update, preventing the stale-closure bug where calling
 *    updateEffect() twice causes the second call to overwrite the first.
 *
 * 2. **Synth parameter routing** — routes filter, LFO, envelope, and oscillator
 *    parameters to the AdvancedSynthEngine, which the old per-parameter switch
 *    statement silently dropped.
 */

import type { EffectsState } from './toneEffects';
import type { XYPadParameter } from './xyPad';

// ─── Types ──────────────────────────────────────────────────────────────

export interface XYParamUpdate {
  parameter: XYPadParameter;
  value: number;
}

/** Interface for synth engine parameter setters (injectable for testing) */
export interface SynthParamSink {
  setFilterFrequency: (value: number) => void;
  setFilterResonance: (value: number) => void;
  setLfoRate: (value: number) => void;
  setLfoAmount: (value: number) => void;
  setAttack: (value: number) => void;
  setRelease: (value: number) => void;
  setOscMix: (value: number) => void;
}

// ─── Classification ─────────────────────────────────────────────────────

const EFFECT_PARAMS = new Set<XYPadParameter>([
  'reverbWet', 'reverbDecay', 'delayWet', 'delayFeedback', 'chorusWet', 'distortionWet',
]);

const SYNTH_PARAMS = new Set<XYPadParameter>([
  'filterFrequency', 'filterResonance', 'lfoRate', 'lfoAmount',
  'oscMix', 'attack', 'release',
]);

export function isEffectParam(param: XYPadParameter): boolean {
  return EFFECT_PARAMS.has(param);
}

export function isSynthParam(param: XYPadParameter): boolean {
  return SYNTH_PARAMS.has(param);
}

// ─── Batched Effects Update ─────────────────────────────────────────────

/**
 * Build a single merged EffectsState from multiple parameter updates.
 *
 * Only applies effect-type parameters (wet, feedback, decay).
 * Synth parameters (filter, LFO, envelope, oscMix) are ignored here —
 * they route through applySynthParam() instead.
 *
 * This replaces the pattern of calling updateEffect() N times in a loop,
 * which caused stale-closure bugs where the Nth call overwrote the (N-1)th.
 */
export function buildBatchedEffectsUpdate(
  current: EffectsState,
  updates: XYParamUpdate[]
): EffectsState {
  // Start with a shallow copy
  const result = { ...current };
  let reverbChanged = false;
  let delayChanged = false;
  let chorusChanged = false;
  let distortionChanged = false;

  for (const { parameter, value } of updates) {
    switch (parameter) {
      case 'reverbWet':
        if (!reverbChanged) { result.reverb = { ...result.reverb }; reverbChanged = true; }
        result.reverb.wet = value;
        break;
      case 'reverbDecay':
        if (!reverbChanged) { result.reverb = { ...result.reverb }; reverbChanged = true; }
        result.reverb.decay = value;
        break;
      case 'delayWet':
        if (!delayChanged) { result.delay = { ...result.delay }; delayChanged = true; }
        result.delay.wet = value;
        break;
      case 'delayFeedback':
        if (!delayChanged) { result.delay = { ...result.delay }; delayChanged = true; }
        result.delay.feedback = value;
        break;
      case 'chorusWet':
        if (!chorusChanged) { result.chorus = { ...result.chorus }; chorusChanged = true; }
        result.chorus.wet = value;
        break;
      case 'distortionWet':
        if (!distortionChanged) { result.distortion = { ...result.distortion }; distortionChanged = true; }
        result.distortion.wet = value;
        break;
      // Synth params are intentionally not handled here
    }
  }

  return result;
}

// ─── Synth Parameter Routing ────────────────────────────────────────────

/**
 * Route a single synth parameter to the appropriate engine setter.
 *
 * Effect parameters (reverbWet, delayWet, etc.) are no-ops here —
 * they go through buildBatchedEffectsUpdate() instead.
 */
export function applySynthParam(
  parameter: XYPadParameter,
  value: number,
  engine: SynthParamSink
): void {
  switch (parameter) {
    case 'filterFrequency': engine.setFilterFrequency(value); break;
    case 'filterResonance': engine.setFilterResonance(value); break;
    case 'lfoRate':         engine.setLfoRate(value); break;
    case 'lfoAmount':       engine.setLfoAmount(value); break;
    case 'attack':          engine.setAttack(value); break;
    case 'release':         engine.setRelease(value); break;
    case 'oscMix':          engine.setOscMix(value); break;
    // Effect params are intentionally not handled here
  }
}
