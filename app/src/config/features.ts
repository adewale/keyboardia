/**
 * Centralized Feature Flags Configuration
 *
 * Controls which features are enabled/disabled across the application.
 * Flags can be overridden via environment variables (VITE_FEATURE_*).
 *
 * Usage:
 *   import { features } from '../config/features';
 *   if (features.loopRuler) { ... }
 *
 * Environment variable override:
 *   VITE_FEATURE_LOOP_RULER=true  // Enable loop ruler
 *   VITE_FEATURE_LOOP_RULER=false // Disable loop ruler
 *
 * @see specs/FEATURES.md for feature documentation
 */

/**
 * Parse a boolean environment variable
 * Returns defaultValue if not set, true if 'true'/'1', false otherwise
 */
function parseEnvBool(envVar: string | undefined, defaultValue: boolean): boolean {
  if (envVar === undefined || envVar === '') {
    return defaultValue;
  }
  return envVar === 'true' || envVar === '1';
}

/**
 * Feature flags object - import this to check feature states
 */
export const features = {
  /**
   * Loop Ruler - UI for setting loop regions by dragging
   * Default: false (disabled while we assess UX impact)
   * The underlying loop region functionality remains in state/audio systems
   */
  loopRuler: parseEnvBool(import.meta.env.VITE_FEATURE_LOOP_RULER, false),

  /**
   * Mixer Panel - Volume/pan controls for tracks
   * Default: true (stable feature)
   */
  mixerPanel: parseEnvBool(import.meta.env.VITE_FEATURE_MIXER_PANEL, true),

  /**
   * Pitch Overview - Visual display of track pitches
   * Default: true (stable feature)
   */
  pitchOverview: parseEnvBool(import.meta.env.VITE_FEATURE_PITCH_OVERVIEW, true),

  /**
   * Effects Panel - Reverb, delay, etc.
   * Default: true (stable feature)
   */
  effectsPanel: parseEnvBool(import.meta.env.VITE_FEATURE_EFFECTS_PANEL, true),

  /**
   * Velocity Lane - Per-step velocity editing
   * Default: true (stable feature)
   */
  velocityLane: parseEnvBool(import.meta.env.VITE_FEATURE_VELOCITY_LANE, true),

  /**
   * Multiplayer - Real-time collaboration via WebSocket
   * Default: true (stable feature)
   */
  multiplayer: parseEnvBool(import.meta.env.VITE_FEATURE_MULTIPLAYER, true),
} as const;

/**
 * Type for feature flag keys
 */
export type FeatureFlag = keyof typeof features;

/**
 * Check if a feature is enabled
 */
export function isFeatureEnabled(flag: FeatureFlag): boolean {
  return features[flag];
}

/**
 * Get all feature flags as an object (useful for debugging)
 */
export function getAllFeatureFlags(): Record<FeatureFlag, boolean> {
  return { ...features };
}
