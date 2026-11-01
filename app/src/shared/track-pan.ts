import { DEFAULT_PAN, MAX_PAN, MIN_PAN } from './constants';
import { shouldKeepInstrumentCentered } from './instrument-classification';
import { isValidPan } from './validation';

/** Canonical pan is normalized; notation and UI alone expose integer percent. */
export function panPercentToNormalized(percent: number): number {
  if (!Number.isFinite(percent) || percent < -100 || percent > 100) {
    throw new RangeError('Pan percent must be a finite number from -100 to 100.');
  }
  return percent / 100;
}

export function normalizedPanToPercent(pan: number): number {
  if (!isValidPan(pan)) {
    throw new RangeError(`Pan must be a finite number from ${MIN_PAN} to ${MAX_PAN}.`);
  }
  return Math.round(pan * 100);
}

export function parsePanNotation(annotation: string): number | null {
  const match = /^\[?pan\s*:\s*([+-]?\d{1,3})\]?$/i.exec(annotation.trim());
  if (!match) return null;
  return panPercentToNormalized(Number(match[1]));
}

export function formatPanNotation(pan: number): string {
  const percent = normalizedPanToPercent(pan);
  return `[pan:${percent > 0 ? '+' : ''}${percent}]`;
}

const AUTO_SPREAD = [
  -0.08, 0.08,
  -0.12, 0.12,
  -0.16, 0.16,
  -0.20, 0.20,
] as const;

function hasUnknownOrIntrinsicStereo(sampleId: string): boolean {
  const normalized = sampleId.trim().toLowerCase();
  return normalized.startsWith('sampled:')
    || normalized.startsWith('mic:')
    || normalized.startsWith('recording-')
    || normalized.startsWith('slice-');
}

/**
 * Deterministic conservative spread for sources Keyboardia creates as mono.
 *
 * Sampled and user-recorded files may already contain deliberate stereo
 * information. Leave those centered until the user explicitly places them;
 * equal-power panning can narrow an intrinsically wide source or alter its
 * fold-down even when the pan amount looks conservative.
 */
export function recommendedTrackPan(sampleId: string, addOrder: number): number {
  if (shouldKeepInstrumentCentered(sampleId) || hasUnknownOrIntrinsicStereo(sampleId)) {
    return DEFAULT_PAN;
  }
  const index = Math.max(0, Math.trunc(addOrder)) % AUTO_SPREAD.length;
  return AUTO_SPREAD[index];
}
