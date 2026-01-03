/**
 * REFACTOR-06: Consolidated Validation Module
 *
 * All message validation logic in one place with consistent interface.
 * Each validator returns { valid, sanitized?, error? } for:
 * - Consistent handling in message handlers
 * - Clear error reporting
 * - Input sanitization (clamping, defaults)
 */

import type { SessionState } from './types';
import type { ParameterLock, EffectsState, FMParams } from '../shared/sync-types';
import {
  clamp,
  validateParameterLock,
  MAX_STEPS,
  MIN_TEMPO,
  MAX_TEMPO,
  MIN_SWING,
  MAX_SWING,
  MIN_VOLUME,
  MAX_VOLUME,
  MIN_TRANSPOSE,
  MAX_TRANSPOSE,
  VALID_DELAY_TIMES,
} from './invariants';

// ============================================================================
// Types
// ============================================================================

/**
 * Standard validation result returned by all validators.
 */
export interface ValidationResult<T> {
  /** Whether the input is valid */
  valid: boolean;
  /** Sanitized (clamped, defaulted) value - only present if valid */
  sanitized?: T;
  /** Error message - only present if invalid */
  error?: string;
}

// ============================================================================
// Effects Bounds (not exported from invariants.ts)
// ============================================================================

const EFFECTS_BOUNDS = {
  reverb: { decayMin: 0.1, decayMax: 10, wetMin: 0, wetMax: 1 },
  delay: { feedbackMin: 0, feedbackMax: 1, wetMin: 0, wetMax: 1 },
  chorus: { frequencyMin: 0.1, frequencyMax: 10, depthMin: 0, depthMax: 1, wetMin: 0, wetMax: 1 },
  distortion: { amountMin: 0, amountMax: 1, wetMin: 0, wetMax: 1 },
} as const;

// ============================================================================
// FM Synth Bounds
// ============================================================================

const FM_BOUNDS = {
  harmonicityMin: 0.5,   // Aligned with grid.tsx, live-session.ts, sync-types.ts
  harmonicityMax: 10,    // Was 20, now matches all other validation layers
  modulationIndexMin: 0,
  modulationIndexMax: 20, // Was 200, now matches all other validation layers
  attackMin: 0.001,
  attackMax: 5,
  decayMin: 0.001,
  decayMax: 5,
  sustainMin: 0,
  sustainMax: 1,
  releaseMin: 0.001,
  releaseMax: 10,
} as const;

const VALID_MODULATION_TYPES = new Set(['sine', 'square', 'triangle', 'sawtooth']);

// ============================================================================
// Helper Functions
// ============================================================================

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && !isNaN(value) && isFinite(value);
}

function invalidResult<T>(error: string): ValidationResult<T> {
  return { valid: false, error };
}

function validResult<T>(sanitized: T): ValidationResult<T> {
  return { valid: true, sanitized };
}

// ============================================================================
// Message Types
// ============================================================================

interface ToggleStepMsg { trackId: string; step: number }
interface SetTempoMsg { tempo: number }
interface SetSwingMsg { swing: number }
interface SetTrackVolumeMsg { trackId: string; volume: number }
interface SetTrackTransposeMsg { trackId: string; transpose: number }
interface SetParameterLockMsg { trackId: string; step: number; lock: ParameterLock | null | unknown }
interface SetEffectsMsg { effects: EffectsState }
interface SetFMParamsMsg { trackId: string; fmParams: FMParams }

// ============================================================================
// Validators
// ============================================================================

/**
 * Validate toggle_step message.
 * Requires state to check if track exists and step is within bounds.
 */
function validateToggleStep(
  msg: ToggleStepMsg,
  state: SessionState
): ValidationResult<ToggleStepMsg> {
  // Check track exists
  const track = state.tracks.find(t => t.id === msg.trackId);
  if (!track) {
    return invalidResult(`Invalid track: ${msg.trackId}`);
  }

  // Check step is a number
  if (!isNumber(msg.step)) {
    return invalidResult(`Invalid step: not a number`);
  }

  // Check step is in bounds
  if (msg.step < 0 || msg.step >= MAX_STEPS) {
    return invalidResult(`Invalid step: ${msg.step} out of range [0, ${MAX_STEPS - 1}]`);
  }

  return validResult(msg);
}

