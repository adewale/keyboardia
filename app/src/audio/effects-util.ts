/**
 * Effects Utility Functions
 *
 * Shared utilities for applying effects to the audio engine.
 * Extracted from EffectsPanel and Transport to eliminate duplication.
 *
 * TASK-007 from DUPLICATION-REMEDIATION-PLAN.md
 */

import { audioEngine } from './engine';
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
      if (paramName === 'decay') audioEngine.setReverbDecay(value as number);
      break;
    case 'delay':
      if (paramName === 'wet') audioEngine.setDelayWet(value as number);
      if (paramName === 'time') audioEngine.setDelayTime(value as string);
      if (paramName === 'feedback') audioEngine.setDelayFeedback(value as number);
      break;
    case 'chorus':
      if (paramName === 'wet') audioEngine.setChorusWet(value as number);
      if (paramName === 'frequency') audioEngine.setChorusFrequency(value as number);
      if (paramName === 'depth') audioEngine.setChorusDepth(value as number);
      break;
    case 'distortion':
      if (paramName === 'wet') audioEngine.setDistortionWet(value as number);
      if (paramName === 'amount') audioEngine.setDistortionAmount(value as number);
      break;
  }
}
