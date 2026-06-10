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

import { logger } from '../utils/logger';
import type { EffectsState } from './toneEffects';
import type { XYPadParameter } from './xyPad';
import {
  EFFECT_PARAM_MAP,
  isEffectParam,
  isSynthParam,
} from './effect-param-mapping';

// Re-export classification functions so existing importers don't break
export { isEffectParam, isSynthParam } from './effect-param-mapping';

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

// ─── Batched Effects Update ─────────────────────────────────────────────

/**
 * Build a single merged EffectsState from multiple parameter updates.
 *
 * Only applies effect-type parameters (wet, feedback, decay).
 * Synth parameters (filter, LFO, envelope, oscMix) are ignored here —
 * they route through applySynthParam() instead.
 *
 * Uses the shared EFFECT_PARAM_MAP to route parameters, so adding a new
 * effect parameter only requires updating effect-param-mapping.ts.
 */
export function buildBatchedEffectsUpdate(
  current: EffectsState,
  updates: XYParamUpdate[]
): EffectsState {
  // Start with a shallow copy
  const result = { ...current };
  const changed: Record<string, boolean> = {};

  for (const { parameter, value } of updates) {
    const mapping = EFFECT_PARAM_MAP[parameter];
    if (mapping) {
      const { effect, param } = mapping;
      if (!changed[effect]) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (result as any)[effect] = { ...(result as any)[effect] };
        changed[effect] = true;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (result as any)[effect][param] = value;
    } else if (!isSynthParam(parameter)) {
      // Not an effect param and not a synth param — truly unknown
      logger.audio.warn(`Unknown XY pad parameter in batched update: ${parameter}`);
    }
    // Synth params are intentionally not handled here
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
    default:
      if (!isEffectParam(parameter)) {
        logger.audio.warn(`Unknown XY pad parameter in synth routing: ${parameter}`);
      }
      // Effect params are intentionally not handled here
      break;
  }
}
