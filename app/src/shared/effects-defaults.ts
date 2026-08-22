import type { EffectsState } from './sync-types';

/**
 * Serializable effects defaults shared by state and the browser audio adapter.
 * This module must remain free of Tone.js and other live audio dependencies.
 */
export const DEFAULT_EFFECTS_STATE: EffectsState = {
  bypass: false,
  // Phase 44 Change 3: new sessions start with a small bass-protected room
  // (the send is high-passed at REVERB_SEND_HIGHPASS_HZ with a short
  // predelay — see toneEffects.ts). 0.15 is the value
  // specs/SOUND-QUALITY-PARITY-PLAN.md:508 specified; legacy sessions that
  // never stored effects keep the dry LEGACY_MISSING_EFFECTS_STATE below so
  // saved music is not reinterpreted.
  reverb: { decay: 2.0, wet: 0.15 },
  delay: { time: '8n', feedback: 0.3, wet: 0 },
  chorus: { frequency: 1.5, depth: 0.5, wet: 0 },
  distortion: { amount: 0.4, wet: 0 },
};

/**
 * Migration value for sessions written before effects were persisted.
 *
 * Missing effects historically meant the dry signal path. Hydrating one of
 * those sessions with the current new-session reverb would reinterpret the
 * saved music, so legacy loads use a separate explicit value.
 */
export const LEGACY_MISSING_EFFECTS_STATE: EffectsState = {
  bypass: false,
  reverb: { decay: 2.0, wet: 0 },
  delay: { time: '8n', feedback: 0.3, wet: 0 },
  chorus: { frequency: 1.5, depth: 0.5, wet: 0 },
  distortion: { amount: 0.4, wet: 0 },
};

export type MissingEffectsPolicy = 'new-session' | 'legacy-session';

/** Return a detached canonical effects value for storage and hydration. */
export function normalizeSessionEffects(
  effects: EffectsState | null | undefined,
  missingPolicy: MissingEffectsPolicy,
): EffectsState {
  const fallback = missingPolicy === 'new-session'
    ? DEFAULT_EFFECTS_STATE
    : LEGACY_MISSING_EFFECTS_STATE;
  const source = effects ?? fallback;
  return {
    bypass: source.bypass ?? false,
    reverb: { ...source.reverb },
    delay: { ...source.delay },
    chorus: { ...source.chorus },
    distortion: { ...source.distortion },
  };
}
