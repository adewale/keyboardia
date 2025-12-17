/**
 * XY Pad / Macro Controls
 *
 * Implements XY pad functionality from specs/SYNTHESIS-ENGINE.md Section 2.4
 *
 * Features:
 * - 2D control surface mapping X and Y to synth/effects parameters
 * - Flexible parameter routing (filter, LFO, envelope, mix)
 * - Linear and exponential curves
 * - Multiplayer-syncable state
 */

import { logger } from '../utils/logger';

/**
 * Available parameters that can be controlled by XY pad
 */
export type XYPadParameter =
  | 'filterFrequency'    // Filter cutoff (20 - 20000 Hz)
  | 'filterResonance'    // Filter Q (0 - 30)
  | 'lfoRate'            // LFO frequency (0.1 - 20 Hz)
  | 'lfoAmount'          // LFO depth (0 - 1)
  | 'oscMix'             // Oscillator 1/2 mix (0 - 1)
  | 'attack'             // Envelope attack (0.001 - 2s)
  | 'release'            // Envelope release (0.001 - 4s)
  | 'reverbWet'          // Reverb mix (0 - 1)
  | 'delayWet'           // Delay mix (0 - 1)
  | 'delayFeedback'      // Delay feedback (0 - 0.95)
  | 'chorusWet'          // Chorus mix (0 - 1)
  | 'distortionWet';     // Distortion mix (0 - 1)

/**
 * Curve type for parameter scaling
 */
export type XYCurveType = 'linear' | 'exponential';

/**
 * Single axis mapping configuration
 */
export interface XYPadMapping {
  parameter: XYPadParameter;
  axis: 'x' | 'y';
  min: number;
  max: number;
  curve: XYCurveType;
}

/**
 * XY Pad state for serialization/sync
 */
export interface XYPadState {
  x: number;  // 0 to 1
  y: number;  // 0 to 1
  mappings: XYPadMapping[];
}

/**
 * Default parameter ranges for common mappings
 */
export const PARAMETER_RANGES: Record<XYPadParameter, { min: number; max: number; curve: XYCurveType }> = {
  filterFrequency: { min: 100, max: 8000, curve: 'exponential' },
  filterResonance: { min: 0.5, max: 20, curve: 'linear' },
  lfoRate: { min: 0.1, max: 10, curve: 'exponential' },
  lfoAmount: { min: 0, max: 1, curve: 'linear' },
  oscMix: { min: 0, max: 1, curve: 'linear' },
  attack: { min: 0.001, max: 1, curve: 'exponential' },
  release: { min: 0.05, max: 2, curve: 'exponential' },
  reverbWet: { min: 0, max: 1, curve: 'linear' },
  delayWet: { min: 0, max: 1, curve: 'linear' },
  delayFeedback: { min: 0, max: 0.9, curve: 'linear' },
  chorusWet: { min: 0, max: 1, curve: 'linear' },
  distortionWet: { min: 0, max: 1, curve: 'linear' },
};

/**
 * Preset XY pad configurations for common use cases
 */
export const XY_PAD_PRESETS: Record<string, { name: string; mappings: XYPadMapping[] }> = {
  'filter-sweep': {
    name: 'Filter Sweep',
    mappings: [
      { parameter: 'filterFrequency', axis: 'x', min: 100, max: 8000, curve: 'exponential' },
      { parameter: 'filterResonance', axis: 'y', min: 0.5, max: 15, curve: 'linear' },
    ],
  },
  'lfo-control': {
    name: 'LFO Control',
    mappings: [
      { parameter: 'lfoRate', axis: 'x', min: 0.1, max: 10, curve: 'exponential' },
      { parameter: 'lfoAmount', axis: 'y', min: 0, max: 1, curve: 'linear' },
    ],
  },
  'envelope-shape': {
    name: 'Envelope Shape',
    mappings: [
      { parameter: 'attack', axis: 'x', min: 0.001, max: 1, curve: 'exponential' },
      { parameter: 'release', axis: 'y', min: 0.05, max: 2, curve: 'exponential' },
    ],
  },
  'space-control': {
    name: 'Space Control',
    mappings: [
      { parameter: 'reverbWet', axis: 'x', min: 0, max: 0.8, curve: 'linear' },
      { parameter: 'delayWet', axis: 'y', min: 0, max: 0.6, curve: 'linear' },
    ],
  },
  'delay-modulation': {
    name: 'Delay Modulation',
    mappings: [
      { parameter: 'delayWet', axis: 'x', min: 0, max: 0.7, curve: 'linear' },
      { parameter: 'delayFeedback', axis: 'y', min: 0, max: 0.85, curve: 'linear' },
    ],
  },
  'oscillator-filter': {
    name: 'Oscillator + Filter',
    mappings: [
      { parameter: 'oscMix', axis: 'x', min: 0, max: 1, curve: 'linear' },
      { parameter: 'filterFrequency', axis: 'y', min: 200, max: 6000, curve: 'exponential' },
    ],
  },
};

/**
 * Apply curve transformation to a normalized value (0-1)
 */
function applyCurve(value: number, curve: XYCurveType): number {
  if (curve === 'exponential') {
    // Exponential curve for frequency-like parameters
    return Math.pow(value, 2);
  }
  return value; // Linear
}

