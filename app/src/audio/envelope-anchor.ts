/**
 * Envelope-anchor calculation for pitched-sample playback.
 *
 * The pitch-shift worklet introduces one grain of pipeline latency
 * before audible output appears. The click-prevention envelope must
 * therefore start at the moment that delayed audio actually arrives.
 *
 * The audio source itself starts at `Math.max(eventTime, currentTime)`
 * (Web Audio refuses to schedule sources in the past), so when the host
 * receives a note late, the source's effective start moves forward.
 * The envelope anchor must move with it — anchoring to the event time
 * alone allows the ramp to resolve in the past, which makes Web Audio
 * snap the gain straight to the post-ramp value and bypass the fade.
 *
 * See bug_009.
 */

export interface EnvelopeStartInput {
  /** The intended note start time (audio context seconds). */
  eventTime: number;
  /** `audioContext.currentTime` at the moment of scheduling. */
  currentTime: number;
  /** Pitch worklet's grain latency in seconds (0 if no worklet in chain). */
  pitchLatencySec: number;
}

export function computeEnvelopeStart(input: EnvelopeStartInput): number {
  const actualStartTime = Math.max(input.eventTime, input.currentTime);
  return actualStartTime + input.pitchLatencySec;
}
