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

import {
  addAudioTime,
  differenceInMilliseconds,
  milliseconds,
  millisecondsToSeconds,
  seconds,
  secondsToMilliseconds,
  type AudioTime,
  type Seconds,
  type ServerTimeMs,
} from './audio-time';

const STEPS_PER_BEAT = 4;

export interface JoinOffsetInput {
  /** audioContext.currentTime when start was called locally. */
  audioStartTime: AudioTime;
  /** Server wall-clock (ms) when playback first started across the room. */
  serverStartTime: ServerTimeMs;
  /** Server wall-clock (ms) right now. */
  currentServerTime: ServerTimeMs;
  tempo: number;
  maxSteps: number;
  /** Step to fall back to when the client is at/before serverStartTime. */
  loopStart: number;
}

export interface JoinOffsetResult {
  currentStep: number;
  nextStepTime: AudioTime;
}

function stepDurationSec(tempo: number): Seconds {
  return seconds(1 / ((tempo / 60) * STEPS_PER_BEAT));
}

export function computeJoinOffset(input: JoinOffsetInput): JoinOffsetResult {
  const elapsedMs = differenceInMilliseconds(input.currentServerTime, input.serverStartTime);
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
  const stepDurationMs = secondsToMilliseconds(stepDuration);
  const elapsedSteps = Math.floor(elapsedMs / stepDurationMs);
  const remainderMs = elapsedMs % stepDurationMs;

  // Two distinct cases (the previous unified code was off by one mid-step
  // and one stepDuration too late on exact boundaries):
  //   - Exact boundary: peer is AT the start of a step boundary; this
  //     step plays now, at audioStartTime.
  //   - Mid-step:       peer is mid-way through a step that's already
  //     started elsewhere. The next thing to schedule is the NEXT step,
  //     at the upcoming boundary (audioStartTime + stepDuration - remainder).
  let stepToSchedule: number;
  let nextStepTime: AudioTime;
  if (remainderMs === 0) {
    stepToSchedule = ((elapsedSteps % input.maxSteps) + input.maxSteps) % input.maxSteps;
    nextStepTime = input.audioStartTime;
  } else {
    const next = elapsedSteps + 1;
    stepToSchedule = ((next % input.maxSteps) + input.maxSteps) % input.maxSteps;
    const remainderSec = millisecondsToSeconds(milliseconds(remainderMs));
    nextStepTime = addAudioTime(input.audioStartTime, seconds(stepDuration - remainderSec));
  }

  return { currentStep: stepToSchedule, nextStepTime };
}
