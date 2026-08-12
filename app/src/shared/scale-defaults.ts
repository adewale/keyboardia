import type { ScaleState } from './sync-types';

/**
 * Product default for sessions created after the sound-quality parity work.
 * New material starts in a deliberately safe, consonant pitch set.
 */
export const DEFAULT_NEW_SESSION_SCALE_STATE: Readonly<ScaleState> = Object.freeze({
  root: 'C',
  scaleId: 'minor-pentatonic',
  locked: true,
});

/**
 * Migration value for sessions written before scale was persisted.
 * Missing scale used to mean unrestricted pitch, so locking it during load
 * would be a destructive reinterpretation of existing music.
 */
export const LEGACY_MISSING_SCALE_STATE: Readonly<ScaleState> = Object.freeze({
  root: 'C',
  scaleId: 'minor-pentatonic',
  locked: false,
});

export type MissingScalePolicy = 'new-session' | 'legacy-session';

/** Return a detached canonical scale value for storage, hydration, and hashing. */
export function normalizeSessionScale(
  scale: ScaleState | null | undefined,
  missingPolicy: MissingScalePolicy,
): ScaleState {
  const fallback = missingPolicy === 'new-session'
    ? DEFAULT_NEW_SESSION_SCALE_STATE
    : LEGACY_MISSING_SCALE_STATE;
  const source = scale ?? fallback;
  return {
    root: source.root,
    scaleId: source.scaleId,
    locked: source.locked,
  };
}