/**
 * Validate set_tempo message.
 * Clamps to valid range.
 */
function validateSetTempo(msg: SetTempoMsg): ValidationResult<SetTempoMsg> {
  if (!isNumber(msg.tempo)) {
    return invalidResult('Invalid tempo: not a number');
  }

  return validResult({
    ...msg,
    tempo: clamp(msg.tempo, MIN_TEMPO, MAX_TEMPO),
  });
}

/**
 * Validate set_swing message.
 * Clamps to valid range.
 */
function validateSetSwing(msg: SetSwingMsg): ValidationResult<SetSwingMsg> {
  if (!isNumber(msg.swing)) {
    return invalidResult('Invalid swing: not a number');
  }

  return validResult({
    ...msg,
    swing: clamp(msg.swing, MIN_SWING, MAX_SWING),
  });
}

/**
 * Validate set_track_volume message.
 * Clamps to valid range.
 */
function validateSetTrackVolume(
  msg: SetTrackVolumeMsg
): ValidationResult<SetTrackVolumeMsg> {
  if (!isNumber(msg.volume)) {
    return invalidResult('Invalid volume: not a number');
  }

  return validResult({
    ...msg,
    volume: clamp(msg.volume, MIN_VOLUME, MAX_VOLUME),
  });
}

/**
 * Validate set_track_transpose message.
 * Clamps to valid range.
 */
function validateSetTrackTranspose(
  msg: SetTrackTransposeMsg
): ValidationResult<SetTrackTransposeMsg> {
  if (!isNumber(msg.transpose)) {
    return invalidResult('Invalid transpose: not a number');
  }

  return validResult({
    ...msg,
    transpose: clamp(msg.transpose, MIN_TRANSPOSE, MAX_TRANSPOSE),
  });
}

/**
 * Validate set_parameter_lock message.
 * Uses existing validateParameterLock from invariants.ts.
 */
function validateSetParameterLock(
  msg: SetParameterLockMsg
): ValidationResult<{ trackId: string; step: number; lock: ParameterLock | null }> {
  // Check step is valid
  if (!isNumber(msg.step) || msg.step < 0 || msg.step >= MAX_STEPS) {
    return invalidResult(`Invalid step: ${msg.step}`);
  }

  // null is valid (clearing lock)
  if (msg.lock === null) {
    return validResult({ trackId: msg.trackId, step: msg.step, lock: null });
  }

  // Validate the lock object
  const validatedLock = validateParameterLock(msg.lock);

  // If validation returns null for non-null input, the input was invalid
  if (validatedLock === null && msg.lock !== null && msg.lock !== undefined) {
    return invalidResult('Invalid parameter lock: invalid type or value');
  }

  return validResult({
    trackId: msg.trackId,
    step: msg.step,
    lock: validatedLock,
  });
}

/**
 * Validate set_effects message.
 * Clamps all values and sanitizes delay time.
 */
