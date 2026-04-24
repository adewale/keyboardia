/**
 * Multiplayer join-in-progress math.
 *
 * When a client starts playback after a remote peer has already started,
 * it must align to the shared clock. Given the server-side start timestamp
 * and the current server time, compute the step at which this client
 * should pick up and the next step's time in local audioContext time.
 *
 * Extracted so both the main-thread scheduler and the AudioWorklet host
 * can use identical semantics.
 */

const STEPS_PER_BEAT = 4;

export interface JoinOffsetInput {
  /** audioContext.currentTime when start was called locally. */
  audioStartTime: number;
  /** Server wall-clock (ms) when playback first started across the room. */
  serverStartTime: number;
  /** Server wall-clock (ms) right now. */
  currentServerTime: number;
  tempo: number;
  maxSteps: number;
  /** Step to fall back to when the client is at/before serverStartTime. */
  loopStart: number;
}

export interface JoinOffsetResult {
  currentStep: number;
  nextStepTime: number;
}

function stepDurationSec(tempo: number): number {
  return 1 / ((tempo / 60) * STEPS_PER_BEAT);
}

export function computeJoinOffset(input: JoinOffsetInput): JoinOffsetResult {
  const elapsedMs = input.currentServerTime - input.serverStartTime;
  // Defensive clamp: real callers keep loopStart < maxSteps, but the
  // invariant "currentStep ∈ [0, maxSteps)" must hold unconditionally.
  const safeLoopStart = Math.max(0, Math.min(input.loopStart, input.maxSteps - 1));

  if (elapsedMs <= 0) {
    return {
      currentStep: safeLoopStart,
      nextStepTime: input.audioStartTime,
    };
  }

  const stepDuration = stepDurationSec(input.tempo);
  const stepDurationMs = stepDuration * 1000;
  const elapsedSteps = Math.floor(elapsedMs / stepDurationMs);
  const currentStep = ((elapsedSteps % input.maxSteps) + input.maxSteps) % input.maxSteps;

  const remainderMs = elapsedMs % stepDurationMs;
  const remainderSec = remainderMs / 1000;
  const nextStepTime = input.audioStartTime + (stepDuration - remainderSec);

  return { currentStep, nextStepTime };
}
