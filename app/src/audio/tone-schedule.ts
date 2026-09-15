/** Tone.js event times share the underlying AudioContext's absolute clock. */
export const MIN_TONE_SCHEDULE_LEAD_SECONDS = 0.001;

/**
 * Preserve a scheduler-owned absolute event time while protecting late or
 * duplicate events from Tone.js's strictly-increasing timeline checks.
 *
 * `immediateTime` must come from Tone.immediate(), not Tone.now(): Tone.now()
 * includes the configured lookahead and would add it a second time.
 */
export function absoluteToneStartTime(
  eventTime: number | undefined,
  immediateTime: number,
  lastScheduledTime = Number.NEGATIVE_INFINITY,
): number {
  const requestedTime = eventTime !== undefined && Number.isFinite(eventTime)
    ? eventTime
    : immediateTime;
  return Math.max(
    requestedTime,
    immediateTime + MIN_TONE_SCHEDULE_LEAD_SECONDS,
    lastScheduledTime + MIN_TONE_SCHEDULE_LEAD_SECONDS,
  );
}
