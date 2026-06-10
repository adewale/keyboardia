/**
 * Shared Effect Parameter Mapping
 *
 * Single source of truth for XY pad parameter → effect routing.
 * Both xy-effects-bridge.ts and effects-util.ts reference this mapping,
 * so adding a new effect parameter only requires updating one file.
 */

import type { XYPadParameter } from './xyPad';
import type { EffectsState } from './toneEffects';

// ─── Types ──────────────────────────────────────────────────────────────

type EffectName = Exclude<keyof EffectsState, 'bypass'>;

export interface EffectParamMapping {
  effect: EffectName;
  param: string;
}

// ─── Canonical Mapping ──────────────────────────────────────────────────

/**
 * Maps XY pad effect parameters to their {effect, param} pair.
 *
 * To add a new effect parameter:
 * 1. Add the XYPadParameter in xyPad.ts
 * 2. Add the mapping here
 * 3. Both xy-effects-bridge and effects-util pick it up automatically
 */
export const EFFECT_PARAM_MAP: Partial<Record<XYPadParameter, EffectParamMapping>> = {
  reverbWet:     { effect: 'reverb',     param: 'wet' },
  reverbDecay:   { effect: 'reverb',     param: 'decay' },
  delayWet:      { effect: 'delay',      param: 'wet' },
  delayFeedback: { effect: 'delay',      param: 'feedback' },
  chorusWet:     { effect: 'chorus',     param: 'wet' },
  distortionWet: { effect: 'distortion', param: 'wet' },
};

// ─── Classification Sets ────────────────────────────────────────────────

/** XY pad parameters that route to the effects chain */
export const EFFECT_PARAMS = new Set<XYPadParameter>(
  Object.keys(EFFECT_PARAM_MAP) as XYPadParameter[]
);

/** XY pad parameters that route to the synth engine */
export const SYNTH_PARAMS = new Set<XYPadParameter>([
  'filterFrequency', 'filterResonance', 'lfoRate', 'lfoAmount',
  'oscMix', 'attack', 'release',
]);

// ─── Classification Functions ───────────────────────────────────────────

export function isEffectParam(param: XYPadParameter): boolean {
  return EFFECT_PARAMS.has(param);
}

export function isSynthParam(param: XYPadParameter): boolean {
  return SYNTH_PARAMS.has(param);
}