/**
 * Map a normalized value (0-1) to a parameter range
 */
export function mapValue(
  normalizedValue: number,
  min: number,
  max: number,
  curve: XYCurveType
): number {
  const curved = applyCurve(normalizedValue, curve);
  return min + curved * (max - min);
}

/**
 * Reverse map a parameter value back to normalized (0-1)
 */
export function unmapValue(
  value: number,
  min: number,
  max: number,
  curve: XYCurveType
): number {
  const normalized = (value - min) / (max - min);
  if (curve === 'exponential') {
    return Math.sqrt(Math.max(0, normalized));
  }
  return Math.max(0, Math.min(1, normalized));
}

/**
 * Parameter change callback type
 */
export type XYPadCallback = (parameter: XYPadParameter, value: number) => void;

/**
 * XYPadController - Manages XY pad state and parameter mappings
 */
export class XYPadController {
  private x = 0.5;
  private y = 0.5;
  private mappings: XYPadMapping[] = [];
  private callback: XYPadCallback | null = null;
  private enabled = true;

  /**
   * Create XY pad controller with optional preset
   */
  constructor(presetId?: string) {
    if (presetId && XY_PAD_PRESETS[presetId]) {
      this.loadPreset(presetId);
    }
  }

  /**
   * Set the parameter change callback
   */
  setCallback(callback: XYPadCallback): void {
    this.callback = callback;
  }

  /**
   * Load a preset configuration
   */
  loadPreset(presetId: string): void {
    const preset = XY_PAD_PRESETS[presetId];
    if (!preset) {
      logger.audio.warn(`Unknown XY pad preset: ${presetId}`);
      return;
    }

    this.mappings = [...preset.mappings];
    logger.audio.log(`Loaded XY pad preset: ${preset.name}`);

    // Re-apply current position with new mappings
    this.updateParameters();
  }

  /**
   * Set custom mappings
   */
  setMappings(mappings: XYPadMapping[]): void {
    this.mappings = [...mappings];
    this.updateParameters();
  }

  /**
   * Get current mappings
   */
  getMappings(): XYPadMapping[] {
    return [...this.mappings];
  }

  /**
   * Set X position (0-1)
   */
  setX(value: number): void {
    this.x = Math.max(0, Math.min(1, value));
    this.updateParameters();
  }

  /**
   * Set Y position (0-1)
   */
  setY(value: number): void {
    this.y = Math.max(0, Math.min(1, value));
    this.updateParameters();
  }

  /**
   * Set both X and Y position
   */
  setPosition(x: number, y: number): void {
    this.x = Math.max(0, Math.min(1, x));
    this.y = Math.max(0, Math.min(1, y));
    this.updateParameters();
  }

  /**
   * Get current X position
   */
  getX(): number {
    return this.x;
  }

  /**
   * Get current Y position
   */
  getY(): number {
    return this.y;
  }

  /**
   * Enable/disable the XY pad
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (enabled) {
      this.updateParameters();
    }
  }

  /**
   * Check if enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Get the current value for a specific parameter
   */
  getParameterValue(parameter: XYPadParameter): number | null {
    const mapping = this.mappings.find(m => m.parameter === parameter);
    if (!mapping) return null;

    const axisValue = mapping.axis === 'x' ? this.x : this.y;
    return mapValue(axisValue, mapping.min, mapping.max, mapping.curve);
  }

  /**
   * Get all current parameter values (only contains mapped parameters)
   */
  getAllParameterValues(): Partial<Record<XYPadParameter, number>> {
    const values: Partial<Record<XYPadParameter, number>> = {};

    for (const mapping of this.mappings) {
      const axisValue = mapping.axis === 'x' ? this.x : this.y;
      values[mapping.parameter] = mapValue(axisValue, mapping.min, mapping.max, mapping.curve);
    }

    return values;
  }

  /**
   * Get serializable state for persistence/sync
   */
  getState(): XYPadState {
    return {
      x: this.x,
      y: this.y,
      mappings: [...this.mappings],
    };
  }

  /**
   * Apply state from persistence/sync
   */
  applyState(state: XYPadState): void {
    this.x = state.x;
    this.y = state.y;
    this.mappings = [...state.mappings];
    this.updateParameters();
  }

  /**
   * Update all mapped parameters based on current position
   */
  private updateParameters(): void {
    if (!this.enabled || !this.callback) return;

    for (const mapping of this.mappings) {
      const axisValue = mapping.axis === 'x' ? this.x : this.y;
      const paramValue = mapValue(axisValue, mapping.min, mapping.max, mapping.curve);
      this.callback(mapping.parameter, paramValue);
    }
  }

  /**
   * Reset to center position
   */
  reset(): void {
    this.x = 0.5;
    this.y = 0.5;
    this.updateParameters();
  }
}

/**
 * Create a default XY pad controller
 */
export function createXYPad(presetId: string = 'filter-sweep'): XYPadController {
  return new XYPadController(presetId);
}

/**
 * Get available preset IDs
 */
export function getXYPadPresetIds(): string[] {
  return Object.keys(XY_PAD_PRESETS);
}

/**
 * Get preset info by ID
 */
export function getXYPadPresetInfo(presetId: string): { name: string; mappings: XYPadMapping[] } | null {
  return XY_PAD_PRESETS[presetId] || null;
}