function validateSetEffects(msg: SetEffectsMsg): ValidationResult<SetEffectsMsg> {
  const effects = msg.effects;

  // Validate structure
  if (!effects || typeof effects !== 'object') {
    return invalidResult('Invalid effects: not an object');
  }

  // Sanitize reverb
  const reverb = {
    decay: isNumber(effects.reverb?.decay)
      ? clamp(effects.reverb.decay, EFFECTS_BOUNDS.reverb.decayMin, EFFECTS_BOUNDS.reverb.decayMax)
      : 2,
    wet: isNumber(effects.reverb?.wet)
      ? clamp(effects.reverb.wet, EFFECTS_BOUNDS.reverb.wetMin, EFFECTS_BOUNDS.reverb.wetMax)
      : 0.3,
  };

  // Sanitize delay
  const delayTime = VALID_DELAY_TIMES.has(effects.delay?.time as string)
    ? effects.delay.time
    : '8n';
  const delay = {
    time: delayTime,
    feedback: isNumber(effects.delay?.feedback)
      ? clamp(effects.delay.feedback, EFFECTS_BOUNDS.delay.feedbackMin, EFFECTS_BOUNDS.delay.feedbackMax)
      : 0.3,
    wet: isNumber(effects.delay?.wet)
      ? clamp(effects.delay.wet, EFFECTS_BOUNDS.delay.wetMin, EFFECTS_BOUNDS.delay.wetMax)
      : 0.2,
  };

  // Sanitize chorus
  const chorus = {
    frequency: isNumber(effects.chorus?.frequency)
      ? clamp(effects.chorus.frequency, EFFECTS_BOUNDS.chorus.frequencyMin, EFFECTS_BOUNDS.chorus.frequencyMax)
      : 1,
    depth: isNumber(effects.chorus?.depth)
      ? clamp(effects.chorus.depth, EFFECTS_BOUNDS.chorus.depthMin, EFFECTS_BOUNDS.chorus.depthMax)
      : 0.5,
    wet: isNumber(effects.chorus?.wet)
      ? clamp(effects.chorus.wet, EFFECTS_BOUNDS.chorus.wetMin, EFFECTS_BOUNDS.chorus.wetMax)
      : 0.1,
  };

  // Sanitize distortion
  const distortion = {
    amount: isNumber(effects.distortion?.amount)
      ? clamp(effects.distortion.amount, EFFECTS_BOUNDS.distortion.amountMin, EFFECTS_BOUNDS.distortion.amountMax)
      : 0.2,
    wet: isNumber(effects.distortion?.wet)
      ? clamp(effects.distortion.wet, EFFECTS_BOUNDS.distortion.wetMin, EFFECTS_BOUNDS.distortion.wetMax)
      : 0.1,
  };

  // Sanitize bypass (default to false if not provided or not boolean)
  const bypass = typeof effects.bypass === 'boolean' ? effects.bypass : false;

  return validResult({
    effects: { bypass, reverb, delay, chorus, distortion },
  });
}

/**
 * Validate set_fm_params message.
 * Validates modulation type and clamps all values.
 */
function validateSetFMParams(msg: SetFMParamsMsg): ValidationResult<SetFMParamsMsg> {
  const fmParams = msg.fmParams;

  // Validate structure
  if (!fmParams || typeof fmParams !== 'object') {
    return invalidResult('Invalid fmParams: not an object');
  }

  // Validate modulation type
  if (!VALID_MODULATION_TYPES.has(fmParams.modulationType)) {
    return invalidResult(`Invalid modulation type: ${fmParams.modulationType}`);
  }

  // Sanitize all values
  const sanitized: FMParams = {
    modulationType: fmParams.modulationType,
    harmonicity: isNumber(fmParams.harmonicity)
      ? clamp(fmParams.harmonicity, FM_BOUNDS.harmonicityMin, FM_BOUNDS.harmonicityMax)
      : 2,
    modulationIndex: isNumber(fmParams.modulationIndex)
      ? clamp(fmParams.modulationIndex, FM_BOUNDS.modulationIndexMin, FM_BOUNDS.modulationIndexMax)
      : 10,
    attack: isNumber(fmParams.attack)
      ? clamp(fmParams.attack, FM_BOUNDS.attackMin, FM_BOUNDS.attackMax)
      : 0.01,
    decay: isNumber(fmParams.decay)
      ? clamp(fmParams.decay, FM_BOUNDS.decayMin, FM_BOUNDS.decayMax)
      : 0.2,
    sustain: isNumber(fmParams.sustain)
      ? clamp(fmParams.sustain, FM_BOUNDS.sustainMin, FM_BOUNDS.sustainMax)
      : 0.5,
    release: isNumber(fmParams.release)
      ? clamp(fmParams.release, FM_BOUNDS.releaseMin, FM_BOUNDS.releaseMax)
      : 1,
  };

  return validResult({
    trackId: msg.trackId,
    fmParams: sanitized,
  });
}

// ============================================================================
// Exported Validators Object
// ============================================================================

/**
 * All message validators in a single object.
 * Each validator returns { valid, sanitized?, error? }.
 */
export const validators = {
  toggleStep: validateToggleStep,
  setTempo: validateSetTempo,
  setSwing: validateSetSwing,
  setTrackVolume: validateSetTrackVolume,
  setTrackTranspose: validateSetTrackTranspose,
  setParameterLock: validateSetParameterLock,
  setEffects: validateSetEffects,
  setFMParams: validateSetFMParams,
} as const;
