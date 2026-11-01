import type { ScaleState } from '../shared/sync-types';
import { isInScale, type NoteName, type ScaleId } from './music-theory';

/**
 * Scale lock constrains new note entry without hiding/removing legacy notes.
 * This belongs to the music capability: shared serialization defaults must not
 * acquire a dependency on pitch-theory behavior.
 */
export function canEnterPitchWithScaleLock(
  pitch: number,
  scale: ScaleState | null | undefined,
): boolean {
  return !scale?.locked || isInScale(
    pitch,
    scale.root as NoteName,
    scale.scaleId as ScaleId,
  );
}
