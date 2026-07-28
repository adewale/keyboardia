import type { EffectsState } from './sync-types';

/**
 * Serializable effects defaults shared by state and the browser audio adapter.
 * This module must remain free of Tone.js and other live audio dependencies.
 */
export const DEFAULT_EFFECTS_STATE: EffectsState = {
  bypass: false,
  reverb: { decay: 2.0, wet: 0 },
  delay: { time: '8n', feedback: 0.3, wet: 0 },
  chorus: { frequency: 1.5, depth: 0.5, wet: 0 },
  distortion: { amount: 0.4, wet: 0 },
};
