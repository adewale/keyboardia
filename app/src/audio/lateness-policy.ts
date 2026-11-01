import {
  addAudioTime,
  differenceInSeconds,
  type AudioTime,
  type Seconds,
} from './audio-time';

/** One application-level policy shared by every renderer family. */
export interface LatenessPolicy {
  /** Maximum stale interval that may be clamped to the present. */
  tolerance: Seconds;
  /** Lead required after clamping so renderer APIs do not receive the past. */
  minimumLead: Seconds;
}

/**
 * Measured safe handoff budget for source and AudioParam messages on a cold
 * Chromium sampled voice. Keeping it here applies the same deadline to every
 * renderer without allowing renderer-local timestamp reinterpretation.
 */
export const LATE_NOTE_CONTROL_LEAD = 0.04 as Seconds;

export const DEFAULT_LATENESS_POLICY: Readonly<LatenessPolicy> = Object.freeze({
  tolerance: 0.1 as Seconds,
  minimumLead: LATE_NOTE_CONTROL_LEAD,
});

export type DispatchTimeDecision =
  | { kind: 'on-time'; time: AudioTime; lateness: Seconds }
  | { kind: 'late-clamped'; time: AudioTime; lateness: Seconds }
  | { kind: 'drop'; lateness: Seconds };

export function resolveDispatchTime(
  intendedTime: AudioTime,
  currentTime: AudioTime,
  policy: LatenessPolicy = DEFAULT_LATENESS_POLICY,
): DispatchTimeDecision {
  if (policy.tolerance < 0 || policy.minimumLead < 0) {
    throw new RangeError('Lateness tolerance and minimum lead must be non-negative');
  }

  const lateness = differenceInSeconds(currentTime, intendedTime);
  // An event can be nominally on time yet still be too close for control
  // messages to reach the render thread. Preserve only timestamps that meet
  // the shared lead budget; clamp near-deadline and tolerably late events at
  // this one authority boundary.
  if (lateness <= -policy.minimumLead) {
    return { kind: 'on-time', time: intendedTime, lateness };
  }
  if (lateness <= policy.tolerance) {
    return {
      kind: 'late-clamped',
      time: addAudioTime(currentTime, policy.minimumLead),
      lateness,
    };
  }
  return { kind: 'drop', lateness };
}
