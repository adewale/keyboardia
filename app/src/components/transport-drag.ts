import { clamp } from '../shared/validation';

export const TEMPO_DRAG_SENSITIVITY = 0.5;
export const SWING_DRAG_SENSITIVITY = 0.3;

/** Pure drag calculation used by TransportBar's tempo and swing controls. */
export function calculateDragValue(
  startValue: number,
  startY: number,
  currentY: number,
  sensitivity: number,
  min: number,
  max: number,
): number {
  const delta = startY - currentY;
  return Math.round(clamp(startValue + delta * sensitivity, min, max));
}
