/**
 * Main-thread receive-lateness measurement for the worklet scheduler.
 *
 * The worklet posts note events with an intended `event.time` (a future
 * audioContext time at which the audio graph should start the note).
 * The host runs on the main thread and may be delayed by GC, long tasks,
 * or MessagePort queueing. Lateness is the wall-clock delta between
 * receive time and intended time.
 *
 * Positive latenessMs → the intended time has already passed when the
 *   host received it, so `Math.max(time, currentTime)` in the audio
 *   engine will clamp the start and the note will play late.
 * Negative latenessMs → the event arrived with lead time; the audio
 *   graph can schedule it precisely.
 */

export interface ReceiveLatenessInput {
  /** The scheduled note start time (audioContext time, seconds). */
  eventTime: number;
  /** `audioContext.currentTime` at the moment the host received the event. */
  currentTime: number;
}

export interface ReceiveLatenessResult {
  /** Signed milliseconds: positive means late, negative means early. */
  latenessMs: number;
  /** True iff the host received the event after its intended delivery time. */
  isLate: boolean;
}

export function computeReceiveLateness(input: ReceiveLatenessInput): ReceiveLatenessResult {
  const latenessMs = (input.currentTime - input.eventTime) * 1000;
  return {
    latenessMs,
    isLate: latenessMs > 0,
  };
}

export interface LatenessMetricsSink {
  recordJitter(ms: number): void;
  recordLateNote(): void;
}

/**
 * Compute the host's receive-lateness for a single note event and push
 * the result into the metrics sink. Centralised so the host and tests
 * agree on exactly what is recorded.
 */
export function measureAndReportLateness(
  eventTime: number,
  currentTime: number,
  sink: LatenessMetricsSink,
): void {
  const { latenessMs, isLate } = computeReceiveLateness({ eventTime, currentTime });
  sink.recordJitter(Math.abs(latenessMs));
  if (isLate) sink.recordLateNote();
}
