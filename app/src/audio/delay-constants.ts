/**
 * Delay effect constants - shared between components
 */

/**
 * Musical delay time options for UI selectors
 * Values are Tone.js musical notation (e.g., "8n" = eighth note)
 */
export const DELAY_TIME_OPTIONS = [
  { value: '32n', label: '1/32' },
  { value: '16n', label: '1/16' },
  { value: '16t', label: '1/16T' },
  { value: '8n', label: '1/8' },
  { value: '8t', label: '1/8T' },
  { value: '4n', label: '1/4' },
  { value: '4t', label: '1/4T' },
  { value: '2n', label: '1/2' },
] as const;

/**
 * Valid delay time values (extracted from options for validation)
 */
export const VALID_DELAY_TIMES = DELAY_TIME_OPTIONS.map(opt => opt.value);

/**
 * Type for valid delay time values
 */
export type DelayTimeValue = typeof DELAY_TIME_OPTIONS[number]['value'];
