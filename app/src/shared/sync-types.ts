/**
 * Shared Sync Types
 *
 * Canonical type definitions shared between frontend (types.ts) and
 * worker (worker/types.ts). This eliminates type duplication and ensures
 * parity across the serialization boundary.
 *
 * IMPORTANT: When modifying these types, both frontend and worker code
 * will be affected. Run full test suite after changes.
 */

/**
 * Playback mode for samples - based on industry standards from
 * Teenage Engineering, Elektron, Ableton, Roland, and Akai.
 *
 * - 'oneshot': Sample plays to completion regardless of step duration.
 *              This is the DEFAULT and industry standard behavior.
 *              Best for: drums, recordings, one-shot samples.
 *
 * - 'gate': Sample is cut at step boundary (gated playback).
 *           Sample only plays while "held" (for the step duration).
 *           Best for: sustained synth pads, drones.
 */
export type PlaybackMode = 'oneshot' | 'gate';

/**
 * Parameter Lock - per-step parameter overrides (Elektron-style).
 * Each step can have different pitch, volume, etc.
 * Only non-undefined values override the track default.
 */
export interface ParameterLock {
  pitch?: number;  // Semitones offset from original (-24 to +24)
  volume?: number; // 0-1, multiplier on track volume
  tie?: boolean;   // Continue note from previous step (no new attack)
}

/**
 * FM synthesis parameters for tone:fm-* presets.
 * Allows per-track customization of FM synth sound.
 */
export interface FMParams {
  harmonicity: number;      // 0.5 to 10 - frequency ratio of modulator to carrier
  modulationIndex: number;  // 0 to 20 - intensity of frequency modulation
}

/**
 * Effects state for audio processing.
 * Synced across multiplayer clients for consistent sound.
 *
 * Note: bypass is synced (not local-only like mute/solo) because it affects
 * the artistic intent of the music. When effects are bypassed, everyone
 * should hear dry audio - this maintains "everyone hears the same music".
 */
export interface EffectsState {
  bypass?: boolean;  // true = effects disabled (dry signal only), default false
  reverb: {
    decay: number;  // 0.1 to 10 seconds
    wet: number;    // 0 to 1
  };
  delay: {
    time: string;      // Musical notation: "8n", "4n", "16n", etc.
    feedback: number;  // 0 to 0.95
    wet: number;       // 0 to 1
  };
  chorus: {
    frequency: number;  // 0.1 to 10 Hz
    depth: number;      // 0 to 1
    wet: number;        // 0 to 1
  };
  distortion: {
    amount: number;     // 0 to 1 (waveshaping intensity)
    wet: number;        // 0 to 1
  };
}

/**
 * Scale state for Key Assistant (Phase 29E).
 * Synced across multiplayer for harmonic coordination.
 *
 * When scale lock is enabled, all players' ChromaticGrids are constrained
 * to the same scale, enabling harmonic safety across the ensemble.
 */
export interface ScaleState {
  root: string;       // Root note: 'C', 'C#', 'D', etc.
  scaleId: string;    // Scale identifier: 'minor-pentatonic', 'major', 'dorian', etc.
  locked: boolean;    // Whether scale lock is active (constrains ChromaticGrid)
}
