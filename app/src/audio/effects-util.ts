/**
 * Effects Utility Functions
 *
 * Shared utilities for applying effects to the audio engine.
 * Extracted from EffectsPanel and Transport to eliminate duplication.
 *
 * TASK-007 from DUPLICATION-REMEDIATION-PLAN.md
 */

import { audioEngine } from './engine';
import { logger } from '../utils/logger';
import type { EffectsState } from './toneEffects';

/**
 * Apply a single effect parameter change to the audio engine.
 *
 * Maps effect name + parameter to the appropriate audioEngine method.
 * Does not update React state - that's the caller's responsibility.
 *
 * @param effectName - The effect to update (reverb, delay, chorus, distortion)
 * @param param - The parameter name within the effect
 * @param value - The new value to apply
 *
 * @example
 * ```ts
 * applyEffectToEngine('reverb', 'wet', 0.5);
 * applyEffectToEngine('delay', 'time', '8n');
 * ```
 */
export function applyEffectToEngine(
  effectName: keyof EffectsState,
  param: string | number | symbol,
  value: number | string
): void {
  const paramName = String(param);
  switch (effectName) {
    case 'reverb':
      if (paramName === 'wet') audioEngine.setReverbWet(value as number);
      else if (paramName === 'decay') audioEngine.setReverbDecay(value as number);
      else logger.audio.warn(`Unknown reverb parameter: ${paramName}`);
      break;
    case 'delay':
      if (paramName === 'wet') audioEngine.setDelayWet(value as number);
      else if (paramName === 'time') audioEngine.setDelayTime(value as string);
      else if (paramName === 'feedback') audioEngine.setDelayFeedback(value as number);
      else logger.audio.warn(`Unknown delay parameter: ${paramName}`);
      break;
    case 'chorus':
      if (paramName === 'wet') audioEngine.setChorusWet(value as number);
      else if (paramName === 'frequency') audioEngine.setChorusFrequency(value as number);
      else if (paramName === 'depth') audioEngine.setChorusDepth(value as number);
      else logger.audio.warn(`Unknown chorus parameter: ${paramName}`);
      break;
    case 'distortion':
      if (paramName === 'wet') audioEngine.setDistortionWet(value as number);
      else if (paramName === 'amount') audioEngine.setDistortionAmount(value as number);
      else logger.audio.warn(`Unknown distortion parameter: ${paramName}`);
      break;
    case 'bypass':
      // Bypass is handled at the state level, not the engine level
      break;
    default:
      logger.audio.warn(`Unknown effect: ${String(effectName)}`);
      break;
  }
}
