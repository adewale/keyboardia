/**
 * Preserve a scheduler-owned absolute event time without renderer policy.
 *
 * The central dispatcher has already made the lateness decision. The raw
 * immediate clock is only a compatibility fallback for unscheduled previews.
 */
export function absoluteToneStartTime(
  eventTime: number | undefined,
  immediateTime: number,
): number {
  if (!Number.isFinite(immediateTime)) {
    throw new RangeError(`Tone immediate time must be finite; received ${String(immediateTime)}`);
  }
  if (eventTime === undefined) return immediateTime;
  if (!Number.isFinite(eventTime)) {
    throw new RangeError(`Tone event time must be finite; received ${String(eventTime)}`);
  }
  return eventTime;
}
